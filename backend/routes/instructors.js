const express = require('express');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('instructors')
            .select('id,name,slug,bio,avatar_url,expertise')
            .eq('is_active', true)
            .order('name', { ascending: true });
        if (error) throw error;
        res.json({ instructors: rows || [] });
    } catch (err) {
        console.error('Get instructors error:', err.message || err);
        return fail(res, err, 'Could not load instructors');
    }
});

router.get('/:slug', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('instructors')
            .select('id,name,slug,bio,avatar_url,expertise,created_at')
            .eq('slug', req.params.slug)
            .eq('is_active', true)
            .limit(1);
        if (error) throw error;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }

        const { data: lessons, error: lessonError } = await supabase
            .from('v_lessons_public')
            .select('*')
            .eq('instructor_id', rows[0].id)
            .order('created_at', { ascending: false });
        if (lessonError) throw lessonError;

        res.json({ instructor: rows[0], lessons: lessons || [] });
    } catch (err) {
        console.error('Get instructor error:', err.message || err);
        return fail(res, err, 'Could not load the instructor');
    }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, slug, bio, avatarUrl, expertise } = req.body;
        if (!name || !slug) {
            return res.status(400).json({ error: 'Name and slug are required' });
        }

        const { data: inserted, error } = await supabase
            .from('instructors')
            .insert({
                name,
                slug,
                bio: bio || null,
                avatar_url: avatarUrl || null,
                expertise: expertise || null
            })
            .select('id')
            .single();
        if (error) throw error;

        res.status(201).json({ message: 'Instructor created', id: inserted.id });
    } catch (err) {
        console.error('Create instructor error:', err.message || err);
        return fail(res, err, 'Could not create the instructor');
    }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, slug, bio, avatarUrl, expertise, isActive } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (slug !== undefined) updates.slug = slug;
        if (bio !== undefined) updates.bio = bio;
        if (avatarUrl !== undefined) updates.avatar_url = avatarUrl;
        if (expertise !== undefined) updates.expertise = expertise;
        if (isActive !== undefined) updates.is_active = !!isActive;

        const { data: updated, error } = await supabase
            .from('instructors')
            .update(updates)
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }
        res.json({ message: 'Instructor updated' });
    } catch (err) {
        console.error('Update instructor error:', err.message || err);
        return fail(res, err, 'Could not update the instructor');
    }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: deleted, error } = await supabase
            .from('instructors')
            .delete()
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            return res.status(404).json({ error: 'Instructor not found' });
        }
        res.json({ message: 'Instructor deleted' });
    } catch (err) {
        console.error('Delete instructor error:', err.message || err);
        return fail(res, err, 'Could not delete the instructor');
    }
});

module.exports = router;