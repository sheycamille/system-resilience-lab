import { Router, Request, Response } from 'express';
import { inMemoryStore } from './store.ts';

export const profileRouter = Router();

// GET /api/v1/users/me
profileRouter.get('/me', (req: Request, res: Response) => {
  const authHeader = req.headers['authorization'];
  let targetUserId = 'usr_1001'; // Default fallback for developer exploration

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokenStr = authHeader.substring(7).trim();
    const tokenRecord = inMemoryStore.getToken(tokenStr);
    if (tokenRecord) {
      targetUserId = tokenRecord.user_id;
    }
  }

  const user = inMemoryStore.getUserById(targetUserId);

  if (!user) {
    return res.status(404).json({
      error: 'user_not_found',
      message: `User with id ${targetUserId} was not found`,
      status_code: 404
    });
  }

  // Contract Drift Simulation Hook
  if (inMemoryStore.isSchemaDriftActive()) {
    const driftType = inMemoryStore.getSchemaDriftType();

    if (driftType === 'rename_field') {
      // BREAKING CHANGE: 'user_id' renamed to 'id'
      return res.status(200).json({
        id: user.user_id, // Renamed! Breaks OpenAPI schema
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        tier: user.tier,
        created_at: user.created_at,
        preferences: user.preferences
      });
    }

    if (driftType === 'drop_required') {
      // BREAKING CHANGE: Missing required field 'email'
      return res.status(200).json({
        user_id: user.user_id,
        full_name: user.full_name,
        role: user.role,
        status: user.status,
        tier: user.tier,
        created_at: user.created_at,
        preferences: user.preferences
      });
    }

    if (driftType === 'type_mismatch') {
      // BREAKING CHANGE: 'status' boolean instead of enum string
      return res.status(200).json({
        user_id: user.user_id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
        status: 1, // Number instead of string enum!
        tier: user.tier,
        created_at: user.created_at,
        preferences: user.preferences
      });
    }
  }

  // Baseline: 100% Contract Compliant Response
  return res.status(200).json({
    user_id: user.user_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    tier: user.tier,
    created_at: user.created_at,
    preferences: user.preferences
  });
});

// GET /api/v1/users/:id
profileRouter.get('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const user = inMemoryStore.getUserById(id);

  if (!user) {
    return res.status(404).json({
      error: 'user_not_found',
      message: `User with ID '${id}' does not exist in the repository`,
      status_code: 404
    });
  }

  return res.status(200).json({
    user_id: user.user_id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    status: user.status,
    tier: user.tier,
    created_at: user.created_at,
    preferences: user.preferences
  });
});

// GET /api/v1/users (paginated list)
profileRouter.get('/', (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 10;

  const result = inMemoryStore.listUsers(page, limit);

  return res.status(200).json({
    items: result.items.map(u => ({
      user_id: u.user_id,
      email: u.email,
      full_name: u.full_name,
      role: u.role,
      status: u.status,
      tier: u.tier,
      created_at: u.created_at,
      preferences: u.preferences
    })),
    total: result.total,
    page: result.page,
    limit: result.limit
  });
});
