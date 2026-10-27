-- ============================================================================
--  Modern Skills - Link recitations to video lessons
-- ============================================================================
--  Adds optional lesson_id to surah_assignments and recitation_submissions
--  so the video page can show "Record recitation for this lesson".
--  Idempotent. Safe to re-run.
-- ============================================================================

-- Link assignments to a lesson (optional for backwards compatibility)
alter table public.surah_assignments
  add column if not exists lesson_id integer references public.lessons(id) on delete set null;

create index if not exists idx_assignments_lesson on public.surah_assignments(lesson_id);

-- Link submissions to a lesson (optional for backwards compatibility)
alter table public.recitation_submissions
  add column if not exists lesson_id integer references public.lessons(id) on delete set null;

create index if not exists idx_submissions_lesson on public.recitation_submissions(lesson_id);

-- Helpful view for the video page (optional but convenient)
create or replace view public.v_lesson_recitations as
select 
  a.id as assignment_id,
  a.lesson_id,
  a.teacher_id,
  a.student_id,
  a.surah_number,
  a.surah_name,
  a.ayah_start,
  a.ayah_end,
  a.instructions,
  a.due_date,
  a.is_active,
  a.created_at,
  s.id as submission_id,
  s.status,
  s.feedback,
  s.reviewed_at,
  s.created_at as submitted_at,
  u.id as teacher_user_id,
  u.full_name as teacher_name,
  u.username as teacher_username
from public.surah_assignments a
left join public.recitation_submissions s 
  on s.assignment_id = a.id
left join public.users u 
  on u.id = a.teacher_id
where a.is_active = true;
