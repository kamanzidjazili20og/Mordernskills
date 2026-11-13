// ============================================================
// Lesson comments - public discussion with text + voice notes.
//
// Access rules (enforced here, never in the browser alone):
//   any signed-in user : read comments on a published lesson,
//                        post a text and/or voice comment,
//                        reply to a comment, stream comment audio,
//                        delete their own comment
//   admin              : additionally delete any comment
//
// Voice notes are private. Uploads go to Supabase Storage (private bucket,
// comments/ prefix) or to backend/private/comments, and every byte is served
// by GET /:id/audio only after the caller passes the auth check.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { uploadComment, COMMENT_DIR } = require('../middleware/upload');
const { fail } = require('../middleware/errors');
const storage = require('../services/supabase');

const router = express.Router();

const MAX_BODY = 2000;
const MAX_COMMENTS = 500;

const AUDIO_MIME_BY_EXT = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm'
};

function asInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function asText(value, max) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

function recordingExtension(file) {
  const allowed = ['.webm', '.ogg', '.oga', '.mp3', '.m4a', '.mp4', '.wav', '.aac'];
  const fromName = (String(file.originalname || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  if (allowed.includes(fromName)) return fromName;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('aac')) return '.aac';
  return '.webm';
}

function recordingMime(file) {
  const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
  if (declared.startsWith('audio/') || declared === 'video/webm') return declared;
  return AUDIO_MIME_BY_EXT[recordingExtension(file)] || 'audio/webm';
}

function isModerator(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'teacher'));
}

async function getComment(id) {
  const { data, error } = await supabase
    .from('lesson_comments')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Attach author details + a stable audio URL the UI can stream. */
async function decorateComments(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const userIds = [...new Set(list.map(r => r.user_id).filter(Boolean))];
  const usersResult = userIds.length
    ? await supabase.from('users').select('id,username,full_name,avatar_url,role').in('id', userIds)
    : { data: [], error: null };
  if (usersResult.error) throw usersResult.error;

  const users = new Map((usersResult.data || []).map(u => [u.id, u]));

  return list.map(row => {
    const author = users.get(row.user_id) || {};
    const role = author.role || 'student';
    return {
      id: row.id,
      lesson_id: row.lesson_id,
      user_id: row.user_id,
      parent_id: row.parent_id || null,
      body: row.body || null,
      duration_seconds: row.duration_seconds,
      file_size: row.file_size,
      mime_type: row.mime_type,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author_name: author.full_name || author.username || 'Member',
      author_username: author.username || null,
      author_avatar: author.avatar_url || null,
      author_role: role,
      is_teacher: role === 'admin' || role === 'teacher',
      audio_url: row.audio_path ? `/api/comments/${row.id}/audio` : null
    };
  });
}

/** Confirm the lesson exists (and is visible to a plain student). */
async function loadLesson(lessonId, user) {
  const { data, error } = await supabase
    .from('lessons')
    .select('id,is_published')
    .eq('id', lessonId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (!isModerator(user) && data.is_published === false) return null;
  return data;
}

// ------------------------------------------------------------
// Read the discussion for a lesson
// ------------------------------------------------------------
router.get('/lesson/:lessonId', authenticate, async (req, res) => {
  try {
    const lessonId = asInt(req.params.lessonId);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id.' });

    const lesson = await loadLesson(lessonId, req.user);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });

    const { data, error } = await supabase
      .from('lesson_comments')
      .select('*')
      .eq('lesson_id', lessonId)
      .order('created_at', { ascending: true })
      .limit(MAX_COMMENTS);
    if (error) throw error;

    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      comments: await decorateComments(data || []),
      canModerate: isModerator(req.user),
      currentUserId: req.user.id
    });
  } catch (err) {
    console.error('List comments error:', err.message || err);
    return fail(res, err, 'Could not load comments');
  }
});

// ------------------------------------------------------------
// Post a comment (text and/or voice note) or a reply
// ------------------------------------------------------------
router.post('/lesson/:lessonId', authenticate, (req, res) => {
  uploadComment.single('audio')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `Voice note exceeds the maximum size of ${process.env.MAX_RECITATION_SIZE_MB || 25} MB.`
        });
      }
      return res.status(400).json({ error: uploadError.message });
    }

    let stored = null;
    try {
      const lessonId = asInt(req.params.lessonId);
      if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id.' });

      const lesson = await loadLesson(lessonId, req.user);
      if (!lesson) return res.status(404).json({ error: 'Lesson not found.' });

      const body = asText(req.body.body, MAX_BODY);
      const parentId = req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== ''
        ? asInt(req.body.parentId)
        : null;
      if (req.body.parentId !== undefined && req.body.parentId !== null && req.body.parentId !== '' && !parentId) {
        return res.status(400).json({ error: 'Invalid parent comment.' });
      }
      const durationSeconds = asInt(req.body.durationSeconds);
      if (durationSeconds !== null && (durationSeconds < 0 || durationSeconds > 7200)) {
        return res.status(400).json({ error: 'Voice note length is out of range.' });
      }

      if (!body && !req.file) {
        return res.status(400).json({ error: 'Write a message or record a voice note first.' });
      }

      if (parentId) {
        const parent = await getComment(parentId);
        if (!parent || parent.lesson_id !== lessonId) {
          return res.status(404).json({ error: 'The comment you are replying to no longer exists.' });
        }
      }

      let storageType = null;
      let audioPath = null;
      if (req.file) {
        if (storage.enabled) {
          try {
            stored = await storage.uploadCommentAudioToSupabase(req.file);
          } catch (storageErr) {
            console.error('Supabase comment upload failed, using private local storage:', storageErr.message);
            stored = null;
          }
        }
        if (stored) {
          storageType = 'supabase';
          audioPath = stored.path;
        } else {
          storageType = 'local';
          fs.mkdirSync(COMMENT_DIR, { recursive: true });
          audioPath = `cmt_${uuidv4()}${recordingExtension(req.file)}`;
          fs.writeFileSync(path.join(COMMENT_DIR, audioPath), req.file.buffer);
        }
      }

      const { data: inserted, error: insertError } = await supabase
        .from('lesson_comments')
        .insert({
          lesson_id: lessonId,
          user_id: req.user.id,
          parent_id: parentId,
          body,
          audio_storage: storageType,
          audio_path: audioPath,
          mime_type: req.file ? recordingMime(req.file) : null,
          duration_seconds: req.file ? durationSeconds : null,
          file_size: req.file ? req.file.size : null
        })
        .select('*')
        .single();

      if (insertError) {
        if (storageType === 'local' && audioPath) {
          try { fs.unlinkSync(path.join(COMMENT_DIR, path.basename(audioPath))); } catch (e) { /* best effort */ }
        }
        throw insertError;
      }

      const [comment] = await decorateComments([inserted]);
      res.status(201).json({ message: 'Comment posted.', comment });
    } catch (err) {
      console.error('Create comment error:', err.message || err);
      return fail(res, err, 'Could not post the comment');
    }
  });
});

// ------------------------------------------------------------
// Stream a voice note (auth required, no public URL ever leaks)
// ------------------------------------------------------------
router.get('/:id/audio', authenticate, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid comment id.' });

    const comment = await getComment(id);
    if (!comment || !comment.audio_path) {
      return res.status(404).json({ error: 'Voice note not found.' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', comment.mime_type || 'audio/webm');

    if (comment.audio_storage === 'supabase') {
      const file = await storage.downloadCommentAudioFromSupabase(comment.audio_path);
      res.setHeader('Content-Type', file.contentType || comment.mime_type || 'audio/webm');
      res.setHeader('Content-Length', String(file.buffer.length));
      return res.send(file.buffer);
    }

    const filePath = path.join(COMMENT_DIR, path.basename(comment.audio_path));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'The voice note file is missing from storage.' });
    }
    res.setHeader('Content-Length', String(fs.statSync(filePath).size));
    return res.sendFile(filePath);
  } catch (err) {
    console.error('Stream comment audio error:', err.message || err);
    return fail(res, err, 'Could not load the voice note');
  }
});

// ------------------------------------------------------------
// Delete a comment (author or admin)
// ------------------------------------------------------------
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid comment id.' });

    const comment = await getComment(id);
    if (!comment) return res.status(404).json({ error: 'Comment not found.' });

    if (req.user.role !== 'admin' && comment.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own comments.' });
    }

    // Replies reference this row with ON DELETE CASCADE, so removing the
    // parent also removes its thread. Drop the stored audio first.
    const { data: replies, error: replyError } = await supabase
      .from('lesson_comments')
      .select('id,audio_storage,audio_path')
      .eq('parent_id', id);
    if (replyError) throw replyError;

    const { error: deleteError } = await supabase
      .from('lesson_comments')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    const audioRows = [comment, ...(replies || [])].filter(r => r && r.audio_path);
    for (const row of audioRows) {
      if (row.audio_storage === 'local') {
        try { fs.unlinkSync(path.join(COMMENT_DIR, path.basename(row.audio_path))); } catch (e) { /* best effort */ }
      }
    }

    res.json({ message: 'Comment deleted.' });
  } catch (err) {
    console.error('Delete comment error:', err.message || err);
    return fail(res, err, 'Could not delete the comment');
  }
});

module.exports = router;
