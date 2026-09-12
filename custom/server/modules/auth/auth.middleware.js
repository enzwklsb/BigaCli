// BigaCli is a single-user shell. Keep CloudCLI's user-owned data without a web login.
import jwt from 'jsonwebtoken';
import { userDb, appConfigDb } from '../database/index.js';

const JWT_SECRET = process.env.JWT_SECRET || appConfigDb.getOrCreateJwtSecret();

function validateApiKey(req, res, next) { next(); }

function authenticateToken(req, res, next) {
    try {
        req.user = userDb.getFirstUser();
        if (!req.user) throw new Error('BigaCli internal user is unavailable');
        next();
    } catch (error) { next(error); }
}

function authenticateWebSocket() {
    const user = userDb.getFirstUser();
    return user ? { id: user.id, userId: user.id, username: user.username } : null;
}

// Retain the export used by upstream auth routes; BigaCli itself needs no token.
function generateToken(user) {
    return jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

export { validateApiKey, authenticateToken, authenticateWebSocket, generateToken, JWT_SECRET };
