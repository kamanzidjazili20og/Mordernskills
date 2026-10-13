const express = require('express');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');

const router = express.Router();

const BOOK_FIELDS = 'id,title,author,description,cover_url,content,language,sort_order,is_published,created_at,updated_at';

// GET /api/books — public list of published books (bodies omitted; the reader
// fetches the full content by id so the listing stays light).
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('books')
            .select('id,title,author,description,cover_url,language,sort_order,is_published,created_at')
            .eq('is_published', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ books: data || [] });
    } catch (err) {
        console.error('Get books error:', err.message || err);
        return fail(res, err, 'Could not load books');
    }
});

// GET /api/books/admin/all — admin list including drafts and full bodies.
// Declared before /:id so "admin" is never parsed as an id.
router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('books')
            .select(BOOK_FIELDS)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json({ books: data || [] });
    } catch (err) {
        console.error('Admin get books error:', err.message || err);
        return fail(res, err, 'Could not load books');
    }
});

// GET /api/books/:id — full book content for the public reader.
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: 'Invalid book id' });

        const { data, error } = await supabase
            .from('books')
            .select(BOOK_FIELDS)
            .eq('id', id)
            .limit(1);
        if (error) throw error;
        const book = data && data[0];
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!book.is_published) {
            return res.status(404).json({ error: 'Book not found' });
        }
        res.json({ book });
    } catch (err) {
        console.error('Get book error:', err.message || err);
        return fail(res, err, 'Could not load the book');
    }
});

// POST /api/books — admin creates a book.
router.post('/', authenticate, requireAdmin, async (req, res) => {
    try {
        const { title, author, description, coverUrl, content, language, sortOrder, isPublished } = req.body;
        if (!title || !String(title).trim()) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const { data: inserted, error } = await supabase
            .from('books')
            .insert({
                title: String(title).trim(),
                author: author || null,
                description: description || null,
                cover_url: coverUrl || null,
                content: content || null,
                language: language || 'en',
                sort_order: Number(sortOrder) || 0,
                is_published: isPublished === undefined ? true : !!isPublished
            })
            .select('id')
            .single();
        if (error) throw error;

        res.status(201).json({ message: 'Book created', id: inserted.id });
    } catch (err) {
        console.error('Create book error:', err.message || err);
        return fail(res, err, 'Could not create the book');
    }
});

// PUT /api/books/:id — admin updates a book.
router.put('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { title, author, description, coverUrl, content, language, sortOrder, isPublished } = req.body;
        const updates = {};
        if (title !== undefined) updates.title = String(title).trim();
        if (author !== undefined) updates.author = author || null;
        if (description !== undefined) updates.description = description || null;
        if (coverUrl !== undefined) updates.cover_url = coverUrl || null;
        if (content !== undefined) updates.content = content || null;
        if (language !== undefined) updates.language = language || 'en';
        if (sortOrder !== undefined) updates.sort_order = Number(sortOrder) || 0;
        if (isPublished !== undefined) updates.is_published = !!isPublished;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'Nothing to update' });
        }

        const { data: updated, error } = await supabase
            .from('books')
            .update(updates)
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        res.json({ message: 'Book updated' });
    } catch (err) {
        console.error('Update book error:', err.message || err);
        return fail(res, err, 'Could not update the book');
    }
});

// DELETE /api/books/:id — admin deletes a book.
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
    try {
        const { data: deleted, error } = await supabase
            .from('books')
            .delete()
            .eq('id', parseInt(req.params.id, 10))
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            return res.status(404).json({ error: 'Book not found' });
        }
        res.json({ message: 'Book deleted' });
    } catch (err) {
        console.error('Delete book error:', err.message || err);
        return fail(res, err, 'Could not delete the book');
    }
});

module.exports = router;
