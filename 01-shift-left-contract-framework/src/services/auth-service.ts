import { Router, Request, Response } from 'express';
import { inMemoryStore } from './store.ts';
import { AuthToken } from '../types/index.ts';

export const authRouter = Router();

// POST /api/v1/auth/token
authRouter.post('/token', (req: Request, res: Response) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(401).json({
      error: 'invalid_credentials',
      message: 'Username and password are required',
      status_code: 401
    });
  }

  const user = inMemoryStore.getUserByUsername(username);

  // Authenticate against in-memory records
  if (!user || user.password_hash !== password) {
    return res.status(401).json({
      error: 'invalid_credentials',
      message: 'Authentication failed: credentials do not match',
      status_code: 401
    });
  }

  // Issue bearer token
  const tokenString = `tok_${user.role}_${Math.random().toString(36).substring(2, 12)}`;
  const expiresIn = 3600; // 1 hour

  const tokenRecord: AuthToken = {
    access_token: tokenString,
    token_type: 'Bearer',
    expires_in: expiresIn,
    user_id: user.user_id,
    scope: user.role === 'admin' ? 'read:profile write:profile admin:all' : 'read:profile',
    created_at: Date.now()
  };

  inMemoryStore.saveToken(tokenRecord);

  // Contract Drift Simulation Hook: If intentional drift is activated, mutate payload
  if (inMemoryStore.isSchemaDriftActive()) {
    const driftType = inMemoryStore.getSchemaDriftType();

    if (driftType === 'rename_field') {
      // BREAKING CHANGE: 'user_id' renamed to 'account_uid'
      return res.status(200).json({
        access_token: tokenRecord.access_token,
        token_type: tokenRecord.token_type,
        expires_in: tokenRecord.expires_in,
        account_uid: tokenRecord.user_id, // Renamed! Breaks OpenAPI schema
        scope: tokenRecord.scope
      });
    }

    if (driftType === 'drop_required') {
      // BREAKING CHANGE: Missing required field 'token_type'
      return res.status(200).json({
        access_token: tokenRecord.access_token,
        expires_in: tokenRecord.expires_in,
        user_id: tokenRecord.user_id,
        scope: tokenRecord.scope
      });
    }

    if (driftType === 'type_mismatch') {
      // BREAKING CHANGE: 'expires_in' returned as string instead of integer
      return res.status(200).json({
        access_token: tokenRecord.access_token,
        token_type: tokenRecord.token_type,
        expires_in: '3600s', // Wrong type!
        user_id: tokenRecord.user_id,
        scope: tokenRecord.scope
      });
    }
  }

  // Baseline: 100% Contract Compliant Response
  return res.status(200).json({
    access_token: tokenRecord.access_token,
    token_type: tokenRecord.token_type,
    expires_in: tokenRecord.expires_in,
    user_id: tokenRecord.user_id,
    scope: tokenRecord.scope
  });
});

// POST /api/v1/auth/verify
authRouter.post('/verify', (req: Request, res: Response) => {
  const { token } = req.body || {};

  if (!token) {
    return res.status(400).json({
      error: 'missing_token',
      message: 'Token string must be provided in request body',
      status_code: 400
    });
  }

  const tokenRecord = inMemoryStore.getToken(token);

  if (!tokenRecord) {
    return res.status(200).json({
      valid: false,
      user_id: '',
      roles: [],
      expires_at: new Date(0).toISOString()
    });
  }

  const user = inMemoryStore.getUserById(tokenRecord.user_id);
  const expiresAt = new Date(tokenRecord.created_at + tokenRecord.expires_in * 1000).toISOString();

  return res.status(200).json({
    valid: true,
    user_id: tokenRecord.user_id,
    roles: user ? [user.role] : ['viewer'],
    expires_at: expiresAt
  });
});
