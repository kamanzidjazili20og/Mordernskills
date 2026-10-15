// ============================================================
// Modern Skills — HTTP server.
//
// Serves the JSON API under /api and the static frontend
// (index.html, admin.html, video.html, login.html,
// register.html, assets/, Images/) from the repository root.
//
// Security posture, in one paragraph: only the files listed in
// FRONTEND_FILES are reachable over HTTP. Serving the repository
// root with `express.static` — the obvious one-liner — also
// publishes backend/server.js, backend/package.json, Dockerfile,
// render.yaml and the whole supabase/ directory, which is free
// reconnaissance for anyone who finds the port.
// ============================================================
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const { env, isProd, assertRuntimeConfig, normalizeOrigin } = require('./config/env');
const {
    requestId,
    securityHeaders,
    hsts,
    apiRateLimit,
    notFound,
    errorHandler
} = require('./middleware/security');
const { driver, supabase, pool, getDbConfig } = require('./config/db');
const { initDatabase } = require('./init');
const { version } = require('./package.json');

const app = express();
const ROOT = env.rootDir;
const BOOTED_AT = new Date().toISOString();

// ------------------------------------------------------------
// Express settings
// ------------------------------------------------------------
app.disable('x-powered-by');
app.set('etag', 'strong');
// Correct `req.ip` (and therefore the rate limiter) behind the single
// proxy every PaaS puts in front of the process. `trust proxy = true`
// would let a client forge X-Forwarded-For, so the default is 1 hop.
app.set('trust proxy', env.trustProxy);

assertRuntimeConfig();

// ------------------------------------------------------------
// CORS
//
// The frontend is normally served by this very process, so CORS
// only matters when the two are deployed separately. `origin: true`
// — the previous setting — reflects *any* Origin while also sending
// `Access-Control-Allow-Credentials: true`, which lets any website
// on the internet call authenticated endpoints from a signed-in
// visitor's browser. The allowlist below closes that.
// ------------------------------------------------------------
const allowedOriginSet = new Set(env.allowedOrigins);

// A page served by *this very process* (the Render deployment serves the
// frontend and the API from one origin) sends its own Origin header on
// every POST. The allowlist only knows about the separately deployed
// frontend, so without this a sign-in posted from the API's own domain
// would be rejected in production while working fine in development.
let selfOrigin = null;
app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
        const own = normalizeOrigin(`${req.protocol}://${req.get('host') || ''}`);
        if (own && normalizeOrigin(origin) === own) selfOrigin = own;
    }
    next();
});

app.use(cors({
    origin(origin, callback) {
        // No Origin header: same-origin navigation, curl, server-to-server.
        if (!origin) return callback(null, true);

        const normalized = normalizeOrigin(origin);

        // This process's own origin: frontend and API share one host.
        if (selfOrigin && normalized === selfOrigin) return callback(null, true);

        // Pages opened straight off disk send the literal string "null".
        if (normalized === 'null' && env.allowNullOrigin) return callback(null, true);

        if (allowedOriginSet.has(normalized)) return callback(null, true);

        if (env.allowAnyOrigin) return callback(null, true);

        return callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
    maxAge: 600,
    optionsSuccessStatus: 204
}));

// ------------------------------------------------------------
// Request context, headers, logging
// ------------------------------------------------------------
app.use(requestId);
app.use(securityHeaders);
if (isProd) app.use(hsts);

// `morgan('dev')` in production floods the log with a line per
// asset request and prints the full URL, query string included.
if (isProd) {
    app.use(morgan('combined', {
        skip: (req, res) => res.statusCode < 400 && req.path.startsWith('/Images/')
    }));
} else {
    app.use(morgan('dev'));
}

// 50 MB of JSON was a free memory-exhaustion attack; real media
// arrives as multipart through multer, which has its own limits.
app.use(express.json({ limit: env.jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: env.urlencodedBodyLimit }));

// ------------------------------------------------------------
// API
// ------------------------------------------------------------
app.get('/api/config', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({
        supabaseEnabled: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
        version
    });
});

app.use('/api', apiRateLimit);

app.get('/api/health', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    let db = 'error';
    let schema = 'unknown';

    try {
        if (driver === 'mysql') {
            if (!pool) throw new Error('MySQL pool was not created');
            await pool.query('SELECT 1');
            db = 'ok';
            schema = 'ready';
        } else if (supabase) {
            const { error } = await supabase
                .from('users')
                .select('id', { count: 'exact', head: true })
                .limit(1);
            if (!error) {
                db = 'ok';
                schema = 'ready';
            } else if (error.code === '42P01' || /does not exist/i.test(error.message || '')) {
                db = 'ok';
                schema = 'missing';
            } else {
                db = 'error';
            }
        }
    } catch (e) {
        db = 'error';
    }

    // Previously this answered 200 "ok" even when the database was
    // unreachable, so a monitor could not tell a healthy deploy from
    // a broken one. A non-200 body is far easier to alert on.
    const healthy = db === 'ok' && schema === 'ready';
    res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        db,
        schema,
        driver,
        uptime: Math.round(process.uptime()),
        bootedAt: BOOTED_AT,
        timestamp: new Date().toISOString(),
        version
    });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/instructors', require('./routes/instructors'));
app.use('/api/lessons', require('./routes/lessons'));
app.use('/api/books', require('./routes/books'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/testimonials', require('./routes/testimonials'));
app.use('/api/preferences', require('./routes/preferences'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/payments', require('./routes/payments'));

app.use('/api', notFound('api'));

// ------------------------------------------------------------
// Static frontend — explicit allowlist, never the repo root.
// ------------------------------------------------------------

// Uploaded media. Filenames contain a uuid, so a URL is never
// reused for different content and can be cached aggressively.
app.use('/uploads', express.static(path.join(env.backendDir, 'uploads'), {
    index: false,
    dotfiles: 'deny',
    redirect: false,
    maxAge: env.uploadMaxAge,
    immutable: true,
    setHeaders(res) {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    }
}));

// Everything the browser needs, and nothing else.
const FRONTEND_FILES = [
    'index.html',
    'video.html',
    'login.html',
    'register.html',
    'admin.html',
    'courses.html',
    'books.html',
    'config.js',
    'robots.txt',
    'sitemap.xml',
    'manifest.webmanifest',
    'favicon.ico'
].filter(file => fs.existsSync(path.join(ROOT, file)));

const FRONTEND_DIRS = ['assets', 'Images'];

function sendFile(res, file) {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.sendFile(path.join(ROOT, file), {
        index: false,
        dotfiles: 'deny',
        // HTML must revalidate or a deploy would never be picked up.
        maxAge: file.endsWith('.html') ? 0 : env.staticMaxAge,
        lastModified: true,
        etag: true,
        acceptRanges: false
    });
}

for (const file of FRONTEND_FILES) {
    app.get('/' + file, (req, res) => sendFile(res, file));
}

for (const dir of FRONTEND_DIRS) {
    app.use('/' + dir, express.static(path.join(ROOT, dir), {
        index: false,
        dotfiles: 'deny',
        redirect: false,
        maxAge: env.staticMaxAge,
        setHeaders(res) {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        }
    }));
}

app.get('/', (req, res) => sendFile(res, 'index.html'));

app.use(notFound('page'));

// ------------------------------------------------------------
// Errors last
// ------------------------------------------------------------
app.use(errorHandler(console));

// ------------------------------------------------------------
// Boot
// ------------------------------------------------------------
function describeDatabase() {
    if (driver === 'mysql') {
        const cfg = getDbConfig();
        // No credentials: this line goes to the log aggregator.
        return `mysql ${cfg.database} @ ${cfg.host}:${cfg.port}`;
    }
    const project = (process.env.SUPABASE_URL || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return `supabase ${project || '(SUPABASE_URL not set)'}`;
}

let server;
let shuttingDown = false;
let databaseReady = false;
let databaseError = null;

async function start() {
    // The old code started listening first and kicked off schema setup in
    // the background, so the first requests of every deploy hit a
    // half-migrated database. Initialise first, listen second.
    try {
        await withTimeout(initDatabase(), env.dbInitTimeoutMs, 'Database setup');
        databaseReady = true;
    } catch (err) {
        // Still serve: /api/health must be able to report the failure,
        // and a temporary Supabase outage should not require a redeploy.
        databaseError = err;
        console.error('Database setup failed, starting anyway:', err.message);
    }

    // Try env.port first, then next 10 ports if busy (EADDRINUSE).
    // This stops "address already in use 0.0.0.0:3001" from killing the
    // server when an old node process is still holding the port.
    const startPort = env.port;
    let boundPort = null;
    for (let p = startPort; p < startPort + 10; p++) {
        try {
            // eslint-disable-next-line no-await-in-loop
            boundPort = await new Promise((resolve, reject) => {
                const s = app.listen(p, env.host, () => resolve(p));
                s.on('error', (err) => reject(err));
                server = s;
            });
            if (p !== startPort) {
                console.log(`Port ${startPort} was busy — using ${p} instead.`);
                console.log(`Tip: run "taskkill /F /IM node.exe" in CMD to free port ${startPort}.`);
            }
            break;
        } catch (err) {
            if (err && err.code === 'EADDRINUSE') continue;
            throw err;
        }
    }
    if (boundPort === null) {
        console.error(`HTTP server error: ports ${startPort}-${startPort + 9} are all in use.`);
        console.error(`Fix in CMD: taskkill /F /IM node.exe`);
        process.exit(1);
    }

    {
        const host = env.host === '0.0.0.0' ? 'localhost' : env.host;
        console.log(`Modern Skills server listening on http://${host}:${boundPort}`);
        console.log(`Environment: ${env.NODE_ENV}`);
        console.log(`Database:    ${describeDatabase()}`);
        console.log(`CORS:        ${env.allowAnyOrigin && !isProd ? 'any origin (development only)' : env.allowedOrigins.join(', ') || 'same origin only'}`);
        if (databaseReady) console.log('Database setup finished.');
        console.log('');
        console.log('  🌐 Open: http://localhost:' + boundPort);
        console.log('  🔧 Admin: http://localhost:' + boundPort + '/admin.html');
    }

    server.on('error', (err) => {
        console.error('HTTP server error:', err.message);
        if (err.code !== 'EADDRINUSE') process.exit(1);
    });
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        Promise.resolve(promise).finally(() => clearTimeout(timer)),
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        })
    ]);
}

// ------------------------------------------------------------
// Graceful shutdown. Render/Railway/Fly send SIGTERM and then
// kill the process, so without this in-flight uploads are cut off
// mid-write and the MySQL pool is dropped without draining.
// ------------------------------------------------------------
function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received — shutting down.`);

    const force = setTimeout(() => {
        console.error('Shutdown timed out; exiting now.');
        process.exit(1);
    }, env.shutdownTimeoutMs);
    if (typeof force.unref === 'function') force.unref();

    const finish = async () => {
        clearTimeout(force);
        try {
            if (pool) await pool.end();
        } catch (err) {
            console.error('Error closing the database pool:', err.message);
        }
        process.exit(0);
    };

    if (!server) return finish();
    server.close(err => {
        if (err) console.error('Error closing the HTTP server:', err.message);
        finish();
    });
    // Stop keep-alive sockets from holding the close open.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// A rejected promise nobody awaited would otherwise be swallowed in
// Node 18+, and an uncaught exception leaves the process in an
// undefined state with live sockets. Log loudly, then shut down.
process.on('unhandledRejection', (reason) => {
    console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    shutdown('uncaughtException');
});

start();

module.exports = app;
