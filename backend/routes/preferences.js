const express = require('express');
const { supabase } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('user_preferences')
            .select('pref_key,pref_value')
            .eq('user_id', req.user.id);
        if (error) throw error;
        const prefs = {};
        (rows || []).forEach(r => { prefs[r.pref_key] = r.pref_value; });
        res.json({ preferences: prefs });
    } catch (err) {
        console.error('Get preferences error:', err.message || err);
        return fail(res, err, 'Could not load preferences');
    }
});

router.put('/', authenticate, async (req, res) => {
    try {
        const { key, value } = req.body;
        if (!key) {
            return res.status(400).json({ error: 'Key is required' });
        }
        const { error } = await supabase
            .from('user_preferences')
            .upsert(
                { user_id: req.user.id, pref_key: key, pref_value: value },
                { onConflict: 'user_id,pref_key' }
            );
        if (error) throw error;
        res.json({ message: 'Preference saved' });
    } catch (err) {
        console.error('Save preference error:', err.message || err);
        return fail(res, err, 'Could not save the preference');
    }
});

module.exports = router;