/**
 * Unified user store.
 * Uses Supabase when configured, falls back to file-based store.
 */
import { users as mockUsers, AppUser } from './users';
import { supabase, supabaseEnabled } from './supabase';

// ── File-based fallback (only used when Supabase is not configured) ─────────

let fileStore: AppUser[] | null = null;

function getFileStore(): AppUser[] {
  if (fileStore) return fileStore;
  try {
    // Dynamic import for fs to avoid Edge Runtime issues
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const filePath = path.join(process.cwd(), '.crm-users.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        fileStore = data;
        return fileStore;
      }
    }
  } catch {
    // ignore - Edge Runtime or other environment
  }
  fileStore = [...mockUsers];
  saveFileStore();
  return fileStore;
}

function saveFileStore() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path');
    const filePath = path.join(process.cwd(), '.crm-users.json');
    fs.writeFileSync(filePath, JSON.stringify(fileStore, null, 2));
  } catch {
    // ignore
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getStoreUsersAsync(): Promise<AppUser[]> {
  if (supabaseEnabled) {
    const { data } = await supabase.from('users').select('*');
    if (data && data.length > 0) {
      return data.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        password: r.password,
        phone: r.phone ?? undefined,
        role: r.role,
        initials: r.initials ?? r.name?.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2),
        status: r.status,
        profilePhoto: r.profile_photo ?? undefined,
      }));
    }
  }
  return getFileStore();
}

export function getStoreUsers(): AppUser[] {
  return getFileStore();
}

export function getStoreUserByEmail(email: string): AppUser | undefined {
  return getFileStore().find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function getStoreUserById(id: string): AppUser | undefined {
  return getFileStore().find((u) => u.id === id);
}

export function addStoreUser(user: AppUser): boolean {
  const users = getFileStore();
  if (users.some((u) => u.email.toLowerCase() === user.email.toLowerCase())) {
    return false;
  }
  users.push(user);
  fileStore = users;
  saveFileStore();

  // Also insert into Supabase if configured
  if (supabaseEnabled) {
    supabase.from('users').insert({
      id: user.id,
      name: user.name,
      email: user.email,
      password: user.password,
      phone: user.phone || null,
      role: user.role,
      initials: user.initials,
      status: user.status,
      profile_photo: user.profilePhoto || null,
    }).then();
  }

  return true;
}

export function updateStoreUser(id: string, updates: Partial<AppUser>): boolean {
  const users = getFileStore();
  const idx = users.findIndex((u) => u.id === id);
  if (idx === -1) return false;
  users[idx] = { ...users[idx], ...updates };
  fileStore = users;
  saveFileStore();

  // Also update Supabase
  if (supabaseEnabled) {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.email !== undefined) dbUpdates.email = updates.email;
    if (updates.password !== undefined) dbUpdates.password = updates.password;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.role !== undefined) dbUpdates.role = updates.role;
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.profilePhoto !== undefined) dbUpdates.profile_photo = updates.profilePhoto;
    supabase.from('users').update(dbUpdates).eq('id', id).then();
  }

  return true;
}

export function validatePassword(email: string, password: string): { ok: boolean; reason?: string } {
  const user = getStoreUserByEmail(email);
  if (!user) return { ok: false, reason: 'invalid' };
  if (user.password !== password) return { ok: false, reason: 'invalid' };
  if (user.status === 'pending') return { ok: false, reason: 'pending' };
  if (user.status === 'inactive') return { ok: false, reason: 'inactive' };
  return { ok: true };
}
