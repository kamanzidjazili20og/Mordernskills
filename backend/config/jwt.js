// ============================================================
// JWT signing configuration.
//
// The previous fallback was a hard-coded string that shipped in the
// repository. Anybody who could read the source could mint a token
// with `role: "admin"` and take over the platform, so in production
// a missing JWT_SECRET is now a hard, loud failure rather than a
// silent downgrade.
// ============================================================
const { isProd } = require('./env');

const DEV_FALLBACK = 'modern-skills-dev-secret-change-me-in-production';

const secret = process.env.JWT_SECRET || DEV_FALLBACK;

if (!process.env.JWT_SECRET) {
    if (isProd) {
        throw new Error(
            'JWT_SECRET must be set in production. Generate one with: '
            + 'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"'
        );
    }
    console.warn('[auth] JWT_SECRET is not set — using the development fallback secret. Never do this in production.');
}

module.exports = {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
};
