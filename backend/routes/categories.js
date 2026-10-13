const express = require('express');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');

const router = express.Router();

// PostgREST .or() filters are comma-separated, so a comma or a paren inside
// user input would silently break the whole filter and return a 400. Strip the
// structural characters and neutralise LIKE wildcards as well.
function escapeLike(value) {
    return String(value == null ? '' : value)
        .replace(/[%_\\,().*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

router.get('/', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('categories')
            .select('id,name,slug,description,icon_class,color,sort_order')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;

        // Attach the published-lesson count so the homepage can show an
        // accurate "N lessons" badge. Older deployments may not have
        // v_category_stats, so a failure here degrades to lesson_count = null
        // rather than breaking the whole listing.
        let counts = {};
        try {
            const { data: stats, error: statsError } = await supabase
                .from('v_category_stats')
                .select('id,lesson_count');
            if (!statsError && stats) {
                counts = (stats || []).reduce((acc, s) => {
                    acc[s.id] = Number(s.lesson_count) || 0;
                    return acc;
                }, {});
            }
        } catch (e) {
            console.warn('Could not read v_category_stats:', e.message || e);
        }

        const categories = (rows || []).map(c => Object.assign({}, c, {
            lesson_count: counts[c.id] != null ? counts[c.id] : null
        }));

        res.json({ categories });
    } catch (err) {
        console.error('Get categories error:', err.message || err);
        return fail(res, err, 'Could not load categories');
    }
});

router.get('/:slug', async (req, res) => {
    try {
        const { search, difficulty, instructor, sort = 'newest' } = req.query;

        const { data: rows, error } = await supabase
            .from('categories')
            .select('id,name,slug,description,icon_class,color,sort_order')
            .eq('slug', req.params.slug)
            .eq('is_active', true)
            .limit(1);
        if (error) throw error;
        if (!rows || rows.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        const category = rows[0];

        let query = supabase
            .from('v_lessons_public')
            .select('*')
            .eq('category_id', category.id);

        if (difficulty) query = query.eq('difficulty', difficulty);
        if (instructor) query = query.eq('instructor_slug', instructor);
        if (search) {
            const q = escapeLike(search);
            // A search made only of stripped punctuation must not become a
            // "match everything" filter; fall back to the unfiltered listing.
            if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
        }

        // Only column names that exist on v_lessons_public are accepted, so a
        // hand-edited query string cannot inject an arbitrary ORDER BY.
        switch (sort) {
            case 'az': query = query.order('title', { ascending: true }); break;
            case 'za': query = query.order('title', { ascending: false }); break;
            case 'rating': query = query.order('rating', { ascending: false, nullsFirst: false }); break;
            case 'students': query = query.order('student_count', { ascending: false, nullsFirst: false }); break;
            case 'oldest': query = query.order('created_at', { ascending: true }); break;
            case 'newest':
            default: query = query.order('created_at', { ascending: false });
        }

        const { data: lessons, error: lessonError } = await query;
        if (lessonError) throw lessonError;

        // Aggregate the category stats in one pass so the page header can show
        // totals, instructor roster and total watch time.
        const list = lessons || [];
        const stats = { lessonCount: list.length, totalMinutes: 0, totalStudents: 0, instructors: [] };
        const seen = new Map();
        list.forEach(l => {
            stats.totalMinutes += Number(l.duration_minutes) || 0;
            stats.totalStudents += Number(l.student_count) || 0;
            if (l.instructor_name && !seen.has(l.instructor_name)) {
                seen.set(l.instructor_name, {
                    name: l.instructor_name,
                    slug: l.instructor_slug || null,
                    lessons: 0
                });
            }
            if (l.instructor_name) seen.get(l.instructor_name).lessons++;
        });
        stats.instructors = Array.from(seen.values())
            .sort((a, b) => b.lessons - a.lessons || String(a.name).localeCompare(String(b.name)));

        res.json({ category, lessons: list, stats });
    } catch (err) {
        console.error('Get category error:', err.message || err);
        return fail(res, err, 'Could not load the category');
    }
});

router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, slug, description, iconClass, color, sortOrder } = req.body;
        if (!name || !slug) {
            return res.status(400).json({ error: 'Name and slug are required' });
        }

        const { data: inserted, error } = await supabase
            .from('categories')
            .insert({
                name,
                slug,
                description: description || null,
                icon_class: iconClass || null,
                color: color || null,
                sort_order: sortOrder || 0
            })
            .select('id')
            .single();
        if (error) throw error;

        res.status(201).json({ message: 'Category created', id: inserted.id });
    } catch (err) {
        console.error('Create category error:', err.message || err);
        return fail(res, err, 'Could not create the category');
    }
});

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { name, slug, description, iconClass, color, sortOrder, isActive } = req.body;
        const updates = {};
        if (name !== undefined) updates.name = name;
        if (slug !== undefined) updates.slug = slug;
        if (description !== undefined) updates.description = description;
        if (iconClass !== undefined) updates.icon_class = iconClass;
        if (color !== undefined) updates.color = color;
        if (sortOrder !== undefined) updates.sort_order = sortOrder;
        if (isActive !== undefined) updates.is_active = !!isActive;

        const { data: updated, error } = await supabase
            .from('categories')
            .update(updates)
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({ message: 'Category updated' });
    } catch (err) {
        console.error('Update category error:', err.message || err);
        return fail(res, err, 'Could not update the category');
    }
});

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: deleted, error } = await supabase
            .from('categories')
            .delete()
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            return res.status(404).json({ error: 'Category not found' });
        }
        res.json({ message: 'Category deleted' });
    } catch (err) {
        console.error('Delete category error:', err.message || err);
        return fail(res, err, 'Could not delete the category');
    }
});

module.exports = router;