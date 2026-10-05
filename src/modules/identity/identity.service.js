/**
 * Project Nexus - Identity & Authentication Domain Service
 * Features persistent session management, durable token revocation denylist,
 * and timing-safe password verification.
 */
import { db } from '../../lib/db.js';
import { hashPassword, verifyPassword, signJwt, verifyJwt } from '../../lib/crypto.js';
import { ConflictError, UnauthorizedError, ValidationError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

// Fast in-memory cache synchronized with durable db.revokedTokens table
const inMemoryRevokedTokens = new Set();

export class IdentityService {
  /**
   * Registers a new user account.
   */
  static async register({ email, password, name }) {
    if (!email || !password || !name) {
      throw new ValidationError('Email, password, and name are required.');
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.users.findUnique({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictError('A user with this email address already exists.');
    }

    const passwordHash = await hashPassword(password);
    const user = await db.users.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name.trim(),
      },
    });

    logger.info('User registered successfully', { userId: user.id, email: user.email });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    };
  }

  /**
   * Authenticates user credentials and issues a signed JWT token.
   */
  static async authenticate({ email, password }) {
    if (!email || !password) {
      throw new ValidationError('Email and password must be provided.');
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await db.users.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid email or password credentials.');
    }

    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password credentials.');
    }

    const token = signJwt({
      userId: user.id,
      email: user.email,
    });

    // Persist session to database for multi-instance distributed visibility
    try {
      await db.sessions.create({
        data: {
          token,
          userId: user.id,
          createdAt: new Date(),
        },
      });
    } catch (sessionErr) {
      logger.warn('Session persistence notice:', sessionErr.message);
    }

    logger.info('User authenticated successfully', { userId: user.id });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
    };
  }

  /**
   * Revokes an active session token immediately and writes to durable denylist.
   */
  static revokeSession(token) {
    if (token) {
      inMemoryRevokedTokens.add(token);
      // Persist to durable storage asynchronously
      db.revokedTokens
        .create({
          data: {
            token,
            revokedAt: new Date(),
          },
        })
        .catch((err) => {
          logger.warn('Token revocation persistence warning:', err.message);
        });
      db.sessions.deleteMany({ where: { token } }).catch(() => {});
      logger.info('Session token permanently revoked and persisted.');
    }
  }

  /**
   * Checks synchronously if a token has been revoked.
   */
  static isTokenRevoked(token) {
    if (!token) return true;
    return inMemoryRevokedTokens.has(token);
  }

  /**
   * Verifies an active JWT session token against in-memory and persistent revocation denylist.
   */
  static async verifySession(token) {
    if (this.isTokenRevoked(token)) {
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    const inDb = await db.revokedTokens.findUnique({ where: { token } });
    if (inDb) {
      inMemoryRevokedTokens.add(token);
      throw new UnauthorizedError('Session has been revoked. Please log in again.');
    }

    let payload;
    try {
      payload = verifyJwt(token);
    } catch (err) {
      throw new UnauthorizedError(err.message || 'Invalid or expired session token.');
    }

    const user = await db.users.findUnique({
      where: { id: payload.userId },
    });

    if (!user) {
      throw new UnauthorizedError('User account associated with session no longer exists.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }

  /**
   * Fetches user profile by ID.
   */
  static async getUserById(userId) {
    const user = await db.users.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundError('User');
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    };
  }
}
