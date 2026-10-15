// ============================================================
// Environment parsing and runtime validation.
//
// Everything that used to be read ad-hoc from `process.env` at
// the point of use lives here, so there is exactly one place that
// decides what "development" means, which origins are allowed and
// how large a request body may get.
//
// Reads a value only once at boot: mutating `process.env` after
// this module loads has no effect on anything that uses `env`.
// ============================================================
require('dotenv').config();

const path = require('path');

const NODE_ENV = (process.env.NODE_ENV || 'development').toLowerCase();
const isProd = NODE_ENV === 'production';

function int(name, fallback) {
    const raw = parseInt(process.env[name], 10);
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function bool(name, fallback) {
    const raw = process.env[name];
    if (raw === undefined || raw === '') return fallback;
    return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

/**
 * `https://x.com/` and `https://x.com` must compare equal — and so must
 * `https://user.github.io/repo/` (how FRONTEND_URL is written, because it
 * doubles as a human-readable site URL) and `https://user.github.io`
 * (what the browser actually puts in the Origin header: an origin never
 * carries a path). Comparing the full string used to reject every request
 * coming from a GitHub Pages deployment.
 */
function normalizeOrigin(origin) {
    const raw = String(origin || '').trim();
    if (!raw || raw === 'null') return raw ? 'null' : '';
    try {
        return new URL(raw).origin.toLowerCase();
    } catch (e) {
        return raw.replace(/\/+$/, '').toLowerCase();
    }
}

// Origins that must always work so a developer's local frontend can
// talk to a locally running API (config.js falls back to
// http://localhost:3001 when a page is opened straight off disk).
const LOCAL_DEV_ORIGINS = [
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
    'http://localhost:5173',
    'http://127.0.0.1:5173'
];

const extraOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(normalizeOrigin)
    .filter(Boolean);

const allowedOrigins = Array.from(new Set(
    [process.env.FRONTEND_URL, ...extraOrigins, ...(isProd ? [] : LOCAL_DEV_ORIGINS)]
        .map(normalizeOrigin)
        .filter(Boolean)
));

const env = {
    NODE_ENV,
    isProd,
    isTest: NODE_ENV === 'test',
    // 0.0.0.0 is what every PaaS (Render/Railway/Fly/Heroku) needs to
    // reach the container; 127.0.0.1 keeps local runs off the network.
    host: process.env.HOST || '0.0.0.0',
    port: int('PORT', 3001),

    // 1 is "one proxy (Render/Railway/Heroku/Nginx) in front of me".
    // `true` means "trust every hop", which lets a client spoof X-Forwarded-For
    // and defeat the rate limiter, so it is opt-in only.
    trustProxy: process.env.TRUST_PROXY === undefined
        ? 1
        : (/^(true|yes|on)$/i.test(process.env.TRUST_PROXY) ? true : int('TRUST_PROXY', 1)),

    allowedOrigins,
    // Mirror the request Origin and allow credentials. Useful while hacking
    // on the API, dangerous in production: any website could then call
    // authenticated endpoints from a visitor's browser.
    allowAnyOrigin: bool('CORS_ALLOW_ANY_ORIGIN', !isProd),
    // Pages opened from disk send `Origin: null`.
    allowNullOrigin: bool('CORS_ALLOW_NULL_ORIGIN', !isProd),

    // Lesson payloads are plain text. 50 MB of JSON is a free memory
    // exhaustion attack; real uploads go through multer as multipart.
    jsonBodyLimit: process.env.JSON_BODY_LIMIT || '1mb',
    urlencodedBodyLimit: process.env.URLENCODED_BODY_LIMIT || '1mb',

    staticMaxAge: process.env.STATIC_MAX_AGE || '1h',
    uploadMaxAge: process.env.UPLOAD_MAX_AGE || '30d',

    // Free lessons expose their video URL so the homepage can play a
    // hover preview. Paid lessons only report `has_video`.
    exposeFreeVideoUrls: bool('EXPOSE_FREE_VIDEO_URLS', true),

    rateLimit: {
        windowMs: int('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        max: int('RATE_LIMIT_MAX', 600)
    },
    authRateLimit: {
        windowMs: int('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
        max: int('AUTH_RATE_LIMIT_MAX', 40)
    },

    dbInitTimeoutMs: int('DB_INIT_TIMEOUT_MS', 45000),
    shutdownTimeoutMs: int('SHUTDOWN_TIMEOUT_MS', 10000),

    rootDir: path.join(__dirname, '..', '..'),
    backendDir: path.join(__dirname, '..')
};

// ------------------------------------------------------------
// Startup validation. Logs loudly; never throws, so a mis-set
// variable degrades one feature instead of stopping the boot.
// ------------------------------------------------------------
const problems = [];

if (isProd && !process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set — every deployment would share the hard-coded fallback secret and anyone could mint an admin token.');
}
if (isProd && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'Admin@123')) {
    problems.push('ADMIN_PASSWORD is missing or still the default "Admin@123".');
}
if (isProd && !process.env.SUPABASE_URL) {
    problems.push('SUPABASE_URL is not set — the API has no database to talk to.');
}

/**
 * Report configuration problems that are not fatal, so a supervisor
 * (or a human reading the boot log) sees them immediately.
 */
function assertRuntimeConfig(logger) {
    const log = logger || console;
    if (!problems.length) return problems;
    log.warn('');
    log.warn('  ⚠ Configuration warnings');
    problems.forEach(p => log.warn(`    • ${p}`));
    log.warn('');
    return problems;
}

module.exports = { env, isProd, assertRuntimeConfig, normalizeOrigin, LOCAL_DEV_ORIGINS };
