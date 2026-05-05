import bcrypt from 'bcryptjs';
import { supabase, supabaseEnabled } from '@/lib/supabase';

const BCRYPT_PREFIX_REGEX = /^\$2[abxy]\$/;
const BCRYPT_ROUNDS = 12;

/**
 * True if the stored value already looks like a bcrypt hash.
 */
export function isPasswordHashed(password: string): boolean {
  return typeof password === 'string' && BCRYPT_PREFIX_REGEX.test(password);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Constant-time verify when the stored value is a bcrypt hash.
 * Falls back to direct comparison only for legacy plaintext rows that
 * existed before the bcrypt migration. Prefer verifyAndUpgradePassword()
 * so the legacy window is closed automatically on first successful login.
 */
export async function verifyPassword(
  plainPassword: string,
  storedPassword: string
): Promise<boolean> {
  if (!storedPassword) return false;
  if (isPasswordHashed(storedPassword)) {
    return bcrypt.compare(plainPassword, storedPassword);
  }
  return plainPassword === storedPassword;
}

/**
 * Verifies a password and, if the stored value was legacy plaintext,
 * immediately re-hashes it with bcrypt and persists the new hash.
 *
 * This eliminates the plaintext-password window for any user who
 * successfully logs in even once, without locking anyone out.
 *
 * If the upgrade write fails (network issue, RLS, etc.) we still
 * return the verification result so login is not blocked.
 *
 * Returns true if the password matched, false otherwise.
 */
export async function verifyAndUpgradePassword(
  plainPassword: string,
  storedPassword: string,
  userId: string | null | undefined
): Promise<boolean> {
  if (!storedPassword) return false;

  // Already hashed -> nothing to upgrade.
  if (isPasswordHashed(storedPassword)) {
    return bcrypt.compare(plainPassword, storedPassword);
  }

  // Legacy plaintext path: verify, then upgrade on success.
  const match = plainPassword === storedPassword;
  if (!match) return false;

  if (supabaseEnabled && userId) {
    try {
      const newHash = await hashPassword(plainPassword);
      const { error } = await supabase
        .from('users')
        .update({ password: newHash })
        .eq('id', userId);
      if (error) {
        console.error('[AUTH] Legacy password upgrade failed:', error.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[AUTH] Legacy password upgrade threw:', msg);
    }
  }

  return true;
}
