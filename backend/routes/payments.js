const express = require('express');
const router = express.Router();
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const { getPlan } = require('../services/plans');

const SMS_TIMEOUT_MS = Number(process.env.SMS_TIMEOUT_MS) || 8000;

// Fire-and-forget: the Africa''s Talking HTTP call can hang for 20s+ on a bad
// key or no data credit, which used to block the student's request until it
// timed out. Notification delivery must never gate the API response.
function sendSMSAsync(phoneNumber, message) {
    if (!phoneNumber) return;
    sendSMS(phoneNumber, message).catch(() => {});
}

async function sendSMS(phoneNumber, message) {
    if (!process.env.AT_API_KEY) {
        console.log('  AT_API_KEY not set — skipping SMS to ' + phoneNumber);
        return;
    }
    let timer;
    try {
        const AfricasTalking = require('africastalking');
        const africastalking = AfricasTalking({
            apiKey: process.env.AT_API_KEY,
            username: process.env.AT_USERNAME || 'sandbox',
            from: process.env.AT_PHONE || ''
        });
        const sms = africastalking.SMS;
        await Promise.race([
            sms.send({ to: [phoneNumber], message, from: process.env.AT_PHONE || '' }),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('SMS request timed out')), SMS_TIMEOUT_MS);
            })
        ]);
        console.log('  SMS sent to ' + phoneNumber);
    } catch (err) {
        console.error('  SMS failed (non-fatal):', err.message || err);
    } finally {
        clearTimeout(timer);
    }
}

// POST /api/payments — Student submits a payment request (tier-based)
router.post('/', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const { phoneNumber, accessType } = req.body;

        if (!phoneNumber || !accessType) {
            return res.status(400).json({ error: 'Missing required fields: phoneNumber, accessType (video|weekly|monthly)' });
        }

        if (!['video', 'weekly', 'monthly'].includes(accessType)) {
            return res.status(400).json({ error: 'Invalid access type. Must be: video, weekly, or monthly' });
        }

        // Price comes from the admin-editable plan (see services/plans.js) so a
        // submission is always charged the current advertised amount.
        const plan = await getPlan(accessType);
        if (!plan) {
            return res.status(400).json({ error: 'Invalid access type. Must be: video, weekly, or monthly' });
        }
        const amount = plan.price;

        const { data: userRows } = await supabase
            .from('users')
            .select('username,phone_number')
            .eq('id', userId)
            .limit(1);
        const user = userRows && userRows[0];
        const userPhone = user ? (user.phone_number || phoneNumber) : phoneNumber;

        if (user && !user.phone_number && phoneNumber) {
            await supabase
                .from('users')
                .update({ phone_number: phoneNumber })
                .eq('id', userId);
        }

        // For 'video' tier, require a lessonId
        const lessonId = req.body.lessonId || null;
        if (accessType === 'video' && !lessonId) {
            return res.status(400).json({ error: 'lessonId is required for single video access' });
        }

        const { data: inserted, error } = await supabase
            .from('payments')
            .insert({
                user_id: userId,
                lesson_id: lessonId,
                transaction_code: null,
                phone_number: userPhone,
                amount,
                access_type: accessType
            })
            .select('id')
            .single();
        if (error) throw error;

        const smsMessage = [
            '🎓 New Payment — Modern Skills',
            '',
            'From: ' + ((user && user.username) || 'Unknown'),
            'Phone: ' + userPhone,
            'Plan: ' + accessType,
            'Amount: ' + amount + ' RWF',
            '',
            'Approve in admin panel.'
        ].join('\n');

        sendSMSAsync(process.env.OWNER_PHONE || '+250783198148', smsMessage);

        res.json({
            success: true,
            message: 'Payment submitted. Awaiting verification.',
            paymentId: inserted.id
        });
    } catch (err) {
        console.error('Payment submit error:', err.message || err);
        return fail(res, err, 'Could not submit the payment');
    }
});

// GET /api/payments/check — Check if user has access to a lesson
router.get('/check', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const lessonId = parseInt(req.query.lessonId);

        if (!lessonId) {
            return res.status(400).json({ error: 'lessonId is required' });
        }

        const { data: lessonRows } = await supabase
            .from('lessons')
            .select('is_free')
            .eq('id', lessonId)
            .limit(1);
        const lesson = lessonRows && lessonRows[0];
        if (lesson && lesson.is_free) {
            return res.json({ hasAccess: true, reason: 'free' });
        }

        // Lesson-specific approved payment
        const { data: lessonPay } = await supabase
            .from('payments')
            .select('id,access_type,access_expires_at')
            .eq('user_id', userId)
            .eq('lesson_id', lessonId)
            .eq('status', 'approved')
            .order('access_expires_at', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
            .limit(1);

        // Global (weekly/monthly) approved payment
        const { data: globalPay } = await supabase
            .from('payments')
            .select('id,access_type,access_expires_at')
            .eq('user_id', userId)
            .is('lesson_id', null)
            .eq('status', 'approved')
            .in('access_type', ['weekly', 'monthly'])
            .order('access_expires_at', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
            .limit(1);

        let approved = null;
        if (lessonPay && lessonPay.length > 0) {
            approved = lessonPay[0];
        } else if (globalPay && globalPay.length > 0) {
            approved = globalPay[0];
        }

        if (approved && approved.access_type && approved.access_expires_at) {
            if (new Date(approved.access_expires_at) < new Date()) {
                return res.json({ hasAccess: false, reason: 'expired' });
            }
        }

        res.json({
            hasAccess: !!approved,
            reason: approved ? 'approved' : 'no_payment'
        });
    } catch (err) {
        console.error('Payment check error:', err.message || err);
        return fail(res, err, 'Could not check payment status');
    }
});

// GET /api/payments/check-all — Check if user has access to the current lesson (and global/weekly/monthly access)
router.get('/check-all', authenticate, async (req, res) => {
    try {
        const userId = req.user.id;
        const lessonId = req.query.lessonId ? parseInt(req.query.lessonId) : null;

        // Check for weekly/monthly/admin-grant access (any lesson).
        // Split into two safe .eq/.is filters instead of an or() string
        // (timestamps and dots in or() values break PostgREST parsing).
        const { data: globalRows } = await supabase
            .from('payments')
            .select('access_type,access_expires_at')
            .eq('user_id', userId)
            .eq('status', 'approved')
            .or(`access_type.in.(weekly,monthly),transaction_code.eq.ADMIN-GRANT`)
            .order('access_expires_at', { ascending: false, nullsFirst: false })
            .limit(1);
        const globalAccess = globalRows || [];

        let hasGlobalAccess = false;
        if (globalAccess.length > 0) {
            const ga = globalAccess[0];
            if (ga.access_type && ga.access_expires_at && new Date(ga.access_expires_at) < new Date()) {
                hasGlobalAccess = false;
            } else {
                hasGlobalAccess = true;
            }
        }

        // Check approved video-tier payment for this specific lesson
        let lessonApproved = false;
        if (!hasGlobalAccess && lessonId) {
            const { data: rows } = await supabase
                .from('payments')
                .select('access_expires_at')
                .eq('user_id', userId)
                .eq('lesson_id', lessonId)
                .eq('status', 'approved')
                .order('created_at', { ascending: false })
                .limit(1);
            const videoPay = rows && rows[0];
            if (videoPay && (!videoPay.access_expires_at || new Date(videoPay.access_expires_at) >= new Date())) {
                lessonApproved = true;
            }
        }

        const { data: rows, error } = await supabase
            .from('v_payments_admin')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Surface details of the currently-active access so the UI can show
        // the plan and expiry date, and flag a recently expired plan for renewal.
        let activeAccessType = null;
        let activeExpiresAt = null;
        if (hasGlobalAccess) {
            activeAccessType = globalAccess[0].access_type || 'ADMIN-GRANT';
            activeExpiresAt = globalAccess[0].access_expires_at || null;
        } else if (lessonApproved) {
            activeAccessType = 'video';
            activeExpiresAt = null;
        }
        const expiredGlobal = globalAccess.length > 0
            && globalAccess[0].access_type
            && globalAccess[0].access_expires_at
            && new Date(globalAccess[0].access_expires_at) < new Date();

        const allRows = rows || [];
        const approved = allRows.filter(r => {
            if (r.status !== 'approved') return false;
            if (r.access_type && r.access_expires_at && new Date(r.access_expires_at) < new Date()) return false;
            return true;
        });
        const pending = allRows.filter(r => r.status === 'pending');
        const mostRecentRejected = allRows.find(r => r.status === 'rejected');

        res.json({
            hasAccess: hasGlobalAccess || lessonApproved,
            hasGlobalAccess,
            lessonApproved,
            accessType: activeAccessType,
            accessExpiresAt: activeExpiresAt,
            daysLeft: activeExpiresAt
                ? Math.max(0, Math.ceil((new Date(activeExpiresAt) - Date.now()) / 86400000))
                : null,
            expiredGlobal,
            lessonIds: approved.map(r => r.lesson_id),
            pending: pending.length > 0,
            pendingPayments: pending.map(r => ({
                id: r.id,
                lessonId: r.lesson_id,
                lessonTitle: r.lesson_title,
                phoneNumber: r.phone_number,
                amount: r.amount,
                accessType: r.access_type,
                createdAt: r.created_at
            })),
            lastRejected: mostRecentRejected ? {
                id: mostRecentRejected.id,
                lessonTitle: mostRecentRejected.lesson_title,
                adminNote: mostRecentRejected.admin_note,
                reviewedAt: mostRecentRejected.reviewed_at
            } : null
        });
    } catch (err) {
        console.error('Payment check-all error:', err.message || err);
        return fail(res, err, 'Could not check payment status');
    }
});

// GET /api/payments/admin — Admin lists all payments
router.get('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: payments, error } = await supabase
            .from('v_payments_admin')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ payments: payments || [] });
    } catch (err) {
        console.error('Admin payments error:', err.message || err);
        return fail(res, err, 'Could not load payments');
    }
});

// GET /api/payments/admin/stats — Payment stats
router.get('/admin/stats', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: statsRow, error } = await supabase
            .from('v_payment_stats')
            .select('*')
            .limit(1)
            .maybeSingle();
        if (error) throw error;

        res.json({
            total: statsRow ? statsRow.total : 0,
            pending: statsRow ? statsRow.pending : 0,
            approved: statsRow ? statsRow.approved : 0,
            rejected: statsRow ? statsRow.rejected : 0,
            totalRevenue: statsRow ? statsRow.totalRevenue : 0
        });
    } catch (err) {
        console.error('Payment stats error:', err.message || err);
        return fail(res, err, 'Could not load payment stats');
    }
});

// PATCH /api/payments/:id/approve — Admin approves payment
router.patch('/:id/approve', authenticate, requireAdmin, async (req, res) => {
    try {
        const paymentId = parseInt(req.params.id, 10);
        const { data: paymentRows } = await supabase
            .from('payments')
            .select('*')
            .eq('id', paymentId)
            .limit(1);
        const payment = paymentRows && paymentRows[0];
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }
        if (payment.status === 'approved') {
            return res.status(400).json({ error: 'Payment already approved' });
        }

        // Expiry is driven by the plan's duration (admin-editable). A null or
        // non-positive duration means the access never expires.
        const plan = await getPlan(payment.access_type);
        const durationDays = plan && plan.durationDays ? Number(plan.durationDays) : 0;
        let expiresAt = null;
        if (durationDays > 0) {
            expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
        }

        const { error: approveError } = await supabase
            .from('payments')
            .update({
                status: 'approved',
                reviewed_at: new Date().toISOString(),
                access_expires_at: expiresAt ? expiresAt.toISOString() : null
            })
            .eq('id', paymentId);
        if (approveError) throw approveError;

        const { data: userRows } = await supabase
            .from('users')
            .select('username,phone_number')
            .eq('id', payment.user_id)
            .limit(1);
        const user = userRows && userRows[0];
        const { data: lessonRows } = await supabase
            .from('lessons')
            .select('title')
            .eq('id', payment.lesson_id)
            .limit(1);
        const lesson = lessonRows && lessonRows[0];
        if (user && user.phone_number) {
            const tierLabel = payment.access_type === 'video' ? 'single video'
                : payment.access_type === 'weekly' ? 'weekly access' + (durationDays > 0 ? ' (' + durationDays + ' days)' : '')
                : 'monthly access' + (durationDays > 0 ? ' (' + durationDays + ' days)' : '');
            const confirmMsg = [
                '✅ Payment Approved — Modern Skills',
                '',
                'Hi ' + (user.username || 'Student') + '!',
                'Your ' + tierLabel + ' payment has been approved.',
                payment.access_type === 'video'
                    ? 'You can now watch the lesson. JazakAllahu Khairan!'
                    : 'You now have access to all videos until ' + (expiresAt ? expiresAt.toLocaleDateString() : '') + '. JazakAllahu Khairan!'
            ].join('\n');
            sendSMSAsync(user.phone_number, confirmMsg);
        }

        res.json({ success: true, message: 'Payment approved' });
    } catch (err) {
        console.error('Payment approve error:', err.message || err);
        return fail(res, err, 'Could not approve the payment');
    }
});

// PATCH /api/payments/:id/reject — Admin rejects payment
router.patch('/:id/reject', authenticate, requireAdmin, async (req, res) => {
    try {
        const paymentId = parseInt(req.params.id, 10);
        const { note } = req.body;
        const { data: paymentRows } = await supabase
            .from('payments')
            .select('id')
            .eq('id', paymentId)
            .limit(1);
        const payment = paymentRows && paymentRows[0];
        if (!payment) {
            return res.status(404).json({ error: 'Payment not found' });
        }

        const { error: rejectError } = await supabase
            .from('payments')
            .update({
                status: 'rejected',
                admin_note: note || null,
                reviewed_at: new Date().toISOString()
            })
            .eq('id', paymentId);
        if (rejectError) throw rejectError;

        res.json({ success: true, message: 'Payment rejected' });
    } catch (err) {
        console.error('Payment reject error:', err.message || err);
        return fail(res, err, 'Could not reject the payment');
    }
});

// GET /api/payments/users — Admin lists all student users with access status
router.get('/users', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('v_users_with_access')
            .select('id,username,email,phone_number,full_name,created_at,is_active,has_access,pending_count,approved_count,current_access_type,access_expires_at')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ users: users || [] });
    } catch (err) {
        console.error('List users error:', err.message || err);
        return fail(res, err, 'Could not load students');
    }
});

// POST /api/payments/grant-access/:userId — Admin grants access to a user
router.post('/grant-access/:userId', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { data: userRows } = await supabase
            .from('users')
            .select('id,username')
            .eq('id', userId)
            .eq('role', 'student')
            .limit(1);
        const user = userRows && userRows[0];
        if (!user) return res.status(404).json({ error: 'Student not found' });

        // Any currently-active approved access (unexpired or never-expiring)?
        // Two safe filters (or() strings with dotted timestamps break parsing).
        const { data: expiring } = await supabase
            .from('payments')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'approved')
            .not('access_expires_at', 'is', null)
            .gt('access_expires_at', new Date().toISOString())
            .limit(1);
        const { data: neverExpiring } = await supabase
            .from('payments')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'approved')
            .is('access_expires_at', null)
            .limit(1);
        if ((expiring && expiring.length > 0) || (neverExpiring && neverExpiring.length > 0)) {
            return res.json({ success: true, message: 'User already has access' });
        }

        const { data: firstLessonRows } = await supabase
            .from('lessons')
            .select('id')
            .eq('is_published', true)
            .limit(1);
        const firstLesson = firstLessonRows && firstLessonRows[0];
        const lessonId = firstLesson ? firstLesson.id : 1;

        const { error: grantError } = await supabase
            .from('payments')
            .insert({
                user_id: userId,
                lesson_id: lessonId,
                transaction_code: 'ADMIN-GRANT',
                phone_number: 'admin',
                amount: 0,
                status: 'approved',
                reviewed_at: new Date().toISOString()
            });
        if (grantError) throw grantError;

        res.json({ success: true, message: 'Access granted to ' + user.username });
    } catch (err) {
        console.error('Grant access error:', err.message || err);
        return fail(res, err, 'Could not grant access');
    }
});

// POST /api/payments/revoke-access/:userId — Admin revokes access
router.post('/revoke-access/:userId', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        // Set all approved payments to rejected so they no longer grant access
        const { error: revokeError } = await supabase
            .from('payments')
            .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('status', 'approved');
        if (revokeError) throw revokeError;
        // Also deactivate the user's account
        const { error: deactivateError } = await supabase
            .from('users')
            .update({ is_active: false })
            .eq('id', userId);
        if (deactivateError) throw deactivateError;
        res.json({ success: true, message: 'Access revoked' });
    } catch (err) {
        console.error('Revoke access error:', err.message || err);
        return fail(res, err, 'Could not revoke access');
    }
});

// POST /api/payments/activate-user/:userId — Admin re-activates a user
router.post('/activate-user/:userId', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { error: activateError } = await supabase
            .from('users')
            .update({ is_active: true })
            .eq('id', userId);
        if (activateError) throw activateError;
        res.json({ success: true, message: 'User activated' });
    } catch (err) {
        console.error('Activate user error:', err.message || err);
        return fail(res, err, 'Could not activate the student');
    }
});

// POST /api/payments/deactivate-user/:userId — Admin deactivates a user
router.post('/deactivate-user/:userId', authenticate, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { error: deactivateError } = await supabase
            .from('users')
            .update({ is_active: false })
            .eq('id', userId);
        if (deactivateError) throw deactivateError;
        res.json({ success: true, message: 'User deactivated' });
    } catch (err) {
        console.error('Deactivate user error:', err.message || err);
        return fail(res, err, 'Could not deactivate the student');
    }
});

module.exports = router;