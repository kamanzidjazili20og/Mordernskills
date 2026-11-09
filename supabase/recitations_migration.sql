-- ============================================================================
--  Modern Skills / Noor Academy - Recitation feature migration
-- ============================================================================
--  Minimal, idempotent migration for an EXISTING Supabase project.
--  It only adds the recitation feature and does NOT touch catalog seed data.
--
--  Apply with: Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--  Safe to re-run.
--
--  `supabase/Schrema.sql` remains the full source of truth for fresh installs;
--  this file is the safe subset to run against a live database.
-- ============================================================================


-- ############################################################################
--  1. Shared updated_at trigger helper
-- ############################################################################

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ############################################################################
--  2. Allow the `teacher` role
-- ############################################################################

alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin', 'student', 'teacher'));


-- ############################################################################
--  3. Recitation tables
-- ############################################################################

-- A teacher assigns a Surah + Ayah range to one student.
create table if not exists public.surah_assignments (
  id            serial primary key,
  teacher_id    int references public.users(id) on delete set null,
  student_id    int not null references public.users(id) on delete cascade,
  surah_number  int not null check (surah_number between 1 and 114),
  surah_name    text not null,
  ayah_start    int not null check (ayah_start >= 1),
  ayah_end      int not null check (ayah_end >= 1),
  instructions  text,
  due_date      date,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ayah_end >= ayah_start)
);

-- One row per uploaded recording. Audio is private and streamed only through
-- GET /api/recitations/submissions/:id/audio after the API checks ownership.
create table if not exists public.recitation_submissions (
  id               serial primary key,
  assignment_id    int not null references public.surah_assignments(id) on delete cascade,
  student_id       int not null references public.users(id) on delete cascade,
  surah_number     int not null check (surah_number between 1 and 114),
  surah_name       text not null,
  ayah_start       int not null check (ayah_start >= 1),
  ayah_end         int not null check (ayah_end >= 1),
  storage          text not null default 'local' check (storage in ('supabase', 'local')),
  audio_path       text not null,
  mime_type        text,
  file_size        bigint,
  duration_seconds int,
  status           text not null default 'pending'
                   check (status in ('pending', 'reviewed', 'needs_improvement')),
  feedback         text,
  reviewed_by      int references public.users(id) on delete set null,
  reviewed_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (ayah_end >= ayah_start)
);


-- ############################################################################
--  4. Indexes
-- ############################################################################

create index if not exists idx_assignments_student on public.surah_assignments(student_id);
create index if not exists idx_assignments_teacher on public.surah_assignments(teacher_id);
create index if not exists idx_assignments_active  on public.surah_assignments(is_active);

create index if not exists idx_submissions_assignment on public.recitation_submissions(assignment_id);
create index if not exists idx_submissions_student    on public.recitation_submissions(student_id);
create index if not exists idx_submissions_status     on public.recitation_submissions(status);
create index if not exists idx_submissions_created    on public.recitation_submissions(created_at);


-- ############################################################################
--  5. Row Level Security
-- ############################################################################
-- No anon policies: all recitation reads/writes go through the Node backend
-- using the service-role key, which bypasses RLS after its own checks.

alter table public.surah_assignments      enable row level security;
alter table public.recitation_submissions enable row level security;


-- ############################################################################
--  6. updated_at triggers
-- ############################################################################

drop trigger if exists trg_assignments_updated on public.surah_assignments;
create trigger trg_assignments_updated before update on public.surah_assignments
  for each row execute function public.set_updated_at();

drop trigger if exists trg_submissions_updated on public.recitation_submissions;
create trigger trg_submissions_updated before update on public.recitation_submissions
  for each row execute function public.set_updated_at();


-- ############################################################################
--  7. Private recitations storage bucket
-- ############################################################################
-- 25 MB, mirrors MAX_RECITATION_SIZE_MB=25 and upload.js recitationFilter.
-- The UPDATE guarantees correct limits even if the bucket was previously
-- auto-created by the backend without a MIME allowlist.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('recitations', 'recitations', false, 26214400,
   array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a',
         'audio/wav', 'audio/x-wav', 'audio/aac'])
on conflict (id) do nothing;

update storage.buckets
   set public = false,
       file_size_limit = 26214400,
       allowed_mime_types = array['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4',
                                  'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/aac']
 where id = 'recitations';


-- ############################################################################
--  8. Verification (read-only)
-- ############################################################################

select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('surah_assignments', 'recitation_submissions')) as recitation_tables,
  (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname in ('idx_assignments_student', 'idx_assignments_teacher',
                         'idx_assignments_active', 'idx_submissions_assignment',
                         'idx_submissions_student', 'idx_submissions_status',
                         'idx_submissions_created')) as recitation_indexes,
  (select count(*) from storage.buckets
     where id = 'recitations' and public = false) as private_bucket,
  (select count(*) from pg_constraint
     where conname = 'users_role_check' and pg_get_constraintdef(oid) like '%teacher%') as teacher_role;


-- ############################################################################
--  9. Lesson-only submissions (record straight from a lesson, no pre-order)
-- ############################################################################
--  A student can record practice from any published lesson they are on
--  ("Record & Submit") without waiting for a teacher assignment. Such rows
--  have NULL assignment/surah/ayah fields and only lesson_id set; assigned
--  recordings keep the old shape. Assignments gain lesson_id too, so a
--  lesson-linked assignment points at its lesson.

alter table public.recitation_submissions add column if not exists lesson_id int references public.lessons(id) on delete set null;
alter table public.surah_assignments      add column if not exists lesson_id int references public.lessons(id) on delete set null;

alter table public.recitation_submissions alter column assignment_id drop not null;
alter table public.recitation_submissions alter column surah_number drop not null;
alter table public.recitation_submissions alter column surah_name   drop not null;
alter table public.recitation_submissions alter column ayah_start   drop not null;
alter table public.recitation_submissions alter column ayah_end     drop not null;

create index if not exists idx_submissions_lesson on public.recitation_submissions(lesson_id);

select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'recitation_submissions'
       and column_name = 'lesson_id') as submissions_lesson_column,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'surah_assignments'
       and column_name = 'lesson_id') as assignments_lesson_column,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'recitation_submissions'
       and column_name in ('assignment_id','surah_number','surah_name','ayah_start','ayah_end')
       and is_nullable = 'YES') as nullable_recording_columns;
