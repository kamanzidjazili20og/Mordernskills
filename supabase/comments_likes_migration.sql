-- ============================================================================
--  Modern Skills / Noor Academy - Lesson comments & likes migration
-- ============================================================================
--  Minimal, idempotent migration for an EXISTING Supabase project.
--  Adds the public lesson discussion feature (text + voice comments with
--  teacher/admin replies) and lesson likes. Does NOT touch catalog data.
--
--  Apply with: Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--  Safe to re-run.
--
--  `supabase/Schrema.sql` remains the full source of truth for fresh installs;
--  this file is the safe subset to run against a live database.
-- ============================================================================


-- ############################################################################
--  1. Shared updated_at trigger helper (in case the recitation migration
--     was never applied to this project)
-- ############################################################################

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ############################################################################
--  2. Lesson comments
-- ############################################################################
--  A comment is either text, a voice recording, or both. Audio is private and
--  streamed only through GET /api/comments/:id/audio after the API has checked
--  the caller. Replies point at a parent comment on the same lesson.

create table if not exists public.lesson_comments (
  id               serial primary key,
  lesson_id        int not null references public.lessons(id) on delete cascade,
  user_id          int not null references public.users(id) on delete cascade,
  parent_id        int references public.lesson_comments(id) on delete cascade,
  body             text,
  audio_storage    text check (audio_storage in ('supabase', 'local')),
  audio_path       text,
  mime_type        text,
  duration_seconds int,
  file_size        bigint,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (body is not null or audio_path is not null)
);


-- ############################################################################
--  3. Lesson likes
-- ############################################################################
--  One row per (lesson, user). Toggling a like inserts or deletes the row.

create table if not exists public.lesson_likes (
  id         serial primary key,
  lesson_id  int not null references public.lessons(id) on delete cascade,
  user_id    int not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (lesson_id, user_id)
);


-- ############################################################################
--  4. Indexes
-- ############################################################################

create index if not exists idx_comments_lesson  on public.lesson_comments(lesson_id);
create index if not exists idx_comments_parent  on public.lesson_comments(parent_id);
create index if not exists idx_comments_user    on public.lesson_comments(user_id);
create index if not exists idx_comments_created on public.lesson_comments(created_at);

create index if not exists idx_likes_lesson on public.lesson_likes(lesson_id);
create index if not exists idx_likes_user   on public.lesson_likes(user_id);


-- ############################################################################
--  5. Row Level Security
-- ############################################################################
-- No anon policies: all comment/like reads and writes go through the Node
-- backend using the service-role key, which bypasses RLS after its own checks.

alter table public.lesson_comments enable row level security;
alter table public.lesson_likes    enable row level security;


-- ############################################################################
--  6. updated_at trigger
-- ############################################################################

drop trigger if exists trg_comments_updated on public.lesson_comments;
create trigger trg_comments_updated before update on public.lesson_comments
  for each row execute function public.set_updated_at();


-- ############################################################################
--  7. Verification (read-only)
-- ############################################################################

select
  (select count(*) from information_schema.tables
     where table_schema = 'public'
       and table_name in ('lesson_comments', 'lesson_likes')) as comment_tables,
  (select count(*) from pg_indexes
     where schemaname = 'public'
       and indexname in ('idx_comments_lesson', 'idx_comments_parent', 'idx_comments_user',
                         'idx_comments_created', 'idx_likes_lesson', 'idx_likes_user')) as comment_indexes,
  (select count(*) from pg_constraint where conname = 'lesson_likes_lesson_id_user_id_key') as like_unique;
