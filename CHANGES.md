# Changes — Multi-language, npm start fix, Qur'an category, security fix

## Latest — book PDFs render inline on the Books page (no new tab)

Admins can now publish a book as a **PDF**, and visitors read it inside the
Books page reader — it never opens a separate browser tab.

- **Admin (`admin.html`).** The Add/Edit Book form has a new "Book file (PDF)"
  upload box. Choosing a PDF uploads it to `POST /api/upload/book-file` and
  stores the returned public URL in a hidden field. On submit the URL is
  written into the book's existing `content` column behind a `#PDF#` marker
  (`content = "#PDF#<url>"`), so **no database migration is required**.
  Editing a PDF book re-populates the box; resetting the form clears it.
- **Reader (`books.html`).** `openReader()` detects the `#PDF#` marker and
  embeds the file in a full-height `<iframe class="book-pdf">` inside the
  reader overlay (`#view=FitH`), with the text padding switched off
  (`.reader-content.pdf-mode`). Normal text books still render as Markdown
  exactly as before.
- **Backend.** New `POST /api/upload/book-file` (admin-only) accepts **PDF
  only** (extension or `application/pdf`, max `MAX_BOOK_SIZE_MB` = 50) via a
  new `uploadBook` multer instance (`backend/middleware/upload.js`). Files are
  mirrored to a new **`books`** Supabase Storage bucket
  (`uploadBookFileToSupabase`, auto-created on boot), falling back to
  `/uploads/books/...` when Supabase isn't configured. `supabase/Schrema.sql`
  now declares the `books` bucket + its public-read policy and the verification
  count was updated to 4 buckets.
- **Env.** `SUPABASE_BOOK_BUCKET=books`, `MAX_BOOK_SIZE_MB=50` in
  `backend/.env`.
- **Verified end to end (headless Chrome over the DevTools Protocol):**
  - admin login → upload a PDF → it lands in the `books` bucket
    (`stored:supabase`) → create a book → the reader shows
    `pdfMode:true`, an `iframe.book-pdf` with the correct `src`, and no
    console errors;
  - a plain text book still renders `<h1>`/`<strong>` (no regression);
  - a non-PDF upload is rejected (`Invalid book format. Allowed: .pdf`);
  - the Supabase PDF URL returns `200 application/pdf`, `Access-Control-
    Allow-Origin: *` and **no** `X-Frame-Options` (so it embeds fine).

## Previously — the uploaded video now actually displays (root cause: startup crash) + "Paid" labels

The uploaded lesson video (a Supabase `.mp4`) still never appeared on
`video.html`, for **every** flow. It was not a player bug at all: the whole
inline page script was **aborting on its first line of work**, so nothing —
title, player, lesson data — was ever initialised and the DOM stayed on the
static "lesson 1" placeholder.

- **Root cause.** `setLang()` (called once near the top of the script) ends by
  calling `renderTierCards()`. That function read `PLANS_BY_TIER[...]`, a `var`
  that is *hoisted but not yet assigned* at that point in the file. The lookup
  threw `TypeError: Cannot read properties of undefined (reading 'video')`,
  which halted the entire script — so `initVideoDetail()`, the player wiring
  and the API fetch never ran. `renderTierCards()` now bails out
  (`if (!PLANS_BY_TIER) return;`) when called before the plans load;
  `loadPlans()` repaints the tier cards afterwards. `planPriceText()` is
  guarded the same way.
- **Auto-show the real video on every flow**, not just after a click:
  - guest / signed-in without access → the timed preview starts on arrival;
  - paid subscriber → the full lesson starts on arrival (previously it waited
    for a click, so the player looked empty). A click still restores sound
    (programmatic autoplay falls back to muted, per browser policy).
- **Player hardening** so the picture can never hide behind the poster:
  `#realVideo` now has a `z-index` above the thumbnail/gradient, `playAt()`
  forces `display:block` + `v.load()` on a source change, and native controls
  are enabled.
- **"Paid" instead of "500 RWF" on lesson displays.** Every lesson is paid, so
  the per-lesson amount was misleading. `video.html` (`priceTag`,
  `instructorPriceValue`) and `admin.html` (lesson table) now show a localized
  **Paid** label, and the home-page badge is a localized **Paid** chip
  (`data-lang` spans) instead of `500 RWF`. The plan prices in the payment
  overlay (500 / 2,000 / 7,000 RWF) are unchanged.
- **Verified in a real browser (headless Chrome driven over the DevTools
  Protocol):**
  - `video.html?id=16` → `#realVideo` `display:block`, `paused:false`,
    `duration:60.9`, correct Supabase `src`, **no console errors**.
  - `video.html?id=1` (YouTube) → iframe built; `video.html?id=13` (no source)
    → graceful "Video coming soon".
  - `index.html` → 16 cards, 16 "Paid" badges, only the active language shown,
    no `RWF` on any card, no console errors.

## Previously — uploaded-video playback: real duration + reliable start

Fixes the video page showing a frozen `0:00 / 0:00` (and no picture) for
lessons that were **uploaded as a file** rather than given a YouTube URL.

- **Root cause of the frozen `0:00 / 0:00`.** The free preview auto-starts
  from a timer (`setTimeout`), not from a click. Browsers refuse an *unmuted*
  `play()` that has no user gesture, and the rejection was swallowed with
  `v.play().catch(() => {})` — so the native `<video>` stayed paused on frame
  zero. YouTube lessons were unaffected because YouTube shows its own poster,
  which is why the bug only showed on uploaded files.
  - `playVideo()` now retries **muted** when a programmatic `play()` is
    refused (the way social/streaming previews autoplay). A real click still
    plays with sound, and `startActualPlayback()` clears the preview's mute so
    paid playback has audio.
  - If even the muted retry is refused, the player falls back to the poster +
    play button (`showControlsForRetry()`), so it never sits on a dead frame.
- **The duration is real now.** Uploaded lessons usually have no
  `duration_minutes`, so the poster was stuck at `0:00 / 0:00` until playback
  began. `#realVideo` now uses `preload="metadata"` and the source is set as
  soon as the lesson loads, so `loadedmetadata` paints the true length
  (`0:00 / 3:42`) before the first play. A shared `pendingSeek` replaces the
  old code that added a new `loadedmetadata` listener on every `playAt()`.
- **Load failures are visible.** An `error` listener on the video shows a
  clear "video not uploaded" toast instead of a silent black player.
- Verified: `video.html` parses, serves 200, and `/api/lessons/16` (the
  uploaded Supabase `.mp4` lesson) still returns `video_file_path`.

## Previously — admin edits now propagate to the home page + "Lessons" navbar link

- **Admin → home page stays in sync.** A lesson the admin edits, publishes or
  deletes now shows up on `index.html`:
  - The homepage already re-fetched `/api/lessons` on load, but that GET could
    be answered from the browser's HTTP cache. It now fetches with
    `cache: 'no-store'` and a `_=<timestamp>` query, so an edited lesson is
    never served stale.
  - **Live cross-tab sync.** `admin.html` broadcasts a `noorDataUpdated`
    marker to `localStorage` after every data reload (i.e. after every
    create/edit/publish/delete). An already-open homepage listens for the
    `storage` event and repaints the rows immediately — no manual refresh.
  - `loadHome()` was refactored into `paintHome()` + `fetchHomeData()` (with
    module-level `homeLessons`/`homeCategories`/`homeInstructors`) so both the
    first paint and the live refresh render from the same state.
- **"Lessons" link in the navbar.** Added between *Home* and *Books* (five
  languages: Lessons / Amasomo / Leçons / Masomo / الدروس). On `index.html` it
  jumps to `#categoryRows`, the movie-style lesson rows that the public page
  already uses (the existing "Browse Lessons" button targets the same anchor).
  On `books.html` and `video.html` it links to `index.html#categoryRows` since
  that listing lives on the home page.
- Verified: `index.html`/`admin.html`/`books.html`/`video.html` all serve 200
  and `GET /api/lessons?limit=5` returns rows after the change.

## Previously — video page: reliable playback, correct gating, resume after payment

- **The video actually shows and plays now.** Three concrete player bugs were
  fixed in `video.html`:
  - `resetPlayerVisual()` never hid the native `<video>` / YouTube iframe, so
    after a preview ended the paused frame stayed painted over the poster and
    the play button — a frozen, unclickable player. It now hides the real
    player and restores the poster + controls.
  - Clicking the video surface (not just the round play button) now starts
    playback, which is what users expect when they click a video.
  - Landing on a locked lesson auto-starts the preview instead of leaving a
    static thumbnail.
- **Guest vs signed-in preview.** Not signed in → **10 seconds**, then a toast
  ("register or sign in to continue") and a redirect to `login.html` with the
  lesson preserved in `?next=`. Signed in without access → **15 seconds**, then
  the payment overlay. (Was a flat 20s for everyone.)
- **Continue where you stopped.** The player now remembers the position
  (`localStorage['ms_progress_<lessonId>']`). The preview starts from that
  position, and once payment is submitted **and approved by the admin** (the
  overlay polls, or the student taps "Check Status") playback resumes from
  exactly where the preview stopped instead of restarting. Works for both the
  native `<video>` and the YouTube embed (via the `start` parameter). Paid
  viewers' progress is saved as they watch (throttled).
- Verified against the live API: `video.html`/`index.html`/`admin.html` 200,
  `GET /api/lessons/1` returns the YouTube URL, `GET /api/lessons/16` the
  uploaded file, and `check-all` returns `hasAccess:false` for an unpaid user
  (so the 15s→payment gate engages).

## Previously — paid-by-default videos, preview gating, Books link, admin pricing

- **Videos are paid by default.** `backend/routes/lessons.js` no longer treats
  `price === 0` as free when deciding whether to hand out a stream URL — only an
  explicit `is_free` flag makes a lesson free. The public lesson list now strips
  `video_url` / `video_file_path` for every non-free lesson (verified:
  `GET /api/lessons` returns `video_url: null`, `has_video: true`), while the
  detail route (`GET /api/lessons/:id`, used by the player) still returns the
  source so the preview can play.
- **Home page shows prices, not "Free".** `index.html`'s lesson card now renders
  a gold `paid-badge` with the lesson price (falling back to the live
  single-video tier price from `/api/plans`) unless the lesson is explicitly
  marked free.
- **Tiered free preview.** `video.html` shows guests a 10-second preview and
  signed-in users without access a 15-second preview (was a flat 20s for
  everyone). The preview banner's count is filled in at runtime.
- **The video now starts on its own.** Landing on a locked lesson auto-starts
  the preview instead of leaving a static thumbnail, so clicking a video on the
  home page immediately shows the video. Paid subscribers keep the play button.
  After the preview, guests are sent to sign in and signed-in users get the
  payment overlay with plan selection.
- **Books link on the video page.** The top nav's "Courses" link
  (`video.html`) now points to `books.html` with the same five-language labels
  used on the home page.
- **Admin edit lesson form: no per-lesson price.** The edit modal's Pricing
  section no longer has the "Igiteranyo (RWF)" price input or the Free/Paid
  choice. It now shows a single locked **Paid** option plus a note that all
  lessons are paid and priced by the Single Video plan. Saving an edited lesson
  always sends `price: 0` (which falls back to the plan price) and
  `isFree: false`.

## Earlier work

This session's work, verified end-to-end against a real MySQL database and
a real Postgres database (Supabase's engine) running in a test sandbox —
not just written, actually run.

## Later addition — SQL consolidated into one file

The two Supabase SQL files were merged into a single
`supabase/Schrema.sql` (13 tables, 8 views, 8 indexes, 6 triggers,
3 Storage buckets, RLS + policies, seed content, and a verification
query). `supabase/schema.sql` and `supabase/create_buckets.sql` were
removed so there is one source of truth that cannot drift, and all
references in `backend/init.js`, `backend/.env.example`, `README.md`
and `database/migration.sql` were updated. The merge also fixed a
missing `avatars` bucket definition and corrected the `v_lesson_stats`
camelCase aliases (see item 2 below for the related
`CREATE POLICY` fix). Re-running the file is safe and is the way to
bring an older deployment up to date.

## Real bugs found and fixed

1. **`npm start` failing after a fresh GitHub clone / on Render, Railway,
   Heroku, etc.** — the root `package.json` had zero dependencies and never
   installed `backend/`'s dependencies. Any host running the standard
   `npm install && npm start` would crash with `Cannot find module
   'express'`. **Fixed** with a `postinstall` hook in the root
   `package.json` that runs `npm --prefix backend install` automatically.
   Verified by simulating a completely fresh clone (deleted all
   `node_modules`, reinstalled, confirmed `backend/node_modules` populates
   and the server boots).

2. **`supabase/schema.sql` used `CREATE POLICY IF NOT EXISTS`** — this is
   not valid PostgreSQL syntax (Postgres has no `IF NOT EXISTS` variant for
   `CREATE POLICY`). It would have failed the instant someone pasted it
   into Supabase's SQL editor. **Fixed** with a `DROP POLICY IF EXISTS` +
   `CREATE POLICY` pattern, which is idempotent (safe to run multiple
   times). Verified by installing Postgres 16 locally and running the file
   against it directly, twice in a row.

3. **A real personal MySQL password was committed in `backend/.env.example`**
   instead of a placeholder. Replaced with `your_mysql_password`.

## Language support: added French, Kiswahili, and Arabic

The site already had EN/RW (English/Kinyarwanda) toggle infrastructure on
`index.html`, plus toggle *buttons* for FR/SW/AR that silently fell back to
English (no actual translated content existed). Now genuinely translated:

- **`index.html`** — all 32 UI strings (nav, hero, "how it works", stats,
  footer) translated into FR/SW/AR.
- **`video.html`** — had no language toggle at all; added one to the
  header, and translated all 19 payment-flow strings (plans, payment
  instructions, pending/approved states).
- **`login.html`** — was Kinyarwanda-only with zero language system; added
  a toggle and translated all visible text into EN/FR/SW/AR.
- **`register.html`** — had toggle buttons wired to a fragile hack that
  only translated 2 elements (the heading and subtitle); replaced with the
  same robust show/hide system used everywhere else and translated all
  remaining visible text.
- **`admin.html`** — intentionally left as EN/RW only (internal tool, 148
  strings, lower priority than the public-facing pages). Say the word if
  you want this fully translated too.

Every page was verified after editing: matching span counts across all 5
languages, valid inline JS (`node --check`), balanced HTML tags, no
duplicate element IDs.

## Qur'an course category

Discovered there was already a dedicated, well-built `ensureQuranContent()`
function in `backend/init.js` that auto-creates a "Qur'an Courses" category
(slug `quran`) with 4 seed lessons on every server boot, self-healing style
— it just wasn't obvious it existed. My first instinct was to add this
manually to the seed data, which would have caused duplicate/near-duplicate
lessons once both mechanisms ran; caught this via a real boot test, reverted
the redundant manual addition, and confirmed the existing mechanism alone
produces exactly 6 categories and 4 clean Qur'an lessons with no
duplication. Verified via the real `/api/categories` and `/api/lessons`
endpoints — the category appears first (as intended) with all 4 lessons
correctly attached.

## Already in place from earlier work (confirmed still working)

- Photo upload on the register form (file input, live preview, multipart
  upload) — backend stores to Supabase Storage if configured, falls back to
  local disk otherwise. Re-verified end-to-end this session: registered a
  real test user with a real image file via the exact multipart shape the
  frontend sends, confirmed the file landed on disk and the phone number
  and avatar URL both persisted correctly in the database.
- Payment approval flow (from a previous session's fixes).

## Later addition — access expiry, redirect round-trip, admin-editable plans

**Video access actually stops when the paid period ends.** `video.html` used
a 60-second watchdog that only re-checked access on the minute, so a learner
could finish a video (or keep watching) after their weekly/monthly window had
closed. Now:

- A single `applyAccessCache(data)` path sets the user's access + expiry and
  (re)starts the watchdog, so an approval that lands while the page is open is
  picked up immediately instead of only on the next poll.
- `startAccessWatchdog()` ticks every second, shows an "access ending soon"
  toast two minutes before expiry, and — at expiry — calls `stopPlaybackNow()`
  (pauses the video, clears the YouTube iframe, clears the preview timer) and
  reopens the payment overlay.
- `renderAccessStatus()` now shows a live "Time left" countdown built from a
  per-second `updateAccessCountdown()`, with the same text in EN/RW/FR/SW/AR.

**Login/register keep you where you were.** Both pages gained a `nextUrl()`
helper (same-site only — it rejects schemes and `//`, `/\`, `\` prefixes) so
that signing in from a gated video returns you to that video, and the
login/register cross-links carry the `next` value through.

**Plans & prices are now admin-editable.** The three checkout plans (price +
access length) were hard-coded in `backend/routes/payments.js` and in
`video.html`, so changing a price or a duration meant editing code and
redeploying. Now they live in a new `public.payment_plans` table
(`access_type` PK, `price`, `duration_days`, `updated_at`), seeded with the
previous values and readable by anyone (the checkout shows prices):

- New `backend/services/plans.js` (`getPlans`/`getPlan`) reads the table and
  falls back per-tier to the old hard-coded values if the table is missing or
  empty, so the checkout never breaks on a database that predates the table.
- New `backend/routes/plans.js` mounts at `/api/plans`: public `GET /`,
  admin `PATCH /:accessType` (merges onto the current row and upserts).
- `backend/routes/payments.js` now prices a submission and computes the
  approval expiry from the plan (`duration_days`, `null` = never expires), and
  the approval SMS quotes the real number of days instead of a hard-coded 7/30.
- `video.html` fetches `/api/plans` on load and repaints each tier card's
  price/description from it (falling back to the built-in defaults), and the
  selected-tier total uses the same source.
- `admin.html` gained a **Plans & Prices** page (sidebar item, `pageTitles`
  entry, `renderPlans()`/save handler) with a price field per tier and an
  access-length field for the weekly/monthly tiers (the single-video tier is
  always "never expires").

**Payment phone number changed** to `+250783198148` (display + copy button in
`video.html`, and the `OWNER_PHONE` SMS alert target, now also set in
`backend/.env`).

## What's not done

- `admin.html` translations (148 strings) — deliberately scoped out, see
  above.
- Actually configuring a live Supabase project is on you — see
  `backend/.env.example` for the variables needed
  (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_AVATAR_BUCKET`) and `supabase/Schrema.sql` for the one-time SQL
  to run in Supabase's SQL editor. Re-running that file is safe and now also
  creates + seeds `payment_plans`.
