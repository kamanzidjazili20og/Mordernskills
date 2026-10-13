/**
 * Shared Supabase/PostgREST error handling.
 *
 * Without this, every failure surfaces as a generic `500 {"error":"Server
 * error"}`, which is both unhelpful to the admin and impossible to act on.
 * Postgres reports the interesting cases through stable error codes, so map
 * them onto real HTTP statuses and readable messages.
 *
 *   23505 unique_violation      -> 409 Conflict  (duplicate slug/email/etc.)
 *   23503 foreign_key_violation -> 400 Bad Request
 *   23502 not_null_violation    -> 400 Bad Request
 *   23514 check_violation       -> 400 Bad Request
 *   23P01 exclusion_violation   -> 409 Conflict
 *   42P01 undefined_table       -> 503 (schema not applied yet)
 *   42703 undefined_column      -> 500 (code bug — log loudly, do not leak)
 *   PGRST116 / no rows          -> 404
 */
const FRIENDLY = {
    '23505': 'That value must be unique and one already exists.',
    '23503': 'That record is still referenced by other records.',
    '23502': 'A required field was left empty.',
    '23514': 'That value is not allowed.',
    '23P01': 'That conflicts with an existing record.',
    '42P01': 'Database schema is not set up yet. Run supabase/Schrema.sql in the Supabase SQL Editor.',
    'PGRST116': 'Not found.'
};

/** Pull the offending field/value out of a Postgres detail string. */
function duplicateField(detail) {
    if (!detail) return null;
    const m = /Key \(([^)]+)\)=\(([^)]*)\)/.exec(detail);
    return m ? { column: m[1], value: m[2] } : null;
}

/**
 * Send a Postgres error to the client as a useful HTTP response.
 * Returns true when it handled the error, so callers can `return fail(res, err)`.
 */
function fail(res, err, fallbackMessage) {
    const code = err && (err.code || err.errorCode);
    const message = (err && err.message) || 'Unknown error';

    if (code === '23505') {
        const dupe = duplicateField(err.details);
        const what = dupe ? ` "${dupe.column}" = "${dupe.value}"` : '';
        return res.status(409).json({
            error: `Duplicate value${what}. ${FRIENDLY[code]}`,
            code
        });
    }
    if (code === '42703') {
        // A column the code expects is absent — almost always schema drift.
        console.error('[schema] undefined column:', message);
        return res.status(500).json({
            error: 'Database schema is out of date. Run supabase/Schrema.sql in the Supabase SQL Editor to update it.',
            code
        });
    }
    if (code === '42P01' || code === '42883') {
        console.error('[schema]', message);
        return res.status(503).json({ error: FRIENDLY['42P01'], code });
    }
    if (FRIENDLY[code]) {
        return res.status(code === 'PGRST116' ? 404 : 400).json({ error: FRIENDLY[code], code });
    }

    console.error('[api]', code || '', message);
    return res.status(500).json({
        error: fallbackMessage || 'Server error',
        ...(process.env.NODE_ENV === 'development' && { details: message })
    });
}

module.exports = { fail, FRIENDLY, duplicateField };
