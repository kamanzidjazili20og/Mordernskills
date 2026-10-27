// ============================================================
// Recitations — student recordings + teacher review.
//
// Access rules (enforced here, never in the browser alone):
//   student : own assignments, own submissions, own audio
//   teacher : assignments they created, submissions for those
//             assignments, and the audio behind them
//   admin   : everything, including assigning a teacher
//
// Audio is private. Uploads go to Supabase Storage (private bucket) or to
// backend/private/recitations, and every byte is served by
// GET /submissions/:id/audio only after the caller passes the checks above.
// ============================================================
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/db');
const { authenticate, requireAdmin, requireTeacher, requireStudent } = require('../middleware/auth');
const { uploadRecitation, RECITATION_DIR } = require('../middleware/upload');
const { fail } = require('../middleware/errors');
const storage = require('../services/supabase');
const SURAHS = require('../config/surahs');

const router = express.Router();

const STATUSES = ['pending', 'reviewed', 'needs_improvement'];
const REVIEW_STATUSES = ['reviewed', 'needs_improvement'];
const MAX_FEEDBACK = 2000;
const MAX_INSTRUCTIONS = 2000;

const SURAH_BY_NUMBER = new Map(SURAHS.map(s => [s.number, s]));

function asInt(value) {
  const n = parseInt(value, 10);
  return Number.isInteger(n) ? n : null;
}

function asText(value, max) {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
}

function normalizeDate(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(raw + 'T00:00:00Z');
  return Number.isNaN(date.getTime()) ? null : raw;
}

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

/** Build the assignment scope a caller is allowed to see. */
async function visibleAssignmentIds(user) {
  if (user.role !== 'teacher') return null; // student/admin use other filters
  const { data, error } = await supabase
    .from('surah_assignments')
    .select('id')
    .eq('teacher_id', user.id);
  if (error) throw error;
  return new Set((data || []).map(row => row.id));
}

/** Can this caller read/review this submission? */
async function canAccessSubmission(user, submission) {
  if (!submission) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'student') return submission.student_id === user.id;

  if (user.role === 'teacher') {
    const { data, error } = await supabase
      .from('surah_assignments')
      .select('teacher_id')
      .eq('id', submission.assignment_id)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data && data.teacher_id === user.id);
  }
  return false;
}

async function getSubmission(id) {
  const { data, error } = await supabase
    .from('recitation_submissions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** Add student/assignment details the UI needs without exposing storage paths. */
async function decorateSubmissions(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const studentIds = [...new Set(list.map(r => r.student_id).filter(Boolean))];
  const assignmentIds = [...new Set(list.map(r => r.assignment_id).filter(Boolean))];

  const [usersResult, assignmentsResult] = await Promise.all([
    studentIds.length
      ? supabase.from('users').select('id,username,full_name,email,avatar_url').in('id', studentIds)
      : Promise.resolve({ data: [], error: null }),
    assignmentIds.length
      ? supabase.from('surah_assignments').select('id,teacher_id,instructions,due_date,is_active').in('id', assignmentIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (usersResult.error) throw usersResult.error;
  if (assignmentsResult.error) throw assignmentsResult.error;

  const users = new Map((usersResult.data || []).map(u => [u.id, u]));
  const assignments = new Map((assignmentsResult.data || []).map(a => [a.id, a]));

  return list.map(row => {
    const student = users.get(row.student_id) || {};
    const assignment = assignments.get(row.assignment_id) || {};
    return {
      id: row.id,
      assignment_id: row.assignment_id,
      student_id: row.student_id,
      student_name: student.full_name || student.username || 'Student',
      student_username: student.username || null,
      student_email: student.email || null,
      surah_number: row.surah_number,
      surah_name: row.surah_name,
      ayah_start: row.ayah_start,
      ayah_end: row.ayah_end,
      duration_seconds: row.duration_seconds,
      file_size: row.file_size,
      mime_type: row.mime_type,
      status: row.status,
      feedback: row.feedback,
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      teacher_id: assignment.teacher_id || null,
      instructions: assignment.instructions || null,
      due_date: assignment.due_date || null,
      audio_url: `/api/recitations/submissions/${row.id}/audio`
    };
  });
}

/** Add the student name and the latest submission to each assignment. */
async function decorateAssignments(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return list;

  const ids = list.map(a => a.id);
  const studentIds = [...new Set(list.map(a => a.student_id).filter(Boolean))];

  const [usersResult, subsResult] = await Promise.all([
    studentIds.length
      ? supabase.from('users').select('id,username,full_name,email').in('id', studentIds)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase
          .from('recitation_submissions')
          .select('id,assignment_id,status,feedback,created_at')
          .in('assignment_id', ids)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null })
  ]);

  if (usersResult.error) throw usersResult.error;
  if (subsResult.error) throw subsResult.error;

  const users = new Map((usersResult.data || []).map(u => [u.id, u]));
  const latestByAssignment = new Map();
  const countByAssignment = new Map();
  for (const sub of subsResult.data || []) {
    countByAssignment.set(sub.assignment_id, (countByAssignment.get(sub.assignment_id) || 0) + 1);
    if (!latestByAssignment.has(sub.assignment_id)) latestByAssignment.set(sub.assignment_id, sub);
  }

  return list.map(row => {
    const student = users.get(row.student_id) || {};
    const latest = latestByAssignment.get(row.id);
    return {
      ...row,
      student_name: student.full_name || student.username || 'Student',
      student_username: student.username || null,
      student_email: student.email || null,
      submission_count: countByAssignment.get(row.id) || 0,
      latest_submission_id: latest ? latest.id : null,
      latest_submission_status: latest ? latest.status : null
    };
  });
}

// ------------------------------------------------------------
// Reference data
// ------------------------------------------------------------
router.get('/surahs', authenticate, (req, res) => {
  res.json({ surahs: SURAHS });
});

// ------------------------------------------------------------
// Assignments
// ------------------------------------------------------------
router.get('/assignments', authenticate, async (req, res) => {
  try {
    let query = supabase.from('surah_assignments').select('*');
    if (req.user.role === 'student') {
      query = query.eq('student_id', req.user.id);
    } else if (req.user.role === 'teacher') {
      query = query.eq('teacher_id', req.user.id);
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This account cannot view assignments.' });
    }

    const lessonId = req.query.lesson_id !== undefined && req.query.lesson_id !== null && req.query.lesson_id !== ''
      ? asInt(req.query.lesson_id)
      : null;
    if (req.query.lesson_id !== undefined && req.query.lesson_id !== null && req.query.lesson_id !== '' && !lessonId) {
      return res.status(400).json({ error: 'Invalid lesson_id.' });
    }
    if (lessonId) {
      query = query.eq('lesson_id', lessonId);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    res.json({ assignments: await decorateAssignments(data || []) });
  } catch (err) {
    console.error('List assignments error:', err.message || err);
    return fail(res, err, 'Could not load assignments');
  }
});

router.post('/assignments', authenticate, requireTeacher, async (req, res) => {
  try {
    const studentId = asInt(req.body.studentId);
    const surahNumber = asInt(req.body.surahNumber);
    const ayahStart = asInt(req.body.ayahStart);
    const ayahEnd = asInt(req.body.ayahEnd);
    const instructions = asText(req.body.instructions, MAX_INSTRUCTIONS);
    const dueDate = normalizeDate(req.body.dueDate);
    const lessonId = req.body.lessonId !== undefined && req.body.lessonId !== null && req.body.lessonId !== ''
      ? asInt(req.body.lessonId)
      : null;

    const surah = SURAH_BY_NUMBER.get(surahNumber);
    if (!surah) return res.status(400).json({ error: 'Choose a valid Surah (1-114).' });
    if (!studentId) return res.status(400).json({ error: 'Choose a student.' });
    if (!ayahStart || !ayahEnd || ayahStart < 1 || ayahEnd < ayahStart || ayahEnd > surah.ayahs) {
      return res.status(400).json({
        error: `Ayah range must be between 1 and ${surah.ayahs} for ${surah.name}.`
      });
    }
    if (req.body.lessonId !== undefined && req.body.lessonId !== null && req.body.lessonId !== '' && !lessonId) {
      return res.status(400).json({ error: 'Invalid lessonId.' });
    }

    if (lessonId) {
      const { data: lessonRows, error: lessonError } = await supabase
        .from('lessons')
        .select('id,is_published')
        .eq('id', lessonId)
        .limit(1);
      if (lessonError) throw lessonError;
      if (!lessonRows || !lessonRows.length) {
        return res.status(404).json({ error: 'Lesson not found.' });
      }
    }

    const { data: studentRows, error: studentError } = await supabase
      .from('users')
      .select('id,role,is_active')
      .eq('id', studentId)
      .limit(1);
    if (studentError) throw studentError;
    const student = studentRows && studentRows[0];
    if (!student || student.role !== 'student') {
      return res.status(404).json({ error: 'Student not found.' });
    }
    if (student.is_active === false) {
      return res.status(400).json({ error: 'That student account is deactivated.' });
    }

    let teacherId = null;
    if (req.user.role === 'teacher') {
      teacherId = req.user.id;
    } else if (req.user.role === 'admin' && req.body.teacherId) {
      const requestedTeacherId = asInt(req.body.teacherId);
      const { data: teacherRows, error: teacherError } = await supabase
        .from('users')
        .select('id,role')
        .eq('id', requestedTeacherId)
        .limit(1);
      if (teacherError) throw teacherError;
      const teacher = teacherRows && teacherRows[0];
      if (!teacher || (teacher.role !== 'teacher' && teacher.role !== 'admin')) {
        return res.status(400).json({ error: 'Choose a valid teacher for this assignment.' });
      }
      teacherId = teacher.id;
    }

    const payload = {
      teacher_id: teacherId,
      student_id: studentId,
      surah_number: surah.number,
      surah_name: surah.name,
      ayah_start: ayahStart,
      ayah_end: ayahEnd,
      instructions,
      due_date: dueDate
    };
    if (lessonId) payload.lesson_id = lessonId;

    const { data: inserted, error } = await supabase
      .from('surah_assignments')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw error;

    const [assignment] = await decorateAssignments([inserted]);
    res.status(201).json({ message: 'Assignment created.', assignment });
  } catch (err) {
    console.error('Create assignment error:', err.message || err);
    return fail(res, err, 'Could not create the assignment');
  }
});

router.delete('/assignments/:id', authenticate, requireTeacher, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid assignment id.' });

    const { data: rows, error } = await supabase
      .from('surah_assignments')
      .select('id,teacher_id')
      .eq('id', id)
      .limit(1);
    if (error) throw error;
    const assignment = rows && rows[0];
    if (!assignment) return res.status(404).json({ error: 'Assignment not found.' });
    if (req.user.role !== 'admin' && assignment.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own assignments.' });
    }

    const { data: submissions, error: subError } = await supabase
      .from('recitation_submissions')
      .select('id')
      .eq('assignment_id', id)
      .limit(1);
    if (subError) throw subError;
    if (submissions && submissions.length) {
      return res.status(409).json({
        error: 'This assignment already has recordings. Keep it so the student history stays intact.'
      });
    }

    const { error: deleteError } = await supabase
      .from('surah_assignments')
      .delete()
      .eq('id', id);
    if (deleteError) throw deleteError;

    res.json({ message: 'Assignment deleted.' });
  } catch (err) {
    console.error('Delete assignment error:', err.message || err);
    return fail(res, err, 'Could not delete the assignment');
  }
});

// ------------------------------------------------------------
// People
// ------------------------------------------------------------
router.get('/students', authenticate, requireTeacher, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id,username,full_name,email,is_active')
      .eq('role', 'student')
      .eq('is_active', true)
      .order('full_name', { ascending: true })
      .limit(500);
    if (error) throw error;
    res.json({ students: data || [] });
  } catch (err) {
    console.error('List students error:', err.message || err);
    return fail(res, err, 'Could not load students');
  }
});

router.get('/teachers', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id,username,full_name,email,is_active')
      .eq('role', 'teacher')
      .order('full_name', { ascending: true });
    if (error) throw error;
    res.json({ teachers: data || [] });
  } catch (err) {
    console.error('List teachers error:', err.message || err);
    return fail(res, err, 'Could not load teachers');
  }
});

// Admin promotes an existing student account to the teacher role. They must
// sign out and back in so their JWT carries the new role.
router.post('/teachers', authenticate, requireAdmin, async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const userId = asInt(req.body.userId);
    if (!email && !userId) return res.status(400).json({ error: 'Enter the email of an existing account.' });

    let query = supabase.from('users').select('id,username,full_name,email,role');
    query = userId ? query.eq('id', userId) : query.ilike('email', email);
    const { data, error } = await query.limit(1);
    if (error) throw error;
    const user = data && data[0];
    if (!user) return res.status(404).json({ error: 'No account with that email was found.' });
    if (user.role === 'admin') return res.status(400).json({ error: 'That account is already an admin.' });

    const { data: updated, error: updateError } = await supabase
      .from('users')
      .update({ role: 'teacher' })
      .eq('id', user.id)
      .select('id,username,full_name,email,role')
      .single();
    if (updateError) throw updateError;

    res.json({
      message: 'Teacher access granted. The user must sign out and sign in again.',
      teacher: updated
    });
  } catch (err) {
    console.error('Promote teacher error:', err.message || err);
    return fail(res, err, 'Could not grant teacher access');
  }
});

// ------------------------------------------------------------
// Submissions
// ------------------------------------------------------------
router.get('/submissions', authenticate, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Invalid status filter.' });
    }
    const limit = Math.min(Math.max(asInt(req.query.limit) || 60, 1), 200);
    const assignmentFilter = asInt(req.query.assignmentId);
    const studentFilter = asInt(req.query.studentId);

    let query = supabase.from('recitation_submissions').select('*');

    if (req.user.role === 'student') {
      query = query.eq('student_id', req.user.id);
    } else if (req.user.role === 'teacher') {
      const ownIds = await visibleAssignmentIds(req.user);
      if (!ownIds.size) return res.json({ submissions: [] });
      if (assignmentFilter && !ownIds.has(assignmentFilter)) {
        return res.status(403).json({ error: 'That assignment does not belong to you.' });
      }
      query = query.in('assignment_id', [...ownIds]);
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This account cannot view recordings.' });
    }

    if (status) query = query.eq('status', status);
    if (assignmentFilter) query = query.eq('assignment_id', assignmentFilter);
    if (studentFilter && req.user.role !== 'student') query = query.eq('student_id', studentFilter);

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    res.json({ submissions: await decorateSubmissions(data || []) });
  } catch (err) {
    console.error('List submissions error:', err.message || err);
    return fail(res, err, 'Could not load recordings');
  }
});

router.get('/submissions/:id/audio', authenticate, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid recording id.' });

    const submission = await getSubmission(id);
    if (!submission) return res.status(404).json({ error: 'Recording not found.' });
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: 'You do not have access to this recording.' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', submission.mime_type || 'audio/webm');

    if (submission.storage === 'supabase') {
      const file = await storage.downloadRecitationFromSupabase(submission.audio_path);
      res.setHeader('Content-Type', file.contentType || submission.mime_type || 'audio/webm');
      res.setHeader('Content-Length', String(file.buffer.length));
      return res.send(file.buffer);
    }

    const filePath = path.join(RECITATION_DIR, path.basename(submission.audio_path));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'The audio file is missing from storage.' });
    }
    res.setHeader('Content-Length', String(fs.statSync(filePath).size));
    return res.sendFile(filePath);
  } catch (err) {
    console.error('Stream recording error:', err.message || err);
    return fail(res, err, 'Could not load the recording');
  }
});

router.get('/submissions/:id', authenticate, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid recording id.' });

    const submission = await getSubmission(id);
    if (!submission) return res.status(404).json({ error: 'Recording not found.' });
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: 'You do not have access to this recording.' });
    }

    const [decorated] = await decorateSubmissions([submission]);
    res.json({ submission: decorated });
  } catch (err) {
    console.error('Get submission error:', err.message || err);
    return fail(res, err, 'Could not load the recording');
  }
});

router.post('/submissions', authenticate, requireStudent, (req, res) => {
  uploadRecitation.single('audio')(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          error: `Recording exceeds the maximum size of ${process.env.MAX_RECITATION_SIZE_MB || 25} MB.`
        });
      }
      return res.status(400).json({ error: uploadError.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No recording file was provided.' });

    try {
      const assignmentId = asInt(req.body.assignmentId);
      const durationSeconds = asInt(req.body.durationSeconds);

      if (!assignmentId) return res.status(400).json({ error: 'Choose an assignment first.' });
      if (durationSeconds !== null && (durationSeconds < 0 || durationSeconds > 7200)) {
        return res.status(400).json({ error: 'Recording length is out of range.' });
      }

      const { data: assignmentRows, error: assignmentError } = await supabase
        .from('surah_assignments')
        .select('*')
        .eq('id', assignmentId)
        .eq('student_id', req.user.id)
        .eq('is_active', true)
        .limit(1);
      if (assignmentError) throw assignmentError;
      const assignment = assignmentRows && assignmentRows[0];
      if (!assignment) {
        return res.status(404).json({ error: 'That assignment is not available for your account.' });
      }

      let stored = null;
      if (storage.enabled) {
        try {
          stored = await storage.uploadRecitationToSupabase(req.file);
        } catch (storageErr) {
          // Keep the feature usable if Storage is temporarily unavailable.
          console.error('Supabase recitation upload failed, using private local storage:', storageErr.message);
          stored = null;
        }
      }

      let storageType = 'supabase';
      let audioPath = stored && stored.path;
      if (!stored) {
        storageType = 'local';
        fs.mkdirSync(RECITATION_DIR, { recursive: true });
        audioPath = `rec_${uuidv4()}${recordingExtension(req.file)}`;
        fs.writeFileSync(path.join(RECITATION_DIR, audioPath), req.file.buffer);
      }

      const { data: inserted, error: insertError } = await supabase
        .from('recitation_submissions')
        .insert({
          assignment_id: assignment.id,
          lesson_id: assignment.lesson_id || null,
          student_id: req.user.id,
          surah_number: assignment.surah_number,
          surah_name: assignment.surah_name,
          ayah_start: assignment.ayah_start,
          ayah_end: assignment.ayah_end,
          storage: storageType,
          audio_path: audioPath,
          mime_type: recordingMime(req.file),
          file_size: req.file.size,
          duration_seconds: durationSeconds,
          status: 'pending'
        })
        .select('*')
        .single();

      if (insertError) {
        if (storageType === 'local') {
          try { fs.unlinkSync(path.join(RECITATION_DIR, audioPath)); } catch (e) { /* best effort */ }
        }
        throw insertError;
      }

      const [submission] = await decorateSubmissions([inserted]);
      res.status(201).json({ message: 'Recording submitted for review.', submission });
    } catch (err) {
      console.error('Create submission error:', err.message || err);
      return fail(res, err, 'Could not save the recording');
    }
  });
});

router.patch('/submissions/:id/review', authenticate, requireTeacher, async (req, res) => {
  try {
    const id = asInt(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid recording id.' });

    const status = String(req.body.status || '');
    if (!REVIEW_STATUSES.includes(status)) {
      return res.status(400).json({ error: 'Review status must be reviewed or needs_improvement.' });
    }
    const feedback = asText(req.body.feedback, MAX_FEEDBACK);
    if (status === 'needs_improvement' && !feedback) {
      return res.status(400).json({ error: 'Write feedback explaining what the student should improve.' });
    }

    const submission = await getSubmission(id);
    if (!submission) return res.status(404).json({ error: 'Recording not found.' });
    if (!(await canAccessSubmission(req.user, submission))) {
      return res.status(403).json({ error: 'You can only review your own students’ recordings.' });
    }

    const { data: updated, error } = await supabase
      .from('recitation_submissions')
      .update({
        status,
        feedback,
        reviewed_by: req.user.id,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    const [decorated] = await decorateSubmissions([updated]);
    res.json({ message: 'Review saved.', submission: decorated });
  } catch (err) {
    console.error('Review submission error:', err.message || err);
    return fail(res, err, 'Could not save the review');
  }
});

// ------------------------------------------------------------
// Lesson context helper
// ------------------------------------------------------------
router.get('/lesson/:lessonId', authenticate, async (req, res) => {
  try {
    const lessonId = asInt(req.params.lessonId);
    if (!lessonId) return res.status(400).json({ error: 'Invalid lesson id.' });

    if (req.user.role === 'student') {
      let query = supabase
        .from('surah_assignments')
        .select('*')
        .eq('student_id', req.user.id)
        .eq('lesson_id', lessonId)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data, error } = await query;
      if (error) throw error;
      const assignments = await decorateAssignments(data || []);
      const assignmentIds = assignments.map(a => a.id);
      let submissions = [];
      if (assignmentIds.length) {
        const { data: subData, error: subError } = await supabase
          .from('recitation_submissions')
          .select('*')
          .eq('student_id', req.user.id)
          .in('assignment_id', assignmentIds)
          .order('created_at', { ascending: false });
        if (subError) throw subError;
        submissions = await decorateSubmissions(subData || []);
      }
      return res.json({ role: 'student', assignments, submissions });
    }

    if (req.user.role === 'teacher') {
      const { data, error } = await supabase
        .from('surah_assignments')
        .select('*')
        .eq('teacher_id', req.user.id)
        .eq('lesson_id', lessonId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const assignments = await decorateAssignments(data || []);
      const assignmentIds = assignments.map(a => a.id);
      let submissions = [];
      if (assignmentIds.length) {
        const { data: subData, error: subError } = await supabase
          .from('recitation_submissions')
          .select('*')
          .in('assignment_id', assignmentIds)
          .order('created_at', { ascending: false });
        if (subError) throw subError;
        submissions = await decorateSubmissions(subData || []);
      }
      return res.json({ role: 'teacher', assignments, submissions });
    }

    if (req.user.role === 'admin') {
      const { data, error } = await supabase
        .from('surah_assignments')
        .select('*')
        .eq('lesson_id', lessonId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      const assignments = await decorateAssignments(data || []);
      const assignmentIds = assignments.map(a => a.id);
      let submissions = [];
      if (assignmentIds.length) {
        const { data: subData, error: subError } = await supabase
          .from('recitation_submissions')
          .select('*')
          .in('assignment_id', assignmentIds)
          .order('created_at', { ascending: false });
        if (subError) throw subError;
        submissions = await decorateSubmissions(subData || []);
      }
      return res.json({ role: 'admin', assignments, submissions });
    }

    return res.status(403).json({ error: 'Cannot access recitations for this lesson.' });
  } catch (err) {
    console.error('Lesson recitations error:', err.message || err);
    return fail(res, err, 'Could not load recitations for this lesson');
  }
});

// ------------------------------------------------------------
// Progress counters
// ------------------------------------------------------------
router.get('/stats', authenticate, async (req, res) => {
  try {
    let assignmentQuery = supabase.from('surah_assignments').select('id,student_id');
    let submissionQuery = supabase.from('recitation_submissions').select('status');

    if (req.user.role === 'student') {
      assignmentQuery = assignmentQuery.eq('student_id', req.user.id);
      submissionQuery = submissionQuery.eq('student_id', req.user.id);
    } else if (req.user.role === 'teacher') {
      assignmentQuery = assignmentQuery.eq('teacher_id', req.user.id);
      const ownIds = await visibleAssignmentIds(req.user);
      if (!ownIds.size) {
        return res.json({
          stats: { pending: 0, reviewed: 0, needs_improvement: 0, total: 0 },
          assignments: 0,
          students: 0
        });
      }
      submissionQuery = submissionQuery.in('assignment_id', [...ownIds]);
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'This account cannot view progress.' });
    }

    const [assignmentsResult, submissionsResult] = await Promise.all([
      assignmentQuery.limit(1000),
      submissionQuery.limit(1000)
    ]);
    if (assignmentsResult.error) throw assignmentsResult.error;
    if (submissionsResult.error) throw submissionsResult.error;

    const counts = { pending: 0, reviewed: 0, needs_improvement: 0, total: 0 };
    for (const row of submissionsResult.data || []) {
      if (counts[row.status] !== undefined) counts[row.status] += 1;
      counts.total += 1;
    }

    const studentSet = new Set((assignmentsResult.data || []).map(a => a.student_id));
    res.json({
      stats: counts,
      assignments: (assignmentsResult.data || []).length,
      students: studentSet.size
    });
  } catch (err) {
    console.error('Recitation stats error:', err.message || err);
    return fail(res, err, 'Could not load progress');
  }
});

module.exports = router;
