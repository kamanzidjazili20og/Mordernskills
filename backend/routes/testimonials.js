const express = require('express');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('testimonials')
            .select('id,name_en,name_rw,role_en,role_rw,text_en,text_rw,initials,rating,sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        res.json({ testimonials: rows || [] });
    } catch (err) {
        console.error('Get testimonials error:', err.message || err);
        return fail(res, err, 'Could not load testimonials');
    }
});

router.get('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('testimonials')
            .select('*')
            .order('sort_order', { ascending: true });
        if (error) throw error;
        res.json({ testimonials: rows || [] });
    } catch (err) {
        console.error('Get admin testimonials error:', err.message || err);
        return fail(res, err, 'Could not load testimonials');
    }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { nameEn, nameRw, roleEn, roleRw, textEn, textRw, initials, rating, sortOrder } = req.body;
        if (!nameEn || !textEn) {
            return res.status(400).json({ error: 'Name and text (English) are required' });
        }
        const { data: inserted, error } = await supabase
            .from('testimonials')
            .insert({
                name_en: nameEn,
                name_rw: nameRw || nameEn,
                role_en: roleEn || '',
                role_rw: roleRw || '',
                text_en: textEn,
                text_rw: textRw || textEn,
                initials: initials || nameEn.charAt(0).toUpperCase(),
                rating: rating || 5,
                sort_order: sortOrder || 0
            })
            .select('id')
            .single();
        if (error) throw error;
        res.status(201).json({ message: 'Testimonial created', id: inserted.id });
    } catch (err) {
        console.error('Create testimonial error:', err.message || err);
        return fail(res, err, 'Could not create the testimonial');
    }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { nameEn, nameRw, roleEn, roleRw, textEn, textRw, initials, rating, sortOrder, isActive } = req.body;
        const updates = {};
        if (nameEn !== undefined) updates.name_en = nameEn;
        if (nameRw !== undefined) updates.name_rw = nameRw;
        if (roleEn !== undefined) updates.role_en = roleEn;
        if (roleRw !== undefined) updates.role_rw = roleRw;
        if (textEn !== undefined) updates.text_en = textEn;
        if (textRw !== undefined) updates.text_rw = textRw;
        if (initials !== undefined) updates.initials = initials;
        if (rating !== undefined) updates.rating = rating;
        if (sortOrder !== undefined) updates.sort_order = sortOrder;
        if (isActive !== undefined) updates.is_active = !!isActive;

        const { data: updated, error } = await supabase
            .from('testimonials')
            .update(updates)
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Testimonial not found' });
        }
        res.json({ message: 'Testimonial updated' });
    } catch (err) {
        console.error('Update testimonial error:', err.message || err);
        return fail(res, err, 'Could not update the testimonial');
    }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: deleted, error } = await supabase
            .from('testimonials')
            .delete()
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            return res.status(404).json({ error: 'Testimonial not found' });
        }
        res.json({ message: 'Testimonial deleted' });
    } catch (err) {
        console.error('Delete testimonial error:', err.message || err);
        return fail(res, err, 'Could not delete the testimonial');
    }
});

module.exports = router;