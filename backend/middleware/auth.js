const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');

/**
 * `exp` and `nbf` are already enforced by jwt.verify. It throws a single
 * `TokenExpiredError` for an expired token and `JsonWebTokenError` for
 * anything else; the distinction used to be lost because both became a
 * blanket 403, which told a client with a perfectly valid token that it
 * needed different credentials.
 */
function authenticate(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, secret);
        if (!decoded || !decoded.id) {
            return res.status(401).json({ error: 'Malformed token.' });
        }
        req.user = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired. Please sign in again.' });
        }
        return res.status(401).json({ error: 'Invalid token.' });
    }
}

/**
 * Role gate. The role lives in the token, so revoking an admin means
 * rotating JWT_EXPIRES_IN — the session is not re-checked against the
 * database on every request. That is the intended trade-off for a
 * platform this size; noted here so it is not mistaken for a live check.
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

module.exports = { authenticate, requireAdmin };
