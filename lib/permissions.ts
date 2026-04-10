import { UserRole } from './users';

export const MENU_ITEMS = [
  'Home', 'Accounts', 'Contacts', 'Opportunities', 'Tasks',
  'Reports', 'Insights', 'Sales', 'Sales Dashboard', 'Admin',
] as const;

export type MenuItem = (typeof MENU_ITEMS)[number];
export type PermState = 'allow' | 'deny' | 'default';

export type PermissionsMap = Record<string, Record<MenuItem, boolean>>;
export type UserPermsMap = Record<string, Record<string, PermState>>;
export type UserDataVisibility = Record<string, 'own' | 'all' | 'default'>;

const FULL_ACCESS_ROLES: UserRole[] = ['administrative_manager', 'admin', 'ceo'];

const DEFAULT_PERMISSIONS: PermissionsMap = {
  sales: {
    Home: true, Accounts: true, Contacts: true, Opportunities: true,
    Tasks: true, Reports: false, Insights: false, Sales: false, 'Sales Dashboard': false, Admin: false,
  },
  marketing: {
    Home: true, Accounts: true, Contacts: true, Opportunities: true,
    Tasks: true, Reports: true, Insights: true, Sales: false, 'Sales Dashboard': false, Admin: false,
  },
  sales_director: {
    Home: true, Accounts: true, Contacts: true, Opportunities: true,
    Tasks: true, Reports: true, Insights: true, Sales: true, 'Sales Dashboard': true, Admin: false,
  },
  coo: {
    Home: true, Accounts: true, Contacts: true, Opportunities: true,
    Tasks: true, Reports: true, Insights: true, Sales: true, 'Sales Dashboard': true, Admin: false,
  },
};

// ── Role-based permissions ──────────────────────────────────────────────────

export function getPermissions(): PermissionsMap {
  if (typeof window === 'undefined') return DEFAULT_PERMISSIONS;
  try {
    const raw = localStorage.getItem('crm_permissions');
    if (raw) return { ...DEFAULT_PERMISSIONS, ...JSON.parse(raw) };
  } catch { /* */ }
  return DEFAULT_PERMISSIONS;
}

export function savePermissions(perms: PermissionsMap) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('crm_permissions', JSON.stringify(perms));
}

function getRoleDefault(role: string, menu: MenuItem): boolean {
  if (FULL_ACCESS_ROLES.includes(role as UserRole)) return true;
  const perms = getPermissions();
  return perms[role]?.[menu] ?? false;
}

// ── Per-user permissions ────────────────────────────────────────────────────

export function getUserPerms(): UserPermsMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('crm_user_permissions');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveUserPerms(perms: UserPermsMap) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('crm_user_permissions', JSON.stringify(perms));
}

export function getUserDataVisibility(): UserDataVisibility {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('crm_user_data_visibility');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export function saveUserDataVisibility(vis: UserDataVisibility) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('crm_user_data_visibility', JSON.stringify(vis));
}

// ── Resolution: user override → role default ────────────────────────────────

export function canAccessMenu(role: UserRole, menu: MenuItem, userId?: string): boolean {
  // Full access roles always have access
  if (FULL_ACCESS_ROLES.includes(role)) return true;

  // Check per-user override first
  if (userId) {
    const userPerms = getUserPerms();
    const perm = userPerms[userId]?.[menu];
    if (perm === 'allow') return true;
    if (perm === 'deny') return false;
  }

  // Fall back to role default
  return getRoleDefault(role, menu);
}

export function canViewAllData(role: UserRole, userId?: string): boolean {
  if (FULL_ACCESS_ROLES.includes(role)) return true;
  if (['sales_director', 'coo'].includes(role)) return true;

  // Check per-user data visibility override
  if (userId) {
    const vis = getUserDataVisibility();
    if (vis[userId] === 'all') return true;
    if (vis[userId] === 'own') return false;
  }

  return false; // sales/marketing default to own data
}

export function hasFullAccess(role: UserRole): boolean {
  return FULL_ACCESS_ROLES.includes(role);
}

export function getEffectivePermissions(role: UserRole, userId: string): Record<MenuItem, { access: boolean; source: string }> {
  const result = {} as Record<MenuItem, { access: boolean; source: string }>;
  const userPerms = getUserPerms();
  for (const menu of MENU_ITEMS) {
    const userPerm = userPerms[userId]?.[menu];
    if (userPerm === 'allow') {
      result[menu] = { access: true, source: 'user override' };
    } else if (userPerm === 'deny') {
      result[menu] = { access: false, source: 'user override' };
    } else {
      const roleAccess = getRoleDefault(role, menu);
      result[menu] = { access: roleAccess, source: 'role default' };
    }
  }
  return result;
}
