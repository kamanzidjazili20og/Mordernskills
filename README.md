# Modern Skills

Modern Skills is a static learning frontend (HTML/CSS/JS) with a Node/Express API and a Supabase database.

Everything — the site *and* the API — is served by one Node process in development:

```
npm install --prefix backend
npm start
```

Open **http://localhost:3001** (`/admin.html` for the admin panel). Node 18+ is required (Node 20 LTS recommended).

> There is no `backend/.env`? Copy `backend/.env.example` to `backend/.env` and fill it in. `.env` is gitignored and is never pushed to GitHub.

## How the pieces are hosted

| Piece | Host | Why |
| --- | --- | --- |
| HTML/CSS/JS frontend | **GitHub Pages** | free static hosting |
| Node API (`backend/`) | **Render** (or Railway/Fly) | GitHub Pages cannot run Node.js |
| Database + file storage | **Supabase** | Postgres + Storage buckets |

The same repository serves both. The frontend finds the API through `config.js`, which picks the right base URL automatically:

- on `localhost` / `127.0.0.1` / `file://` → same origin (`''`), i.e. whatever port `npm start` is running on;
- anywhere else (GitHub Pages) → the `DEPLOYED_API_URL` value you paste into `config.js`.

## 1. Push the project to GitHub

```bash
git add .
git commit -m "Deploy Modern Skills"
git push origin main
```

Never commit `backend/.env` — it is already listed in `.gitignore`.

## 2. Deploy the backend to Render (one time)

1. Go to <https://dashboard.render.com> → **New → Web Service** → connect the GitHub repository `kamanzidjazili20og/Mordernskills`.
2. Render reads `render.yaml` automatically. Keep the defaults:
   - Root directory: `backend`
   - Build command: `npm install`
   - Start command: `npm start`
3. Add the environment variables that are marked `sync: false` in `render.yaml` under **Environment**:
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `ADMIN_PASSWORD`
   - (`JWT_SECRET` is generated for you.)
4. Deploy. Your API is now at `https://modern-skills-api-<something>.onrender.com`.
5. Open `https://<your-api-host>/api/health` — it must return `"status": "ok"` with `"db": "ok"`. If the schema is missing, paste `supabase/Schrema.sql` into the Supabase SQL Editor once and redeploy.

## 3. Publish the frontend with GitHub Pages (one time)

1. Repository on GitHub → **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Branch: `main`, folder: `/ (root)` → **Save**.
4. Wait a minute; the site appears at `https://kamanzidjazili20og.github.io/Mordernskills/`.

The repository already contains `.nojekyll`, so GitHub serves every file as-is (no Jekyll rewriting).

## 4. Point the frontend at the API

Edit `config.js` at the repository root and paste the Render URL from step 2:

```js
var DEPLOYED_API_URL = 'https://modern-skills-api-<something>.onrender.com';
```

Commit and push. GitHub Pages republishes automatically.

`render.yaml` already allows the GitHub Pages origin (`FRONTEND_URL`) for CORS, so no further configuration is needed for cross-origin requests.

## Supabase

Supabase is optional locally but required for the deployed API. Create a project, run `supabase/Schrema.sql` in the SQL Editor (tables, views, seeds, RLS and the public Storage buckets `avatars`, `videos`, `thumbnails`, `books`), then set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and the bucket names in the backend environment. **Never put the service-role key in frontend code or in GitHub.**

## Register photo upload

The registration form accepts JPG/JPEG/PNG/WEBP images up to the configured image limit. With Supabase configured, the backend stores the image in Supabase Storage and saves its public URL; without Supabase it falls back to the local `backend/uploads/avatars` folder (which is wiped on every redeploy, so use Supabase in production).

## Local development commands

| Command | What it does |
| --- | --- |
| `npm install --prefix backend` | install API dependencies |
| `npm start` | start API + frontend on http://localhost:3001 |
| `npm run dev` | same, with nodemon auto-restart |
| `start-server.bat` | Windows: free the port, then start the server |
