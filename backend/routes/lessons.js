const express = require('express');
const slugify = require('slugify');
const { body, param, validationResult } = require('express-validator');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { fail } = require('../middleware/errors');
const { env } = require('../config/env');

const router = express.Router();

/**
 * PostgREST `.or()` filters are comma-separated and parenthesised, and
 * `%` / `_` are LIKE wildcards. User input containing any of those
 * characters silently corrupts the filter and comes back as a 400
 * ("unexpected `,`"), so strip the structural characters and escape
 * the wildcards. `routes/categories.js` already did this; the lesson
 * search did not, which is why a search for a title with a comma
 * ("Tajweed: noon & meem, part 1") failed.
 */
function escapeLike(value) {
    return String(value == null ? '' : value)
        .replace(/[%_\\,().*'"`]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

/** Cap the page size. `?limit=100000` was enough to try to pull the table. */
function parsePaging(query, defaultLimit, maxLimit) {
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const requested = parseInt(query.limit, 10) || defaultLimit;
    const limit = Math.min(Math.max(1, requested), maxLimit);
    return { page, limit, offset: (page - 1) * limit };
}

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced', 'All Levels'];

/**
 * The public listing has to answer one question for the homepage card:
 * "does this lesson actually have a video, and can I preview it?"
 *
 * `v_lessons_public` does not carry `video_url` / `video_file_path`, and
 * asking PostgREST for a column a view does not have fails the whole
 * request with 42703. Rather than force a schema migration on every
 * deployment, read the two columns off the base `lessons` table in one
 * extra query keyed on the ids already in hand.
 *
 * Free lessons get the URL so the card can play a hover preview. Paid
 * lessons only report `has_video` — a marketplace page should not hand
 * out the stream URL of something the visitor still has to pay for.
 */
async function attachVideoInfo(rows, options) {
    // `stripPaidVideo` is only for the public *list*. The detail route feeds
    // the player in video.html, which resolves the stream URL after a payment
    // is approved — stripping it there would break playback.
    const stripPaidVideo = Boolean(options && options.stripPaidVideo);
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return list;

    const needsLookup = list.some(l => l && l.has_video === undefined);
    if (!needsLookup) return list;

    const ids = list.map(l => l.id).filter(id => Number.isInteger(id) || /^\d+$/.test(String(id)));
    if (!ids.length) return list;

    let videos = [];
    try {
        const { data, error } = await supabase
            .from('lessons')
            .select('id,video_url,video_file_path,is_free')
            .in('id', ids);
        if (error) throw error;
        videos = data || [];
    } catch (err) {
        // The homepage degrades to "no video" rather than failing entirely.
        console.warn('Could not load video info for lessons:', err.message || err);
        videos = [];
    }

    const byId = new Map(videos.map(v => [String(v.id), v]));
    return list.map((l) => {
        if (!l || l.has_video !== undefined) return l;
        const v = byId.get(String(l.id)) || {};
        // The view may already carry the columns (after re-running Schrema.sql);
        // the base-table read fills in for deployments that have not.
        const url = v.video_file_path || v.video_url || l.video_file_path || l.video_url || null;
        // A lesson is only handed its stream URL when explicitly marked free.
        // Price 0 no longer implies free: unpaid videos are paid by default, so
        // the full stream URL must not leak to the public catalogue. The detail
        // route (video.html) is unaffected — it does not strip the URL.
        const isFree = v.is_free === true || l.is_free === 1 || l.is_free === true;
        const out = Object.assign({}, l, {
            has_video: Boolean(url),
            // The source is only handed out for lessons anyone may watch
            // anyway; a paid lesson advertises the video without leaking it.
            video_preview_url: url && isFree && env.exposeFreeVideoUrls ? url : null
        });
        if (stripPaidVideo && (!isFree || !env.exposeFreeVideoUrls)) {
            delete out.video_url;
            delete out.video_file_path;
        }
        return out;
    });
}

router.get('/', async (req, res) => {
    try {
        const { category, difficulty, instructor, search, featured, free, sort } = req.query;
        const { page, limit, offset } = parsePaging(req.query, 12, 200);

        let query = supabase
            .from('v_lessons_public')
            .select('*', { count: 'exact' });

        if (category) query = query.eq('category_slug', String(category).slice(0, 100));
        if (difficulty && DIFFICULTIES.includes(String(difficulty))) query = query.eq('difficulty', difficulty);
        if (instructor) query = query.eq('instructor_slug', String(instructor).slice(0, 100));
        if (featured === 'true') query = query.eq('is_featured', 1);
        if (free === 'true') query = query.eq('is_free', 1);
        if (search) {
            const q = escapeLike(search);
            // A search made only of stripped punctuation must not turn into
            // a "match everything" filter.
            if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
        }

        // Only real column names are accepted, so a hand-edited sort value
        // cannot turn into an arbitrary ORDER BY (which PostgREST would
        // answer with a 400).
        switch (sort) {
            case 'az': query = query.order('title', { ascending: true }); break;
            case 'za': query = query.order('title', { ascending: false }); break;
            case 'rating': query = query.order('rating', { ascending: false, nullsFirst: false }); break;
            case 'students': query = query.order('student_count', { ascending: false, nullsFirst: false }); break;
            case 'oldest': query = query.order('created_at', { ascending: true }); break;
            case 'newest':
            default: query = query.order('created_at', { ascending: false });
        }

        query = query.range(offset, offset + limit - 1);

        const { data: rows, count: total, error } = await query;
        if (error) throw error;

        const lessons = await attachVideoInfo(rows || [], { stripPaidVideo: true });

        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.json({
            lessons,
            pagination: {
                page,
                limit,
                total: total || 0,
                totalPages: Math.ceil((total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('Get lessons error:', err.message || err);
        return fail(res, err, 'Could not load lessons');
    }
});

router.get('/recent', async (req, res) => {
    try {
        const { data: rows, error } = await supabase
            .from('v_lessons_public')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(8);
        if (error) throw error;
        const lessons = await attachVideoInfo(rows || [], { stripPaidVideo: true });
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.json({ lessons });
    } catch (err) {
        console.error('Get recent lessons error:', err.message || err);
        return fail(res, err, 'Could not load recent lessons');
    }
});

// Postgres folds unquoted identifiers to lower case, so a view column defined
// as `totalLessons` is returned as `totallessons`. Read either spelling.
function pick(row, camel) {
    if (!row) return undefined;
    if (row[camel] !== undefined) return row[camel];
    return row[camel.toLowerCase()];
}

router.get('/stats', async (req, res) => {
    try {
        // Count all lessons (not just published)
        const [totalLessons, totalStudents, totalInstructors, avgRating, thisMonth] = await Promise.all([
            countRows('lessons'),
            sumColumn('lessons', 'student_count'),
            countRows('instructors', 'is_active', true),
            averageRating(),
            countLessonsThisMonth()
        ]);

        // Get category stats - try view first, fallback to manual query
        let categoryStats = [];
        try {
            const { data, error } = await supabase
                .from('v_category_stats')
                .select('*');
            if (!error && data) {
                categoryStats = data;
            }
        } catch (viewErr) {
            console.warn('v_category_stats view failed, using fallback:', viewErr.message);
            // Fallback: manual query
            const { data: cats, error: catErr } = await supabase
                .from('categories')
                .select('id,name,slug,color,sort_order')
                .eq('is_active', true)
                .order('sort_order', { ascending: true });
            if (!catErr && cats) {
                for (const c of cats) {
                    const { count } = await supabase
                        .from('lessons')
                        .select('*', { count: 'exact', head: true })
                        .eq('category_id', c.id);
                    categoryStats.push({ ...c, lesson_count: count || 0 });
                }
            }
        }

        const ordered = categoryStats.slice().sort((a, b) => {
            const sa = pick(a, 'sort_order');
            const sb = pick(b, 'sort_order');
            if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
            if (sa !== undefined && sb === undefined) return -1;
            if (sa === undefined && sb !== undefined) return 1;
            return String(a.name || '').localeCompare(String(b.name || ''));
        });

        res.json({
            stats: {
                totalLessons,
                totalStudents,
                totalInstructors,
                avgRating,
                pendingReview: 0,
                thisMonth
            },
            categoryStats: ordered
        });
    } catch (err) {
        console.error('Get stats error:', err.message || err);
        return fail(res, err, 'Could not load dashboard statistics');
    }
});

async function countRows(table, column, value) {
    let query = supabase.from(table).select('*', { count: 'exact', head: true });
    if (column && value !== undefined) {
        query = query.eq(column, value);
    }
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
}

async function sumColumn(table, column) {
    const { data, error } = await supabase.from(table).select(column);
    if (error) throw error;
    return (data || []).reduce((total, row) => total + (Number(row[column]) || 0), 0);
}

async function averageRating() {
    const { data, error } = await supabase
        .from('lessons')
        .select('rating')
        .eq('is_published', true)
        .gt('rating', 0);
    if (error) throw error;
    const rows = data || [];
    if (!rows.length) return 0;
    const total = rows.reduce((sum, row) => sum + (Number(row.rating) || 0), 0);
    return Math.round((total / rows.length) * 10) / 10;
}

async function countLessonsThisMonth() {
    const { count, error } = await supabase
        .from('lessons')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfCurrentMonth());
    if (error) throw error;
    return count || 0;
}

function startOfCurrentMonth() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

router.get('/admin', authenticate, requireAdmin, async (req, res) => {
    try {
        const { page, limit, offset } = parsePaging(req.query, 10, 100);

        const { data: rows, count: total, error } = await supabase
            .from('v_lessons_admin')
            .select('*', { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) throw error;

        res.setHeader('Cache-Control', 'no-store');
        res.json({
            lessons: rows || [],
            pagination: {
                page,
                limit,
                total: total || 0,
                totalPages: Math.ceil((total || 0) / limit)
            }
        });
    } catch (err) {
        console.error('Get admin lessons error:', err.message || err);
        return fail(res, err, 'Could not load lessons');
    }
});

router.get('/:slug', async (req, res) => {
    try {
        const key = req.params.slug;
        const isId = /^\d+$/.test(key);

        let query = supabase
            .from('v_lesson_detail')
            .select('*');
        query = isId ? query.eq('id', parseInt(key, 10)) : query.eq('slug', key);

        const { data: rows, error } = await query.maybeSingle();
        if (error) throw error;
        if (!rows) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        // Tags are decoration, not the lesson: a failure here must not
        // turn a working lesson page into a 500.
        let tags = [];
        try {
            const { data: tagRows, error: tagError } = await supabase
                .from('lesson_tags')
                .select('tags(id,name,slug)')
                .eq('lesson_id', rows.id);
            if (tagError) throw tagError;
            tags = (tagRows || []).map(r => r.tags).filter(Boolean);
        } catch (tagErr) {
            console.warn('Could not load tags for lesson', rows.id, '-', tagErr.message || tagErr);
        }

        const lesson = await attachVideoInfo([rows]).then(list => list[0]);
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
        res.json({ lesson, tags });
    } catch (err) {
        console.error('Get lesson error:', err.message || err);
        return fail(res, err, 'Could not load the lesson');
    }
});

/**
 * Shared write validation. `express-validator` is already a dependency
 * (routes/auth.js uses it) but every lesson write path trusted the body
 * completely, so an empty title, a 4000-character slug source or a
 * `rating` of 999 went straight into Postgres and surfaced later as an
 * opaque 23505/23514 from deep inside the driver.
 */
const writeValidators = [
    body('title')
        .exists({ values: 'falsy' }).withMessage('Title is required')
        .isString().withMessage('Title must be text')
        .trim()
        .isLength({ min: 3, max: 200 }).withMessage('Title must be 3-200 characters'),
    body('description')
        .optional()
        .isString().withMessage('Description must be text')
        .trim()
        .isLength({ max: 20000 }).withMessage('Description is too long'),
    body('categoryId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Category must be a valid id'),
    body('instructorId').optional({ nullable: true }).isInt({ min: 1 }).withMessage('Instructor must be a valid id'),
    body('difficulty').optional().isIn(DIFFICULTIES).withMessage(`Difficulty must be one of: ${DIFFICULTIES.join(', ')}`),
    body('language').optional().isIn(['en', 'rw', 'ar']).withMessage('Language must be one of: en, rw, ar'),
    body('durationMinutes').optional({ nullable: true }).isInt({ min: 0, max: 100000 }).withMessage('Duration must be whole minutes'),
    body('videoUrl').optional({ nullable: true }).isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('Video URL must be a valid http(s) URL'),
    body('videoFilePath').optional({ nullable: true }).isString().withMessage('Video file path must be text'),
    body('thumbnailUrl').optional({ nullable: true }).isString().withMessage('Thumbnail must be text'),
    body('rating').optional({ nullable: true }).isFloat({ min: 0, max: 5 }).withMessage('Rating must be between 0 and 5'),
    body('studentCount').optional({ nullable: true }).isInt({ min: 0, max: 10000000 }).withMessage('Student count must be a positive whole number'),
    body('price').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Price cannot be negative'),
    body('tags').optional().isArray({ max: 20 }).withMessage('At most 20 tags are allowed')
];

function rejectInvalid(res, errors) {
    if (errors.isEmpty()) return false;
    return res.status(400).json({ error: 'Please fix the highlighted fields.', errors: errors.array() });
}

/**
 * `parseInt('abc')` is NaN, and `.eq('id', NaN)` was sent to PostgREST as
 * `id=eq.NaN` — a confusing 4xx/5xx for what is really a bad URL.
 * Every id-bearing route now goes through here.
 */
function parseId(req, res) {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) {
        res.status(400).json({ error: 'Lesson id must be a positive whole number.' });
        return null;
    }
    return id;
}

const idValidators = [param('id').isInt({ min: 1 }).withMessage('Lesson id must be a positive whole number')];

function checkId(res, errors) {
    return errors.isEmpty() ? null : res.status(400).json({ error: errors.array()[0].msg });
}

/**
 * PostgREST PGRST204 "Could not find the '<col>' column" means the live
 * database predates a schema addition. Callers drop the column and retry
 * so writes keep working until Schrema.sql is re-run.
 */
function isMissingColumnError(err, column) {
    if (!err) return false;
    if (err.code === 'PGRST204') return true;
    const msg = String(err.message || '');
    return /could not find/i.test(msg) && msg.toLowerCase().includes(String(column).toLowerCase());
}

router.post('/', authenticate, requireAdmin, writeValidators, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (rejectInvalid(res, errors)) return;

        const {
            title, description, categoryId, instructorId, difficulty, language,
            durationMinutes, videoUrl, videoFilePath, thumbnailUrl, isFree, isFeatured,
            rating, studentCount, price, isPublished,
            tags: tagNames
        } = req.body;

        const finalVideoUrl = videoFilePath ? null : (videoUrl || null);

        let slug = slugify(title, { lower: true, strict: true });
        if (!slug) slug = `lesson-${Date.now()}`;
        const { data: existing } = await supabase
            .from('lessons')
            .select('id')
            .eq('slug', slug)
            .maybeSingle();
        if (existing) {
            // A raw Date.now() suffix can still collide inside the same
            // millisecond; the unique index is the real guarantee, so at
            // least make a second collision very unlikely.
            slug = `${slug}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        }

        const lessonPayload = {
            title,
            slug,
            description: description || null,
            category_id: categoryId || null,
            instructor_id: instructorId || null,
            difficulty: difficulty || 'All Levels',
            language: language || 'rw',
            duration_minutes: durationMinutes || null,
            video_url: finalVideoUrl || null,
            video_file_path: videoFilePath || null,
            thumbnail_url: thumbnailUrl || null,
            rating: rating == null ? 0.0 : rating,
            student_count: studentCount == null ? 0 : studentCount,
            is_free: !!isFree,
            is_featured: !!isFeatured,
            price: price || 0,
            is_published: !!isPublished,
            published_at: isPublished ? new Date().toISOString() : null
        };

        // If the live database predates the `language` column (Schrema.sql
        // not re-run yet), PostgREST answers PGRST204. Drop the column and
        // retry so the upload still saves instead of failing outright.
        let inserted = null;
        {
            const attempt = await supabase
                .from('lessons')
                .insert(lessonPayload)
                .select('id')
                .single();
            if (attempt.error && isMissingColumnError(attempt.error, 'language')) {
                console.warn('lessons.language column missing — saving without it. Re-run supabase/Schrema.sql.');
                delete lessonPayload.language;
                const retry = await supabase
                    .from('lessons')
                    .insert(lessonPayload)
                    .select('id')
                    .single();
                if (retry.error) throw retry.error;
                inserted = retry.data;
            } else if (attempt.error) {
                throw attempt.error;
            } else {
                inserted = attempt.data;
            }
        }
        const lessonId = inserted.id;

        if (tagNames && Array.isArray(tagNames) && tagNames.length > 0) {
            for (const tagName of tagNames) {
                const name = String(tagName).trim();
                if (!name) continue;
                const tagSlug = slugify(name, { lower: true, strict: true });

                const { data: tag } = await supabase
                    .from('tags')
                    .select('id')
                    .eq('slug', tagSlug)
                    .maybeSingle();

                let tagId;
                if (!tag) {
                    const { data: createdTag, error: tagErr } = await supabase
                        .from('tags')
                        .insert({ name, slug: tagSlug })
                        .select('id')
                        .single();
                    if (tagErr) throw tagErr;
                    tagId = createdTag.id;
                } else {
                    tagId = tag.id;
                }

                const { error: ltErr } = await supabase
                    .from('lesson_tags')
                    .upsert({ lesson_id: lessonId, tag_id: tagId }, { onConflict: 'lesson_id,tag_id', ignoreDuplicates: true });
                if (ltErr) throw ltErr;
            }
        }

        res.status(201).json({ message: 'Lesson created', id: lessonId, slug });
    } catch (err) {
        console.error('Create lesson error:', err.message || err);
        return fail(res, err, 'Could not create the lesson');
    }
});

router.put('/:id', authenticate, requireAdmin, [...idValidators, ...writeValidators], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (checkId(res, errors)) return;
        if (rejectInvalid(res, errors)) return;

        const lessonId = parseId(req, res);
        if (lessonId === null) return;

        const {
            title, description, categoryId, instructorId, difficulty, language,
            durationMinutes, videoUrl, videoFilePath, thumbnailUrl,
            isPublished, isFree, isFeatured, rating, studentCount, price
        } = req.body;

        const { data: current, error: fetchError } = await supabase
            .from('lessons')
            .select('id,is_published')
            .eq('id', lessonId)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (!current) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        const finalVideoUrl = videoFilePath ? null : ((videoUrl == null || videoUrl === '') ? null : videoUrl);

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (categoryId !== undefined) updates.category_id = categoryId || null;
        if (instructorId !== undefined) updates.instructor_id = instructorId || null;
        if (difficulty !== undefined) updates.difficulty = difficulty;
        if (language !== undefined) updates.language = language;
        if (durationMinutes !== undefined) updates.duration_minutes = durationMinutes;
        if (videoUrl !== undefined || videoFilePath !== undefined) updates.video_url = finalVideoUrl;
        if (videoFilePath !== undefined) updates.video_file_path = videoFilePath || null;
        if (thumbnailUrl !== undefined) updates.thumbnail_url = thumbnailUrl || null;
        if (isFree !== undefined) updates.is_free = !!isFree;
        if (isFeatured !== undefined) updates.is_featured = !!isFeatured;
        if (rating !== undefined) updates.rating = rating == null ? null : rating;
        if (studentCount !== undefined) updates.student_count = studentCount == null ? null : studentCount;
        if (price !== undefined) updates.price = price == null ? null : price;

        if (isPublished !== undefined) {
            updates.is_published = !!isPublished;
            if (isPublished && !current.is_published) {
                updates.published_at = new Date().toISOString();
            }
        }

        if (Object.keys(updates).length === 0) {
            return res.json({ message: 'Lesson updated' });
        }

        let updated = null;
        {
            const attempt = await supabase
                .from('lessons')
                .update(updates)
                .eq('id', lessonId)
                .select('id');
            if (attempt.error && isMissingColumnError(attempt.error, 'language')) {
                console.warn('lessons.language column missing — updating without it. Re-run supabase/Schrema.sql.');
                delete updates.language;
                const retry = await supabase
                    .from('lessons')
                    .update(updates)
                    .eq('id', lessonId)
                    .select('id');
                if (retry.error) throw retry.error;
                updated = retry.data;
            } else if (attempt.error) {
                throw attempt.error;
            } else {
                updated = attempt.data;
            }
        }
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        res.json({ message: 'Lesson updated' });
    } catch (err) {
        console.error('Update lesson error:', err.message || err);
        return fail(res, err, 'Could not update the lesson');
    }
});

router.patch('/:id/publish', authenticate, requireAdmin, [
    ...idValidators,
    body('isPublished').exists().withMessage('isPublished (true/false) is required').isBoolean().withMessage('isPublished must be true or false')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (checkId(res, errors)) return;
        if (rejectInvalid(res, errors)) return;

        const lessonId = parseId(req, res);
        if (lessonId === null) return;

        const { isPublished } = req.body;

        const { data: current, error: fetchError } = await supabase
            .from('lessons')
            .select('id,is_published')
            .eq('id', lessonId)
            .maybeSingle();
        if (fetchError) throw fetchError;
        if (!current) {
            return res.status(404).json({ error: 'Lesson not found' });
        }

        const updates = { is_published: !!isPublished };
        if (isPublished && !current.is_published) {
            updates.published_at = new Date().toISOString();
        }

        const { data: updated, error: updateError } = await supabase
            .from('lessons')
            .update(updates)
            .eq('id', lessonId)
            .select('id');
        if (updateError) throw updateError;
        if (!updated || updated.length === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        res.json({ message: `Lesson ${isPublished ? 'published' : 'unpublished'}` });
    } catch (err) {
        console.error('Publish lesson error:', err.message || err);
        return fail(res, err, 'Could not change the publish state');
    }
});

router.delete('/:id', authenticate, requireAdmin, idValidators, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (checkId(res, errors)) return;

        const lessonId = parseId(req, res);
        if (lessonId === null) return;

        const { data: deleted, error } = await supabase
            .from('lessons')
            .delete()
            .eq('id', lessonId)
            .select('id');
        if (error) throw error;
        if (!deleted || deleted.length === 0) {
            return res.status(404).json({ error: 'Lesson not found' });
        }
        res.json({ message: 'Lesson deleted' });
    } catch (err) {
        console.error('Delete lesson error:', err.message || err);
        return fail(res, err, 'Could not delete the lesson');
    }
});

module.exports = router;