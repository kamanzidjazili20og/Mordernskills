const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { supabase } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const { uploadAvatar } = require('../middleware/upload');
const { authRateLimit } = require('../middleware/security');
const { uploadAvatarToSupabase, enabled: supabaseStorageEnabled } = require('../services/supabase');
const { secret, expiresIn } = require('../config/jwt');

const router = express.Router();

// Credential endpoints get a much tighter ceiling than the rest of the
// API. Registration is included because an open endpoint that bcrypts
// every request is a cheap way to pin a core at 100% CPU.
router.post('/register', authRateLimit, uploadAvatar.single('avatar'), [
    body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('fullName').trim().notEmpty().withMessage('Full name is required'),
    body('phone').optional({ checkFalsy: true }).trim().isLength({ min: 5 }).withMessage('Enter a valid phone number')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { username, email, password, fullName, phone } = req.body;

        let avatarUrl = null;
        if (req.file) {
            if (supabaseStorageEnabled) {
                avatarUrl = await uploadAvatarToSupabase(req.file);
            } else {
                const fs = require('fs');
                const path = require('path');
                const { v4: uuidv4 } = require('uuid');
                const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
                const dir = path.join(__dirname, '..', 'uploads', 'avatars');
                fs.mkdirSync(dir, { recursive: true });
                const filename = `avatar_${uuidv4()}${ext}`;
                fs.writeFileSync(path.join(dir, filename), req.file.buffer);
                avatarUrl = `/uploads/avatars/${filename}`;
            }
        }

        // .eq() values are URL-encoded by supabase-js, so emails with '.', '@'
        // and other characters are compared safely (or() string syntax would
        // misinterpret unquoted dots).
        const { data: byEmail } = await supabase
            .from('users')
            .select('id')
            .eq('email', email)
            .limit(1);
        const { data: byUsername } = await supabase
            .from('users')
            .select('id')
            .eq('username', username)
            .limit(1);
        if ((byEmail && byEmail.length > 0) || (byUsername && byUsername.length > 0)) {
            return res.status(409).json({ error: 'Username or email already exists' });
        }

        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const { data: inserted, error: insertError } = await supabase
            .from('users')
            .insert({
                username,
                email,
                password_hash: passwordHash,
                full_name: fullName,
                phone_number: phone || null,
                role: 'student',
                avatar_url: avatarUrl
            })
            .select('id,username,email,full_name,phone_number,role,avatar_url')
            .single();
        if (insertError) throw insertError;

        const userId = inserted.id;

        const token = jwt.sign(
            { id: userId, username, email, role: 'student' },
            secret,
            { expiresIn }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                id: userId,
                username: inserted.username,
                email: inserted.email,
                fullName: inserted.full_name,
                phoneNumber: inserted.phone_number || null,
                role: inserted.role,
                avatarUrl: inserted.avatar_url
            }
        });
    } catch (err) {
        console.error('Register error:', err.message || err);
        return fail(res, err, 'Could not create the account');
    }
});

router.post('/login', authRateLimit, [
    body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .limit(1);
        if (error) throw error;

        const user = users && users.length ? users[0] : null;

        // Compare against a throwaway hash when the account does not exist,
        // so a wrong email and a wrong password take the same amount of
        // time. Returning early used to make "no such user" measurably
        // faster, which turns the login form into an account-enumeration
        // oracle.
        const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
        let isMatch = false;
        try {
            isMatch = await bcrypt.compare(password, (user && user.password_hash) || DUMMY_HASH);
        } catch (e) {
            // A row with no usable hash (legacy import) must fail as a
            // normal login error, not as a 500.
            console.error('Password hash could not be compared for', email, '-', e.message);
            isMatch = false;
        }

        if (!user || !isMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Only an explicit `false` deactivates. `!user.is_active` also
        // locked out rows where the column is NULL (older MySQL imports).
        if (user.is_active === false) {
            return res.status(403).json({ error: 'Account is deactivated' });
        }

        try {
            await supabase
                .from('users')
                .update({ last_login: new Date().toISOString() })
                .eq('id', user.id);
        } catch (e) {
            console.error('Could not update last_login:', e.message);
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, role: user.role },
            secret,
            { expiresIn }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                fullName: user.full_name,
                phoneNumber: user.phone_number || null,
                role: user.role,
                avatarUrl: user.avatar_url
            }
        });
    } catch (err) {
        console.error('Login error:', err.message || err);
        return fail(res, err, 'Could not sign in');
    }
});

router.get('/me', authenticate, async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('id,username,email,full_name,phone_number,role,avatar_url,last_login,created_at')
            .eq('id', req.user.id)
            .limit(1);
        if (error) throw error;
        if (!users || users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: users[0] });
    } catch (err) {
        console.error('Get me error:', err.message || err);
        return fail(res, err, 'Could not load your profile');
    }
});

module.exports = router;