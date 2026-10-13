// ============================================================
// Cross-cutting HTTP middleware: request ids, security headers,
// rate limiting, 404s and the terminal error handler.
//
// Kept dependency-free on purpose — the project ships no
// `helmet` / `express-rate-limit`, and adding two packages to
// solve four headers is not a trade worth making.
// ============================================================
const crypto = require('crypto');

// ------------------------------------------------------------
// Request id — echoed back as `X-Request-Id` so a user can quote
// one line from a bug report and the matching log line can be
// found immediately.
// ------------------------------------------------------------
function requestId(req, res, next) {
    const incoming = req.headers['x-request-id'];
    const id = (typeof incoming === 'string' && /^[\w-]{1,64}$/.test(incoming))
        ? incoming
        : crypto.randomBytes(8).toString('hex');
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
}

// ------------------------------------------------------------
// Security headers.
//
// No Content-Security-Policy here: every page in this project
// inlines its CSS and JS, so a real policy would need
// 'unsafe-inline' anyway and would only add breakage risk.
// The headers below are the ones that are both safe and useful.
// ------------------------------------------------------------
function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // The frontend is often served from a different host than the API,
    // so uploads and API responses must stay readable cross-origin.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.removeHeader('X-Powered-By');
    next();
}

/** HSTS is only meaningful — and only safe — over HTTPS. */
function hsts(req, res, next) {
    if (req.secure || (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}

// ------------------------------------------------------------
// Fixed-window rate limiter, in-process and dependency-free.
//
// Trade-off, stated plainly: the counters live in this process's
// heap, so a multi-instance deploy gets N times the limit. That is
// still far better than no limit at all, and it is the wrong
// trade for the single-instance Render/Railway setup this project
// targets. Swapping in Redis means replacing `hit()` only.
// ------------------------------------------------------------
function createRateLimiter({ windowMs, max, keyFn, message }) {
    const buckets = new Map();

    // Drop expired buckets so a long-running process cannot grow
    // without bound under a spray of unique IPs.
    const sweeper = setInterval(() => {
        const cutoff = Date.now() - windowMs;
        for (const [key, bucket] of buckets) {
            if (bucket.resetAt <= cutoff) buckets.delete(key);
        }
    }, Math.max(windowMs, 30000));
    if (typeof sweeper.unref === 'function') sweeper.unref();

    function hit(key) {
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        return { count: bucket.count, remaining: Math.max(0, max - bucket.count), resetAt: bucket.resetAt };
    }

    return function rateLimit(req, res, next) {
        const key = keyFn(req);
        const { count, remaining, resetAt } = hit(key);

        res.setHeader('RateLimit-Limit', String(max));
        res.setHeader('RateLimit-Remaining', String(remaining));
        res.setHeader('RateLimit-Reset', String(Math.ceil(resetAt / 1000)));
        if (count > max) {
            const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
            res.setHeader('Retry-After', String(retryAfter));
            res.setHeader('Cache-Control', 'no-store');
            return res.status(429).json({ error: message || 'Too many requests. Please try again shortly.', retryAfter });
        }
        next();
    };
}

/** `req.ip` already honours the `trust proxy` setting. */
const byIp = req => req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';

/** Broad ceiling for the whole API surface. */
const apiRateLimit = createRateLimiter({
    ...require('../config/env').env.rateLimit,
    keyFn: byIp,
    message: 'Too many requests. Please slow down and try again shortly.'
});

/** Tight ceiling on credential endpoints, to blunt brute force. */
const authRateLimit = createRateLimiter({
    ...require('../config/env').env.authRateLimit,
    keyFn: req => `${byIp(req)}|${String((req.body && req.body.email) || '').toLowerCase()}`,
    message: 'Too many sign-in attempts. Please wait a few minutes and try again.'
});

// ------------------------------------------------------------
// 404s
// ------------------------------------------------------------
function notFound(kind) {
    return function handleNotFound(req, res) {
        if (kind === 'api') {
            return res.status(404).json({
                error: `No API route matches ${req.method} ${req.path}`,
                requestId: req.id
            });
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(404).send(
            '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
            '<meta name="viewport" content="width=device-width,initial-scale=1">' +
            '<title>404 — Page not found</title>' +
            '<style>body{background:#04120d;color:#f4f8f5;font-family:system-ui,sans-serif;' +
            'display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;' +
            'text-align:center}h1{font-size:64px;margin:0;color:#d4a853}p{color:#b0c9bd}' +
            'a{color:#f0d9a0}</style></head><body><div>' +
            '<h1>404</h1><p>We could not find <code>' +
            String(req.path || '').replace(/[<>&"]/g, '') +
            '</code>.</p><p><a href="/">Back to Modern Skills</a></p>' +
            '</div></body></html>'
        );
    };
}

// ------------------------------------------------------------
// Terminal error handler.
//
// Express identifies this one by its four-argument signature, so
// `next` has to stay in the list even though it is unused.
// ------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
function errorHandler(logger) {
    const log = logger || console;
    return function handleError(err, req, res, next) {
        // Once the response is on the wire the only correct move is to
        // stop; calling res.json() would throw ERR_HTTP_HEADERS_SENT.
        if (res.headersSent) return next(err);

        // The `cors` package reports a rejected origin as a plain Error.
        if (err && err.message === 'Origin not allowed by CORS') {
            return res.status(403).json({ error: 'Origin not allowed.', requestId: req.id });
        }

        // Body-parser failures: malformed JSON, oversized payload.
        if (err && err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: 'Request body is not valid JSON.', requestId: req.id });
        }
        if (err && err.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Request body is too large.', requestId: req.id });
        }

        // Multer failures: wrong field name, file too big, bad MIME type.
        if (err && typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
            return res.status(400).json({ error: `Upload rejected: ${err.message}`, requestId: req.id });
        }
        if (err && err.code === 'DRIVER_UNAVAILABLE') {
            return res.status(501).json({ error: 'Database driver is not configured.', requestId: req.id });
        }

        const status = Number.isInteger(err && err.status) && err.status >= 400 && err.status < 600
            ? err.status
            : 500;

        if (status >= 500) {
            log.error(`[${req.id || '-'}] ${req.method} ${req.originalUrl} -> ${status}`, err);
        } else {
            log.warn(`[${req.id || '-'}] ${req.method} ${req.originalUrl} -> ${status}: ${err && err.message}`);
        }

        res.status(status).json({
            error: status >= 500 ? 'Internal server error' : (err && err.message) || 'Request failed',
            requestId: req.id,
            ...(process.env.NODE_ENV === 'development' && { details: err && err.message })
        });
    };
}

module.exports = {
    requestId,
    securityHeaders,
    hsts,
    apiRateLimit,
    authRateLimit,
    notFound,
    errorHandler,
    createRateLimiter
};
