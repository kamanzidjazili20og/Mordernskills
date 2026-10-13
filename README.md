# Modern Skills

Modern Skills is a static learning frontend with a Node/Express API.

## Run locally

1. Install Node.js 18+ (Node 20 LTS is recommended).
2. Copy `backend/.env.example` to `backend/.env` and set your MySQL values.
3. From the project root run:

```bash
npm install --prefix backend
npm start
```

Open http://localhost:3000. The backend serves the frontend too.

## Supabase

Supabase is optional but recommended for persistent profile photos when the API is deployed to Render/Railway. Create a project, create a public Storage bucket named `avatars`, then set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_AVATAR_BUCKET` in the backend environment. Run `supabase/Schrema.sql` for the full database setup (tables, views, seed content, RLS, and the three public Storage buckets). **Never put the service-role key in frontend code or GitHub.**

## GitHub Pages + backend

GitHub Pages can host the HTML/CSS/JS frontend, but it cannot run Node.js. Deploy the `backend` directory to Render/Railway/Fly/etc. and set `window.MODERN_SKILLS_API_URL` in `config.js` to that public API URL before publishing the frontend. For the simplest setup, deploy the whole repository as the Render web service defined in `render.yaml`; the Node server will serve the frontend and `/api`.

## Register photo upload

The registration form accepts JPG/JPEG/PNG/WEBP images up to the configured image limit. With Supabase configured, the backend stores the image in Supabase Storage and saves its public URL in MySQL. Without Supabase it falls back to local `backend/uploads/avatars`.
