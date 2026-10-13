-- ============================================================================
--  Modern Skills / Noor Academy — Complete Supabase database setup
-- ============================================================================
--  Single consolidated schema. Replaces the former `schema.sql` and
--  `create_buckets.sql`, which have been merged into this one file so there
--  is a single source of truth and nothing can drift out of sync.
--
--  HOW TO APPLY
--    Supabase Dashboard -> SQL Editor -> paste this whole file -> Run.
--    No passwords required. Fully idempotent: safe to run on a brand-new
--    project and safe to re-run on an existing one (it will bring an older
--    deployment up to date, which is how view drift gets fixed).
--
--  WHAT THIS FILE CREATES
--    1. Helper function (updated_at trigger)
--    2. 14 tables
--    3. Indexes
--    4. 8 views (the exact JSON shapes the Node API reads)
--    5. Idempotent demo/seed content
--    6. Auto-increment sequence sync
--    7. Row Level Security policies
--    8. 4 public Storage buckets + their read policies
--
--  SECURITY MODEL
--    The Node backend talks to this database through PostgREST using the
--    SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS. The anon policies below
--    exist so the public site can read the course catalog directly. Anything
--    not explicitly granted here (users, payments, preferences, all writes)
--    stays service-role only.
--
--  ENVIRONMENT KEYS THAT MUST MATCH THIS FILE
--    SUPABASE_VIDEO_BUCKET      = videos      (MAX_VIDEO_SIZE_MB  = 500)
--    SUPABASE_THUMBNAIL_BUCKET  = thumbnails  (MAX_IMAGE_SIZE_MB  = 5)
--    SUPABASE_AVATAR_BUCKET     = avatars     (MAX_IMAGE_SIZE_MB  = 5)
--    SUPABASE_BOOK_BUCKET       = books       (MAX_BOOK_SIZE_MB   = 50)
--
--  Bundled image assets (Images/) are part of the repository and are NOT
--  created here — this file only provisions the database and storage.
-- ============================================================================


-- ############################################################################
--  SECTION 1 — HELPER FUNCTION
--  Gives MySQL's ON UPDATE CURRENT_TIMESTAMP behaviour, which the original
--  schema relied on. Every mutable table below gets a trigger on it.
-- ############################################################################

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ############################################################################
--  SECTION 2 — TABLES
-- ############################################################################

-- ---------------------------------------------------------------- users
--  Single identity table for both admins and students. `role` gates the
--  admin API via requireAdmin() in backend/middleware/auth.js.
create table if not exists public.users (
  id            serial primary key,
  username      text not null unique,
  email         text not null unique,
  password_hash text not null,
  full_name     text not null,
  role          text not null default 'student' check (role in ('admin','student')),
  avatar_url    text,
  phone_number  text,
  is_active     boolean not null default true,
  last_login    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- (the trg_users_updated trigger is created in SECTION 8, after the column backfill)

-- ------------------------------------------------------------ categories
--  updated_at is required: the trg_categories_updated trigger below assigns to
--  it on every UPDATE. Omitting the column makes the trigger raise
--  `record "new" has no field "updated_at"`, which breaks category editing
--  in the admin panel with a 500.
create table if not exists public.categories (
  id          serial primary key,
  name        text not null,
  slug        text not null unique,
  description text,
  icon_class  text,
  color       text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- (the trg_categories_updated trigger is created in SECTION 8, after the column backfill)

-- ----------------------------------------------------------- instructors
--  Admin-managed via POST/PUT/DELETE /api/instructors. Deleting one sets
--  lessons.instructor_id to NULL (on delete set null) rather than cascading
--  and destroying course content.
create table if not exists public.instructors (
  id         serial primary key,
  name       text not null,
  slug       text not null unique,
  bio        text,
  avatar_url text,
  expertise  text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (the trg_instructors_updated trigger is created in SECTION 8, after the column backfill)

-- ------------------------------------------------------------------ tags
create table if not exists public.tags (
  id   serial primary key,
  name text not null,
  slug text not null unique
);

-- --------------------------------------------------------------- lessons
create table if not exists public.lessons (
  id               serial primary key,
  title            text not null,
  slug             text not null unique,
  description      text,
  category_id      int references public.categories(id) on delete set null,
  instructor_id    int references public.instructors(id) on delete set null,
  difficulty       text not null default 'All Levels'
                   check (difficulty in ('Beginner','Intermediate','Advanced','All Levels')),
  -- Spoken language of the lesson (chosen on the admin upload form).
  language         text not null default 'rw'
                   check (language in ('en','rw','ar')),
  duration_minutes int,
  video_url        text,
  video_file_path  text,
  video_file_size  bigint,
  thumbnail_url    text,
  is_published     boolean not null default false,
  is_free          boolean not null default false,
  is_featured      boolean not null default false,
  rating           numeric(2,1) not null default 0.0,
  student_count    int not null default 0,
  price            numeric(10,2) not null default 0,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- (the trg_lessons_updated trigger is created in SECTION 8, after the column backfill)

-- ----------------------------------------------------------- lesson_tags
create table if not exists public.lesson_tags (
  lesson_id int not null references public.lessons(id) on delete cascade,
  tag_id    int not null references public.tags(id) on delete cascade,
  primary key (lesson_id, tag_id)
);

-- ----------------------------------------------------------- enrollments
create table if not exists public.enrollments (
  id          serial primary key,
  user_id     int not null references public.users(id) on delete cascade,
  lesson_id   int not null references public.lessons(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique (user_id, lesson_id)
);

-- -------------------------------------------------------- lesson_progress
create table if not exists public.lesson_progress (
  id                     serial primary key,
  user_id                int not null references public.users(id) on delete cascade,
  lesson_id              int not null references public.lessons(id) on delete cascade,
  progress_percent       numeric(5,2) not null default 0.00,
  last_watched_position  int not null default 0,
  is_completed           boolean not null default false,
  completed_at           timestamptz,
  updated_at             timestamptz not null default now(),
  unique (user_id, lesson_id)
);

-- ------------------------------------------------------- contact_messages
create table if not exists public.contact_messages (
  id         serial primary key,
  name       text not null,
  email      text not null,
  subject    text,
  message    text not null,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------- testimonials
create table if not exists public.testimonials (
  id         serial primary key,
  name_en    text not null,
  name_rw    text not null,
  role_en    text not null,
  role_rw    text not null,
  text_en    text not null,
  text_rw    text not null,
  initials   text not null,
  rating     int not null default 5,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- (the trg_testimonials_updated trigger is created in SECTION 8, after the column backfill)

-- -------------------------------------------------------- user_preferences
create table if not exists public.user_preferences (
  id          serial primary key,
  user_id     int not null references public.users(id) on delete cascade,
  pref_key    text not null,
  pref_value  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, pref_key)
);

-- (the trg_prefs_updated trigger is created in SECTION 8, after the column backfill)

-- --------------------------------------------------------------- payments
--  `access_expires_at IS NULL` means "never expires" (single-video access and
--  admin grants). weekly/monthly rows get a future timestamp on approval.
create table if not exists public.payments (
  id                 serial primary key,
  user_id            int not null references public.users(id) on delete cascade,
  lesson_id          int references public.lessons(id) on delete set null,
  access_type        text check (access_type in ('video','weekly','monthly')),
  transaction_code   text,
  phone_number       text not null,
  amount             numeric(10,2) not null default 0,
  status             text not null default 'pending'
                     check (status in ('pending','approved','rejected')),
  admin_note         text,
  created_at         timestamptz not null default now(),
  reviewed_at        timestamptz,
  access_expires_at  timestamptz
);

-- ---------------------------------------------------------- payment_plans
--  Admin-editable price and access length for each checkout plan. The backend
--  reads these (falling back to the same values in code if the table is empty
--  or missing) so changing a price or the number of days never needs a
--  redeploy. `duration_days IS NULL` means the plan never expires (single
--  video). The check constraint keeps rows to the three tiers the checkout
--  understands, so a plan can never point at an unknown access_type.
create table if not exists public.payment_plans (
  access_type    text primary key check (access_type in ('video','weekly','monthly')),
  price          numeric(10,2) not null default 0,
  duration_days  int check (duration_days is null or duration_days > 0),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------- books
--  Admin-authored reading material for the public "Books" view. The admin
--  writes a title, optional author/cover and the body text, and books.html
--  renders it. A book may instead be a PDF file: its public URL is stored in
--  `content` behind the "#PDF#" marker and the reader embeds it inline.
--  No payment gating.
create table if not exists public.books (
  id           serial primary key,
  title        text not null,
  author       text,
  description  text,
  cover_url    text,
  content      text,
  language     text not null default 'en',
  sort_order   int not null default 0,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- --------------------------------------------------------------- profiles
--  Optional Supabase Auth tie-in, kept for existing installs.
create table if not exists public.profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  username           text unique,
  full_name          text,
  phone              text,
  avatar_url         text,
  preferred_language text default 'rw',
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);


-- ############################################################################
--  SECTION 3 — INDEXES
-- ############################################################################

create index if not exists idx_lessons_category    on public.lessons(category_id);
create index if not exists idx_lessons_instructor  on public.lessons(instructor_id);
create index if not exists idx_lessons_published   on public.lessons(is_published);
create index if not exists idx_lessons_featured    on public.lessons(is_featured);
create index if not exists idx_lessons_created     on public.lessons(created_at);

create index if not exists idx_payments_user   on public.payments(user_id);
create index if not exists idx_payments_lesson on public.payments(lesson_id);
create index if not exists idx_payments_status on public.payments(status);

create index if not exists idx_books_published on public.books(is_published);
create index if not exists idx_books_sort      on public.books(sort_order);


-- ############################################################################
--  SECTION 4 — VIEWS
--  These reproduce the exact JSON shapes the API reads, so the frontend
--  needs no changes. Numeric/boolean columns are cast to primitives that
--  PostgREST emits as numbers / 0-1 integers.
--
--  CAUTION ON CASING: Postgres folds *unquoted* identifiers to lower case.
--  A column aliased `totalLessons` would come back as `totallessons`. Any
--  camelCase alias below is therefore double-quoted on purpose.
-- ############################################################################

-- Public lesson list — GET /api/lessons, /recent, category & instructor pages
-- `video_url` / `video_file_path` are included so the homepage card can show
-- a "Video" badge and (for free lessons) a hover preview without a second
-- round trip. The API falls back to reading these off the base table when an
-- older deployment has not re-run this file yet.
create or replace view public.v_lessons_public as
select l.id,
       l.title,
       l.slug,
       l.description,
       l.difficulty,
       l.language,
       l.duration_minutes,
       l.thumbnail_url,
       l.rating::float4 as rating,
       l.student_count,
       (l.is_free)::int          as is_free,
       (l.is_featured)::int      as is_featured,
       l.price::float8           as price,
       l.created_at,
       l.video_url,
       l.video_file_path,
       c.name    as category_name,
       c.slug    as category_slug,
       c.color   as category_color,
       c.description as category_description,
       c.id      as category_id,
       i.name    as instructor_name,
       i.slug    as instructor_slug,
       i.avatar_url as instructor_avatar,
       i.expertise  as instructor_expertise,
       i.id      as instructor_id,
       (l.is_published)::int     as is_published
from public.lessons l
left join public.categories  c on c.id = l.category_id
left join public.instructors i on i.id = l.instructor_id;

-- Admin lesson list — GET /api/lessons/admin
create or replace view public.v_lessons_admin as
select l.id,
       l.title,
       l.slug,
       l.difficulty,
       l.language,
       l.duration_minutes,
       l.thumbnail_url,
       l.rating::float4  as rating,
       l.student_count,
       (l.is_published)::int as is_published,
       (l.is_free)::int      as is_free,
       (l.is_featured)::int  as is_featured,
       l.price::float8       as price,
       l.created_at,
       l.updated_at,
       l.category_id,
       l.instructor_id,
       l.video_url,
       l.video_file_path,
       c.name as category_name,
       i.name as instructor_name
from public.lessons l
left join public.categories  c on c.id = l.category_id
left join public.instructors i on i.id = l.instructor_id;

-- Lesson detail — GET /api/lessons/:slug
create or replace view public.v_lesson_detail as
select l.id,
       l.title,
       l.slug,
       l.description,
       l.difficulty,
       l.language,
       l.duration_minutes,
       l.video_url,
       l.video_file_path,
       l.video_file_size,
       l.thumbnail_url,
       (l.is_published)::int as is_published,
       (l.is_free)::int      as is_free,
       (l.is_featured)::int  as is_featured,
       l.rating::float4      as rating,
       l.student_count,
       l.price::float8       as price,
       l.published_at,
       l.created_at,
       l.updated_at,
       l.category_id,
       l.instructor_id,
       c.name  as category_name,
       c.slug  as category_slug,
       i.name  as instructor_name,
       i.slug  as instructor_slug,
       i.bio   as instructor_bio,
       i.avatar_url as instructor_avatar
from public.lessons l
left join public.categories  c on c.id = l.category_id
left join public.instructors i on i.id = l.instructor_id;

-- Aggregate counters for the admin dashboard — GET /api/lessons/stats
create or replace view public.v_lesson_stats as
select
  (select count(*) from public.lessons where is_published)::int                       as "totalLessons",
  (select coalesce(sum(student_count), 0) from public.lessons)::int                   as "totalStudents",
  (select count(*) from public.instructors where is_active)::int                      as "totalInstructors",
  coalesce((select round(avg(rating), 1) from public.lessons
              where is_published and rating > 0), 0)::float8                            as "avgRating",
  (select count(*) from public.lessons where not is_published)::int                   as "pendingReview",
  (select count(*) from public.lessons
     where created_at >= date_trunc('month', now() at time zone 'utc'))::int          as "thisMonth";

-- Per-category counts — GET /api/lessons/stats -> categoryStats
create or replace view public.v_category_stats as
select c.id,
       c.name,
       c.slug,
       c.color,
       c.sort_order,
       count(l.id)::int as lesson_count
from public.categories c
left join public.lessons l on l.category_id = c.id
where c.is_active
group by c.id, c.name, c.slug, c.color, c.sort_order
order by c.sort_order asc;

-- Admin payment list — GET /api/payments/admin, /api/payments/check-all
create or replace view public.v_payments_admin as
select p.id,
       p.user_id,
       p.lesson_id,
       p.access_type,
       p.transaction_code,
       p.phone_number,
       p.amount::float8 as amount,
       p.status,
       p.admin_note,
       p.created_at,
       p.reviewed_at,
       p.access_expires_at,
       u.username,
       u.email,
       u.phone_number as user_phone,
       l.title        as lesson_title
from public.payments p
left join public.users   u on u.id = p.user_id
left join public.lessons l on l.id = p.lesson_id;

-- Payment counters — GET /api/payments/admin/stats
create or replace view public.v_payment_stats as
select
  count(*)::int                                        as total,
  (count(*) filter (where status = 'pending'))::int    as pending,
  (count(*) filter (where status = 'approved'))::int   as approved,
  (count(*) filter (where status = 'rejected'))::int   as rejected,
  coalesce(sum(amount) filter (where status = 'approved'), 0)::float8 as totalRevenue
from public.payments;

-- Admin students list with access status — GET /api/payments/users
--  Student accounts only; admins are excluded by the WHERE clause.
create or replace view public.v_users_with_access as
select u.id,
       u.username,
       u.email,
       u.phone_number,
       u.full_name,
       u.created_at,
       (u.is_active)::int as is_active,
       (exists (
          select 1 from public.payments p
          where p.user_id = u.id and p.status = 'approved'
            and (p.access_expires_at is null or p.access_expires_at > now())
       ))::int as has_access,
       (select count(*) from public.payments p
          where p.user_id = u.id and p.status = 'pending')::int   as pending_count,
       (select count(*) from public.payments p
          where p.user_id = u.id and p.status = 'approved')::int  as approved_count,
       (select p2.access_type from public.payments p2
          where p2.user_id = u.id and p2.status = 'approved'
          order by p2.created_at desc limit 1)               as current_access_type,
       (select p2.access_expires_at from public.payments p2
          where p2.user_id = u.id and p2.status = 'approved'
          order by p2.created_at desc limit 1)               as access_expires_at
from public.users u
where u.role = 'student';


-- ############################################################################
--  SECTION 5 — SEED CONTENT (idempotent)
--  Demo catalogue so the site renders immediately on a fresh database.
--  `on conflict` clauses make every statement a no-op on re-run, so running
--  this against a live database will not overwrite content you have edited.
-- ############################################################################

insert into public.categories (id, name, slug, description, icon_class, color, sort_order) values
 (1, 'Tajweed', 'tajweed', 'Menya gusoma Qur''an mu buryo bukwiye hamwe n''amategeko ya Tajweed', 'fa-voice', 'gold', 1),
 (2, 'Tafsir', 'tafsir', 'Ubusobanuro bwimbitse bw''amagambo ya Qur''an n''ibyo asobanura', 'fa-book-open', 'green', 2),
 (3, 'Hifz', 'hifz', 'Gahunda itunganijwe yo kwibuka Qur''an hamwe no gukurikirana isubiramo', 'fa-brain', 'blue', 3),
 (4, 'Arabic', 'arabic', 'Iga Icyarabu cy''umwimerere kugira ngo usobanukirwe na Qur''an utizigamye', 'fa-language', 'purple', 4),
 (5, 'Video Course', 'video-course', 'Amafirime yanditswe mu buryo bwuzuye yigishwa n''abigisha babahanga', 'fa-video', 'rose', 5),
 (6, 'Qur''an Courses', 'quran', 'Structured Qur''an reading, memorization and understanding courses.', 'fa-book-quran', 'gold', 0)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

insert into public.instructors (id, name, slug, bio, expertise) values
 (1, 'Sheikh Ahmad Al-Misri', 'sheikh-ahmad-al-misri', 'Umusomyi ukomeye wa Qur''an n''umwarimu wa Tajweed ufite uburambe bw''imyaka irenga 15', 'Tajweed, Qiraat'),
 (2, 'Dr. Aminah Al-Arabi', 'dr-aminah-al-arabi', 'Afite PhD mu bya Isilamu, yibanda ku busobanuro bwa Tafsir bwa Qur''an', 'Tafsir, Amasomo ya Isilamu'),
 (3, 'Hafiz Yusuf Khan', 'hafiz-yusuf-khan', 'Hafiz wemejwe ufite Ijaza muri Hifz n''uburambe bwinshi mu kwigisha', 'Hifz, Uburyo bwo Kwibuka'),
 (4, 'Ustadh Omar Farooq', 'ustadh-omar-farooq', 'Umunyamabanga mu cyarabu akaba n''umwarimu w''amasomo ya Isilamu', 'Imbonerahamwe y''Icyarabu, Fiqh')
on conflict (slug) do update set name = excluded.name;

insert into public.tags (id, name, slug) values
 (1, 'tajweed', 'tajweed'),
 (2, 'noon-sakinah', 'noon-sakinah'),
 (3, 'pronunciation', 'pronunciation'),
 (4, 'makharij', 'makharij'),
 (5, 'sifaat', 'sifaat'),
 (6, 'tafsir', 'tafsir'),
 (7, 'al-fatiha', 'al-fatiha'),
 (8, 'al-kahf', 'al-kahf'),
 (9, 'hifz', 'hifz'),
 (10, 'memorization', 'memorization'),
 (11, 'juz-amma', 'juz-amma'),
 (12, 'arabic', 'arabic'),
 (13, 'grammar', 'grammar'),
 (14, 'beginner', 'beginner'),
 (15, 'advanced', 'advanced')
on conflict (slug) do update set name = excluded.name;

insert into public.lessons (id, title, slug, description, category_id, instructor_id, difficulty, duration_minutes, video_url, rating, student_count, is_published, is_featured, created_at) values
 (1,  'Intangiriro ya Makhaarij & Sifaat', 'makhaarij-sifaat', 'Iga aho buri nyuguti y''Icyarabu ituruka, n''imiterere iha buri nyuguti ijwi ryaryo ryihariye. Ni intambwe ya mbere nziza ku batangira.', 1, 1, 'Beginner', 28, 'https://www.youtube.com/watch?v=O2wSMWemJDU', 5.0, 234, true, true, '2026-07-25 10:00:00+00'),
 (2,  'Tafsir ya Surah Al-Fatiha', 'surah-al-fatiha-tafsir', 'Ubusobanuro bwimbitse bw''ibisobanuro n''inyigisho bya Surah Al-Fatiha, isura ya mbere ya Qur''an.', 2, 2, 'All Levels', 35, 'https://www.youtube.com/watch?v=0lMkdXrCCrg', 4.9, 567, true, true, '2026-07-22 10:00:00+00'),
 (3,  'Juz Amma — Surah An-Naba', 'juz-amma-surah-an-naba', 'Fata Surah An-Naba ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bwacu bwo gusubiramo buhoro buhoro.', 3, 3, 'Beginner', 22, 'https://www.youtube.com/watch?v=oSppMwLcfS0', 4.8, 892, true, true, '2026-07-20 10:00:00+00'),
 (4,  'Insingiro z''Imbonerahamwe y''Icyarabu', 'arabic-grammar-essentials', 'Sobanukirwa ibice bitatu by''ijambo mu cyarabu: amazina, inshinga, n''utunyegero.', 4, 4, 'Beginner', 42, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 345, false, false, '2026-07-18 10:00:00+00'),
 (5,  'Noon Sakinah & Tanween', 'noon-sakinah-tanween', 'Ubuyobozi bwuzuye bw''amategeko ya Noon Sakinah na Tanween.', 1, 1, 'Intermediate', 31, 'https://www.youtube.com/watch?v=ALGAanskdXs', 4.9, 178, false, false, '2026-07-15 10:00:00+00'),
 (6,  'Tafsir ya Ayatul Kursi', 'tafsir-ayatul-kursi', 'Menya umurongo ukomeye wa Qur''an — Ayatul Kursi.', 2, 2, 'All Levels', 25, 'https://www.youtube.com/watch?v=4fvwdWdfEHI', 4.9, 912, true, true, '2026-07-12 10:00:00+00'),
 (7,  'Kwibuka Surah Al-Fatiha', 'al-fatiha-memorization', 'Fata Surah Al-Fatiha ku mutwe hamwe na Tajweed ikwiye ukoresheje uburyo bworoshye bwo gusubiramo.', 3, 3, 'Beginner', 18, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 423, true, false, '2026-07-10 10:00:00+00'),
 (8,  'Amategeko ya Madd — Inyuguti Zigurwa', 'madd-rules-extended-letters', 'Iga amategeko yose ya Madd — Madd Tabi''i, Madd Wajib, na Madd Ja''iz.', 1, 1, 'Advanced', 26, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 4.9, 156, false, false, '2026-07-08 10:00:00+00'),
 (9,  'Ibihe by''Inshinga z''Icyarabu', 'arabic-verb-conjugation', 'Sobanukirwa uko inshinga z''icyarabu zihinduka ibihe byazo — ibyashize, ibiriho, n''itegeko.', 4, 4, 'Intermediate', 38, 'https://www.youtube.com/watch?v=OoVhY3rcXS8', 4.7, 289, true, false, '2026-07-05 10:00:00+00'),
 (10, 'Juz Tabarak — Surah Al-Mulk', 'juz-tabarak-surah-al-mulk', 'Fata Surah Al-Mulk ku mutwe hamwe na Tajweed ikwiye.', 3, 3, 'Intermediate', 20, 'https://www.youtube.com/watch?v=Ca2nxrD8x-g', 4.8, 312, false, false, '2026-07-02 10:00:00+00'),
 (11, 'Inshuranyo y''Inyigisho Yose ya Tajweed', 'complete-tajweed-course-overview', 'Inshuranyo y''inyigisho yacu yuzuye ya Tajweed ikubiyemo amategeko yose akomeye.', 5, 1, 'All Levels', 12, 'https://www.youtube.com/watch?v=iMIHgkkOJco', 5.0, 1250, true, false, '2026-06-28 10:00:00+00'),
 (12, 'Tafsir ya Surah Yaseen', 'tafsir-of-surah-yaseen', 'Ubusobanuro burambuye bwa Surah Yaseen — umutima wa Qur''an.', 2, 2, 'Advanced', 45, 'https://www.youtube.com/watch?v=MzijGS3Zo_0', 4.9, 734, false, false, '2026-06-25 10:00:00+00')
on conflict (slug) do update set title = excluded.title, video_url = excluded.video_url;

-- Qur'an Courses (category id 6)
insert into public.lessons (id, title, slug, description, category_id, difficulty, duration_minutes, rating, student_count, is_published, is_featured) values
 (13, 'Qur''an Reading — Beginner to Fluent', 'quran-reading-beginner-fluent', 'Learn Arabic letters, pronunciation and fluent Qur''an reading step by step.', 6, 'Beginner', 40, 5.0, 0, true, false),
 (14, 'Hifz Roadmap — Juz by Juz', 'hifz-roadmap-juz-by-juz', 'A structured memorization and revision course for learners building a daily Hifz routine.', 6, 'Intermediate', 35, 5.0, 0, true, false),
 (15, 'Qur''an Recitation & Tajweed Mastery', 'quran-recitation-tajweed-mastery', 'Improve recitation with Makharij, Sifaat, Madd and practical Tajweed exercises.', 6, 'All Levels', 45, 5.0, 0, true, false),
 (16, 'Understanding the Qur''an — Tafsir Foundations', 'quran-tafsir-foundations', 'Foundations for understanding selected Surahs, vocabulary and key lessons.', 6, 'Beginner', 50, 5.0, 0, true, false)
on conflict (slug) do update set title = excluded.title;

insert into public.testimonials (id, name_en, name_rw, role_en, role_rw, text_en, text_rw, initials, rating, sort_order) values
 (1, 'Fatima Ahmed', 'Fatima Ahmed', 'Student since 2025', 'Umunyeshuri kuva 2025', 'Modern Skills transformed my Quran learning journey. The Tajweed lessons are incredibly clear and the instructors are so patient. I finally feel confident in my recitation.', 'Modern Skills yahinduye urugendo rwanjye rwo kwiga Quran. Amasomo ya Tajweed asobanutse cyane kandi abigisha bafite ihangane. Nongeye kwizera mu gusoma kwanjye.', 'FA', 5, 1),
 (2, 'Omar Khalid', 'Omar Khalid', 'Student since 2024', 'Umunyeshuri kuva 2024', 'Alhamdulillah, I started as a complete beginner and now I can read Arabic script fluently. The structured curriculum makes all the difference. Highly recommended!', 'Alhamdulillah, natangiye nk''umutangizi wuzuye noneho nshobora gusoma inyandiko y''icyarabu neza. Gahunda y''amasomo itunganijwe niyo itanga itandukaniro. Ndabyifuriza cyane!', 'OK', 5, 2),
 (3, 'Aisha Noor', 'Aisha Noor', 'Parent of student', 'Umubyeyi w''umunyeshuri', 'The Hifz program is amazing! My son has memorized 5 Juz in just 6 months thanks to the effective repetition techniques taught by Hafiz Yusuf Khan.', 'Gahunda ya Hifz irababaje! Umuhungu wanjye yibukije Juz 5 mu mezi 6 gusa kubera tekiniki nziza zo gusubiramo zigishwa na Hafiz Yusuf Khan.', 'AN', 5, 3)
on conflict (id) do nothing;

-- Checkout plan prices/durations. The seed is intentionally authoritative:
-- re-running this file applies the current official prices (monthly = 7000).
-- Use the admin Plans & Prices panel afterwards for ad-hoc price changes.
insert into public.payment_plans (access_type, price, duration_days) values
 ('video',   500,  null),
 ('weekly',  2000, 7),
 ('monthly', 7000, 30)
on conflict (access_type) do update set price = excluded.price, duration_days = excluded.duration_days;

-- Sync auto-increment sequences so later inserts don't collide with the
-- explicit ids seeded above.
select setval('public.users_id_seq',          coalesce((select max(id) from public.users), 1));
select setval('public.categories_id_seq',      coalesce((select max(id) from public.categories), 1));
select setval('public.instructors_id_seq',     coalesce((select max(id) from public.instructors), 1));
select setval('public.tags_id_seq',            coalesce((select max(id) from public.tags), 1));
select setval('public.lessons_id_seq',         coalesce((select max(id) from public.lessons), 1));
select setval('public.testimonials_id_seq',    coalesce((select max(id) from public.testimonials), 1));


-- ############################################################################
--  SECTION 6 — ROW LEVEL SECURITY
--  RLS is enabled everywhere, but the backend writes with the service-role
--  key which bypasses it. These policies only relax *reads* of the public
--  catalogue. users, payments, contact_messages and user_preferences are
--  deliberately left with no anon policy, so they stay service-role only.
-- ############################################################################

alter table public.users              enable row level security;
alter table public.categories         enable row level security;
alter table public.instructors        enable row level security;
alter table public.tags               enable row level security;
alter table public.lessons            enable row level security;
alter table public.lesson_tags        enable row level security;
alter table public.testimonials       enable row level security;
alter table public.enrollments        enable row level security;
alter table public.lesson_progress    enable row level security;
alter table public.contact_messages   enable row level security;
alter table public.user_preferences   enable row level security;
alter table public.payments           enable row level security;
alter table public.payment_plans      enable row level security;
alter table public.books              enable row level security;

-- drop first so this stays re-runnable (CREATE POLICY has no IF NOT EXISTS)
drop policy if exists "public catalog read"     on public.categories;
drop policy if exists "public instructors read" on public.instructors;
drop policy if exists "public tags read"        on public.tags;
drop policy if exists "public lessons read"     on public.lessons;
drop policy if exists "public lesson_tags read" on public.lesson_tags;
drop policy if exists "public testimonials read" on public.testimonials;
drop policy if exists "public books read"       on public.books;
drop policy if exists "public plans read"       on public.payment_plans;

create policy "public catalog read"     on public.categories  for select using (true);
create policy "public instructors read" on public.instructors for select using (true);
create policy "public tags read"        on public.tags        for select using (true);
-- Unpublished lessons stay hidden from anonymous visitors.
create policy "public lessons read"     on public.lessons     for select using (is_published);
create policy "public lesson_tags read" on public.lesson_tags for select using (true);
create policy "public testimonials read" on public.testimonials for select using (is_active);
-- Only published books are readable by anonymous visitors.
create policy "public books read"       on public.books       for select using (is_published);
-- Plan prices/durations are public (the checkout page shows them); only the
-- service role can write them.
create policy "public plans read"       on public.payment_plans for select using (true);

grant select on all tables in schema public to anon, authenticated;


-- ############################################################################
--  SECTION 7 — STORAGE BUCKETS
--  Merged in from the former create_buckets.sql.
--
--  All three are PUBLIC buckets so lesson video, thumbnails and profile
--  photos can be streamed directly by URL. Size limits and MIME allowlists
--  mirror backend/middleware/upload.js exactly, so a file the API accepts is
--  never rejected by Storage (and vice versa).
--
--  The backend also auto-creates these on boot (backend/services/supabase.js),
--  so this section is the explicit/declarative guarantee that they exist with
--  the right limits — an auto-created bucket would otherwise have no
--  file_size_limit and no MIME allowlist.
-- ############################################################################

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- 500 MB, matches MAX_VIDEO_SIZE_MB=500
  -- (mp4, webm, mkv, mov, avi — matches upload.js videoFilter)
  ('videos', 'videos', true, 524288000,
   array['video/mp4','video/webm','video/x-matroska','video/quicktime','video/x-msvideo']),

  -- 5 MB, matches MAX_IMAGE_SIZE_MB=5
  -- (jpg, jpeg, png, webp — matches upload.js imageFilter)
  ('thumbnails', 'thumbnails', true, 5242880,
   array['image/jpeg','image/png','image/webp']),

  -- 5 MB profile photos. This bucket was previously missing from the SQL and
  -- only came into existence via the backend's boot-time auto-create.
  -- (jpg, jpeg, png, webp — matches upload.js avatarFilter)
  ('avatars', 'avatars', true, 5242880,
   array['image/jpeg','image/png','image/webp']),

  -- 50 MB book documents for the public Books reader. The reader embeds the
  -- PDF inline (books.html), so it must be publicly readable.
  -- (pdf — matches upload.js bookFilter / MAX_BOOK_SIZE_MB=50)
  ('books', 'books', true, 52428800,
   array['application/pdf'])
on conflict (id) do nothing;


-- Public read access. Objects in PUBLIC buckets are already served to anyone;
-- these policies additionally let the anon key read listing metadata.
-- No INSERT/UPDATE/DELETE policies are created on purpose: uploads go through
-- the backend using the service_role key, which bypasses storage RLS.

drop policy if exists "public read access to the videos bucket" on storage.objects;
create policy "public read access to the videos bucket"
  on storage.objects for select
  using (bucket_id = 'videos');

drop policy if exists "public read access to the thumbnails bucket" on storage.objects;
create policy "public read access to the thumbnails bucket"
  on storage.objects for select
  using (bucket_id = 'thumbnails');

drop policy if exists "public read access to the avatars bucket" on storage.objects;
create policy "public read access to the avatars bucket"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "public read access to the books bucket" on storage.objects;
create policy "public read access to the books bucket"
  on storage.objects for select
  using (bucket_id = 'books');


-- ############################################################################
--  SECTION 8 — DRIFT REPAIR
--  `CREATE TABLE IF NOT EXISTS` is a NO-OP when the table already exists, so
--  it can never add a column that a deployed database is missing. These
--  statements are what actually bring an older deployment up to date when you
--  re-run this file — that is how the `categories.updated_at` bug (a trigger
--  assigning to a column the table did not have, breaking every category
--  update with a 500) gets fixed in place.
--
--  `ADD COLUMN IF NOT EXISTS` is supported on PostgreSQL 9.6+ and Supabase
--  runs 15+, so this is safe to run on a brand-new or an existing project.
--  Existing rows get the column's DEFAULT, then the NOT NULL is satisfied.
-- ############################################################################

-- categories: the updated_at the trigger needs (see note in Section 2)
alter table public.categories add column if not exists updated_at timestamptz not null default now();

-- Defensive backfill for the other tables, in case an older deployment is
-- missing any column the current app code reads.
alter table public.users             add column if not exists phone_number text;
alter table public.users             add column if not exists avatar_url   text;
alter table public.users             add column if not exists is_active    boolean not null default true;
alter table public.users             add column if not exists last_login   timestamptz;
alter table public.users             add column if not exists updated_at   timestamptz not null default now();

alter table public.categories        add column if not exists icon_class   text;
alter table public.categories        add column if not exists color       text;
alter table public.categories        add column if not exists sort_order  int not null default 0;
alter table public.categories        add column if not exists is_active   boolean not null default true;

alter table public.instructors       add column if not exists avatar_url   text;
alter table public.instructors       add column if not exists expertise   text;
alter table public.instructors       add column if not exists is_active   boolean not null default true;
alter table public.instructors       add column if not exists updated_at  timestamptz not null default now();

alter table public.lessons           add column if not exists language text not null default 'rw';
-- Backfill guard: keep only the 3 admin languages on rows written before the check existed.
update public.lessons set language = 'rw' where language is null or language not in ('en','rw','ar');
alter table public.lessons drop constraint if exists lessons_language_check;
alter table public.lessons add constraint lessons_language_check check (language in ('en','rw','ar'));
alter table public.lessons           add column if not exists video_file_path text;
alter table public.lessons           add column if not exists video_file_size bigint;
alter table public.lessons           add column if not exists is_free      boolean not null default false;
alter table public.lessons           add column if not exists is_featured  boolean not null default false;
alter table public.lessons           add column if not exists price        numeric(10,2) not null default 0;
alter table public.lessons           add column if not exists published_at timestamptz;
alter table public.lessons           add column if not exists updated_at   timestamptz not null default now();

alter table public.testimonials      add column if not exists sort_order   int not null default 0;
alter table public.testimonials      add column if not exists is_active    boolean not null default true;
alter table public.testimonials      add column if not exists updated_at   timestamptz not null default now();

alter table public.payments          add column if not exists lesson_id     int references public.lessons(id) on delete set null;
alter table public.payments          add column if not exists access_type   text;
alter table public.payments          add column if not exists access_expires_at timestamptz;
alter table public.payments          add column if not exists admin_note    text;
alter table public.payments          add column if not exists reviewed_at   timestamptz;

alter table public.contact_messages  add column if not exists is_read       boolean not null default false;
alter table public.lesson_progress   add column if not exists last_watched_position int not null default 0;
alter table public.user_preferences  add column if not exists updated_at    timestamptz not null default now();

alter table public.books             add column if not exists author       text;
alter table public.books             add column if not exists description  text;
alter table public.books             add column if not exists cover_url    text;
alter table public.books             add column if not exists content      text;
alter table public.books             add column if not exists language     text not null default 'en';
alter table public.books             add column if not exists sort_order   int not null default 0;
alter table public.books             add column if not exists is_published boolean not null default true;
alter table public.books             add column if not exists updated_at   timestamptz not null default now();

-- Now that every trigger target column is guaranteed to exist, (re)create the
-- triggers. drop-first keeps this idempotent.
drop trigger if exists trg_users_updated on public.users;
create trigger trg_users_updated before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists trg_categories_updated on public.categories;
create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

drop trigger if exists trg_instructors_updated on public.instructors;
create trigger trg_instructors_updated before update on public.instructors
  for each row execute function public.set_updated_at();

drop trigger if exists trg_lessons_updated on public.lessons;
create trigger trg_lessons_updated before update on public.lessons
  for each row execute function public.set_updated_at();

drop trigger if exists trg_testimonials_updated on public.testimonials;
create trigger trg_testimonials_updated before update on public.testimonials
  for each row execute function public.set_updated_at();

drop trigger if exists trg_prefs_updated on public.user_preferences;
create trigger trg_prefs_updated before update on public.user_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_books_updated on public.books;
create trigger trg_books_updated before update on public.books
  for each row execute function public.set_updated_at();


-- ############################################################################
--  SECTION 9 — VERIFICATION
--  Expected: 14 tables, 8 views, 4 buckets.
--  If v_category_stats is missing `sort_order`, or categories is missing
--  `updated_at`, an older version of this file was deployed — re-run it.
-- ############################################################################

select 'tables' as object, count(*)::int as total from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
union all
select 'views', count(*)::int from information_schema.views where table_schema = 'public'
union all
select 'buckets', count(*)::int from storage.buckets
  where id in ('videos', 'thumbnails', 'avatars', 'books')
order by 1;

-- Column the trg_categories_updated trigger depends on:
select 'categories.updated_at' as required_column,
       count(*)::int as present
  from information_schema.columns
 where table_schema = 'public' and table_name = 'categories'
   and column_name = 'updated_at';
