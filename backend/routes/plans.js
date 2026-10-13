const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const { ACCESS_TYPES, getPlans, savePlan } = require('../services/plans');

// GET /api/plans — Public. Prices/durations the checkout page renders and the
// amounts a payment submission is priced at.
router.get('/', async (req, res) => {
    try {
        res.json({ plans: await getPlans() });
    } catch (err) {
        console.error('Plans list error:', err.message || err);
        return fail(res, err, 'Could not load plans');
    }
});

// PATCH /api/plans/:accessType — Admin. Update one plan's price and/or length.
// `durationDays` is ignored for the single-video tier (always never-expires).
router.patch('/:accessType', authenticate, requireAdmin, async (req, res) => {
    try {
        const accessType = req.params.accessType;
        if (!ACCESS_TYPES.includes(accessType)) {
            return res.status(400).json({ error: 'Invalid access type. Must be: video, weekly, or monthly' });
        }

        let price;
        if (req.body.price !== undefined) {
            price = Number(req.body.price);
            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({ error: 'price must be a non-negative number' });
            }
        }

        let durationDays;
        if (accessType !== 'video' && req.body.durationDays !== undefined) {
            if (req.body.durationDays === null || req.body.durationDays === '') {
                durationDays = null;
            } else {
                durationDays = parseInt(req.body.durationDays, 10);
                if (!Number.isFinite(durationDays) || durationDays <= 0) {
                    return res.status(400).json({ error: 'durationDays must be a positive number' });
                }
            }
        }

        if (price === undefined && durationDays === undefined) {
            return res.status(400).json({ error: 'Nothing to update (send price and/or durationDays)' });
        }

        const saved = await savePlan(accessType, { price, durationDays });

        res.json({ success: true, source: saved.source, plans: await getPlans() });
    } catch (err) {
        console.error('Plan update error:', err.message || err);
        return fail(res, err, 'Could not update the plan');
    }
});

module.exports = router;
