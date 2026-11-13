-- ============================================================================
--  Modern Skills / Noor Academy - Voice feedback for recitations
-- ============================================================================
--  Adds private teacher/admin voice feedback to recitation submissions.
--  Feedback audio is streamed only through the API after access checks:
--    GET /api/recitations/submissions/:id/feedback-audio
--
--  Apply with: Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--  Safe to re-run.
--
--  `supabase/Schrema.sql` remains the full source of truth for fresh installs.
-- ============================================================================

alter table public.recitation_submissions
  add column if not exists feedback_audio_storage text
    check (feedback_audio_storage in ('supabase', 'local')),
  add column if not exists feedback_audio_path text,
  add column if not exists feedback_audio_mime text,
  add column if not exists feedback_audio_duration_seconds int;

comment on column public.recitation_submissions.feedback_audio_storage is
  'Where the private feedback recording lives: supabase or local.';
comment on column public.recitation_submissions.feedback_audio_path is
  'Storage object path or local filename for teacher voice feedback.';

-- Make PostgREST pick up the new columns immediately.
notify pgrst, 'reload schema';
