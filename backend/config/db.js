// ============================================================
// Datasource configuration.
// driver = 'supabase' (default) | 'mysql'
//  - supabase: talks to the Postgres database through PostgREST
//    using the SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
//  - mysql: legacy mysql2 pool, kept for deployments that set
//    DB_DRIVER=mysql.
// ============================================================
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

function parseUrl(url) {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'mysql:' && parsed.protocol !== 'mariadb:') return null;
        return {
            host: parsed.hostname,
            port: parseInt(parsed.port, 10) || 3306,
            user: decodeURIComponent(parsed.username || ''),
            password: decodeURIComponent(parsed.password || ''),
            database: decodeURIComponent(parsed.pathname.replace(/^\//, ''))
        };
    } catch (e) {
        return null;
    }
}

function getDbConfig() {
    const fromUrl = parseUrl(
        process.env.DATABASE_URL || process.env.MYSQL_URL || process.env.JAWSDB_URL
    );
    return fromUrl || {
        host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.MYSQLPORT || process.env.DB_PORT || '3306', 10),
        user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
        database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'noor_academy'
    };
}

function getDriver() {
    const explicit = (process.env.DB_DRIVER || '').toLowerCase();
    if (explicit === 'mysql') return 'mysql';
    if (explicit === 'supabase') return 'supabase';
    // Default to Supabase whenever a Supabase project is configured.
    // Previously this also required SUPABASE_SERVICE_ROLE_KEY, so forgetting
    // that one variable silently switched the whole API to the legacy MySQL
    // pool and every route started throwing on a null client.
    if (process.env.SUPABASE_URL) return 'supabase';
    return 'mysql';
}

const driver = getDriver();

let supabase = null;
if (driver === 'supabase' && process.env.SUPABASE_URL) {
    // The service-role key bypasses RLS and is what the admin API needs.
    // Without it the anon key still works for reads, but writes to tables
    // without an anon policy are rejected — hence the warning rather than
    // a silent driver change.
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
        console.warn('[db] SUPABASE_SERVICE_ROLE_KEY is not set — falling back to SUPABASE_ANON_KEY. Writes will be subject to RLS.');
    }
    supabase = createClient(process.env.SUPABASE_URL, key, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
}

/**
 * Every route in routes/*.js is written against the Supabase client
 * (`supabase.from('lessons')...`). Under DB_DRIVER=mysql the client
 * was `null`, so each of those routes died with
 * `TypeError: Cannot read properties of null (reading 'from')` — an
 * unreadable 500 that hid the real problem. A throwing proxy turns
 * the same mistake into one clear message that middleware/errors.js
 * maps to 501.
 */
function createUnavailableSupabase(name) {
    const message = `Database driver "${name}" is not available: this API talks to Supabase only. `
        + 'Set DB_DRIVER=supabase (or provide SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) '
        + 'and run supabase/Schrema.sql in the Supabase SQL Editor.';
    const deny = (prop) => {
        if (typeof prop === 'symbol' || prop === 'inspect' || prop === 'constructor') return undefined;
        const err = new Error(message);
        err.code = 'DRIVER_UNAVAILABLE';
        throw err;
    };
    return new Proxy(Object.create(null), {
        get: deny,
        has: deny,
        ownKeys: () => [],
        getOwnPropertyDescriptor: () => undefined
    });
}

const db = { driver, supabase, getDbConfig, pool: null };

if (driver === 'mysql') {
    const mysql = require('mysql2/promise');
    db.pool = mysql.createPool({
        ...getDbConfig(),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        connectTimeout: 10000
    });
    // Make the module itself usable like the legacy pool (pool.query, ...)
    Object.assign(db, {
        query: (...args) => db.pool.query(...args),
        execute: (...args) => db.pool.execute(...args),
        getConnection: (...args) => db.pool.getConnection(...args),
        end: (...args) => db.pool.end(...args)
    });
} else {
    // Fail loudly if legacy mysql-only code runs while in supabase mode.
    db.query = () => Promise.reject(new Error('MySQL pool not available (DB_DRIVER=supabase)'));
}

if (!db.supabase) {
    db.supabase = createUnavailableSupabase(driver);
}

module.exports = db;