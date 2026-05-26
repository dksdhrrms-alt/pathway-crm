export type UserRole = 'administrative_manager' | 'admin' | 'ceo' | 'sales_director' | 'coo' | 'sales' | 'marketing';
export type UserStatus = 'active' | 'pending' | 'inactive';

export type UserTeam = 'monogastrics' | 'swine' | 'ruminants' | 'latam' | 'familyb2b' | 'marketing' | 'management' | null;

export interface AppUser {
  id: string;
  name: string;
  email: string;
  /**
   * Stored on server-side rows (write paths: register, login, password
   * change, legacy file-store). API responses and the in-memory user list
   * exposed to the client NEVER include this — both /api/users and
   * dbGetUsers explicitly strip it. Kept as a required field so existing
   * write-path callers (login, seed, userStore) type-check.
   */
  password: string;
  role: UserRole;
  initials: string;
  phone?: string;
  status: UserStatus;
  profilePhoto?: string | null;
  team?: UserTeam;
}

/**
 * Demo / development seed accounts.
 *
 * These were originally `status: 'active'` with a shared `demo1234` password
 * so the file-store fallback would let anyone log in as the admin during
 * local dev. That is unacceptable in production, where the file-store
 * fallback can still be reached if Supabase env vars are missing. We mark
 * every seed account as `inactive` so the credentials provider rejects
 * them (see auth.ts: `if (user.status !== 'active') return null;`).
 *
 * A real admin must be created via /api/admin/create-user.
 */
export const users: AppUser[] = [
  {
    id: 'user-002',
    name: 'Alex Morgan',
    email: 'admin@pathway-usa.com',
    password: 'demo1234',
    role: 'admin',
    initials: 'AM',
    status: 'inactive',
    phone: '+1 (555) 100-0001',
  },
  {
    id: 'user-003',
    name: 'Sarah Mitchell',
    email: 'sarah@pathway-usa.com',
    password: 'demo1234',
    role: 'sales',
    initials: 'SM',
    status: 'inactive',
    phone: '+1 (555) 100-0002',
  },
  {
    id: 'user-004',
    name: 'James Henderson',
    email: 'james@pathway-usa.com',
    password: 'demo1234',
    role: 'sales',
    initials: 'JH',
    status: 'inactive',
    phone: '+1 (555) 100-0003',
  },
  {
    id: 'user-005',
    name: 'Rachel Torres',
    email: 'rachel@pathway-usa.com',
    password: 'demo1234',
    role: 'coo',
    initials: 'RT',
    status: 'inactive',
    phone: '+1 (555) 100-0004',
  },
  {
    id: 'user-006',
    name: 'Lisa Chen',
    email: 'lisa@pathway-usa.com',
    password: 'demo1234',
    role: 'marketing',
    initials: 'LC',
    status: 'inactive',
    phone: '+1 (555) 100-0005',
  },
];

export function getUserByEmail(email: string): AppUser | undefined {
  return users.find((u) => u.email === email);
}

export function getUserById(id: string): AppUser | undefined {
  return users.find((u) => u.id === id);
}

export function getUserByName(name: string): AppUser | undefined {
  return users.find((u) => u.name === name);
}

export function getAllUsers(): AppUser[] {
  return users;
}

export function generateUserId(): string {
  return 'user-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'administrative_manager': return 'Admin Manager';
    case 'admin': return 'Admin';
    case 'ceo': return 'CEO';
    case 'sales_director': return 'Sales Director';
    case 'coo': return 'COO';
    case 'sales': return 'Sales Rep';
    case 'marketing': return 'Marketing';
  }
}

export const ROLE_COLORS: Record<UserRole, string> = {
  administrative_manager: '#1a4731',
  admin: '#1e40af',
  ceo: '#1a3a5c',
  sales_director: '#6d28d9',
  coo: '#4a1d96',
  sales: '#0369a1',
  marketing: '#92400e',
};

/** Roles that can see all data (not filtered by ownerId) */
export function canViewAll(role: UserRole): boolean {
  return ['administrative_manager', 'admin', 'ceo', 'sales_director', 'coo'].includes(role);
}
