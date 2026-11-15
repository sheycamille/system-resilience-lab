import { User, AuthToken, ChaosLogEntry } from '../types/index.ts';

// Initial in-memory seed data
const INITIAL_USERS: User[] = [
  {
    user_id: 'usr_1001',
    username: 'alex.chen',
    password_hash: 'secret123',
    email: 'alex.chen@platform.internal',
    full_name: 'Alex Chen',
    role: 'admin',
    status: 'active',
    tier: 'enterprise',
    created_at: '2026-01-15T09:30:00Z',
    preferences: {
      theme: 'dark',
      notifications_enabled: true
    }
  },
  {
    user_id: 'usr_1002',
    username: 'sarah.connor',
    password_hash: 'cyberdyne99',
    email: 'sarah.connor@defense.tech',
    full_name: 'Sarah Connor',
    role: 'engineer',
    status: 'active',
    tier: 'pro',
    created_at: '2026-02-01T14:15:00Z',
    preferences: {
      theme: 'system',
      notifications_enabled: false
    }
  },
  {
    user_id: 'usr_1003',
    username: 'marcus.vance',
    password_hash: 'auditpass42',
    email: 'marcus.vance@compliance.corp',
    full_name: 'Marcus Vance',
    role: 'auditor',
    status: 'active',
    tier: 'enterprise',
    created_at: '2026-03-10T11:00:00Z',
    preferences: {
      theme: 'light',
      notifications_enabled: true
    }
  },
  {
    user_id: 'usr_1004',
    username: 'elena.rostova',
    password_hash: 'observer77',
    email: 'elena.rostova@analytics.io',
    full_name: 'Elena Rostova',
    role: 'viewer',
    status: 'provisioning',
    tier: 'standard',
    created_at: '2026-04-05T16:45:00Z',
    preferences: {
      theme: 'dark',
      notifications_enabled: false
    }
  }
];

class InMemoryStore {
  private users: Map<string, User> = new Map();
  private tokens: Map<string, AuthToken> = new Map();
  private chaosLogs: ChaosLogEntry[] = [];
  private schemaDriftActive: boolean = false;
  private schemaDriftType: 'rename_field' | 'drop_required' | 'type_mismatch' | 'none' = 'none';

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.users.clear();
    for (const u of INITIAL_USERS) {
      this.users.set(u.user_id, { ...u });
    }
    this.tokens.clear();
    this.chaosLogs = [];
    this.schemaDriftActive = false;
    this.schemaDriftType = 'none';

    // Seed an initial demo active token
    const demoToken: AuthToken = {
      access_token: 'token_demo_enterprise_live_session',
      token_type: 'Bearer',
      expires_in: 86400,
      user_id: 'usr_1001',
      scope: 'read:profile write:profile admin:all',
      created_at: Date.now()
    };
    this.tokens.set(demoToken.access_token, demoToken);
  }

  // User operations
  public getUserById(userId: string): User | undefined {
    return this.users.get(userId);
  }

  public getUserByUsername(username: string): User | undefined {
    for (const user of this.users.values()) {
      if (user.username === username) return user;
    }
    return undefined;
  }

  public listUsers(page = 1, limit = 10): { items: User[]; total: number; page: number; limit: number } {
    const all = Array.from(this.users.values());
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit);
    return {
      items,
      total: all.length,
      page,
      limit
    };
  }

  // Token operations
  public saveToken(token: AuthToken): void {
    this.tokens.set(token.access_token, token);
  }

  public getToken(tokenStr: string): AuthToken | undefined {
    const token = this.tokens.get(tokenStr);
    if (!token) return undefined;
    // Check expiration
    if (Date.now() > token.created_at + token.expires_in * 1000) {
      this.tokens.delete(tokenStr);
      return undefined;
    }
    return token;
  }

  // Chaos Logging
  public logChaosEvent(entry: Omit<ChaosLogEntry, 'id' | 'timestamp'>): ChaosLogEntry {
    const fullEntry: ChaosLogEntry = {
      ...entry,
      id: 'chaos_' + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString()
    };
    this.chaosLogs.unshift(fullEntry);
    if (this.chaosLogs.length > 50) {
      this.chaosLogs.pop();
    }
    return fullEntry;
  }

  public getChaosLogs(): ChaosLogEntry[] {
    return [...this.chaosLogs];
  }

  public clearChaosLogs(): void {
    this.chaosLogs = [];
  }

  // Schema Drift Mutation Simulation
  public setSchemaDrift(active: boolean, driftType: 'rename_field' | 'drop_required' | 'type_mismatch' | 'none' = 'rename_field'): void {
    this.schemaDriftActive = active;
    this.schemaDriftType = active ? driftType : 'none';
  }

  public isSchemaDriftActive(): boolean {
    return this.schemaDriftActive;
  }

  public getSchemaDriftType(): string {
    return this.schemaDriftType;
  }
}

export const inMemoryStore = new InMemoryStore();
