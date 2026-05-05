'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { verifyAndUpgradePassword, verifyPassword } from '@/lib/auth-utils';
import { supabase, supabaseEnabled } from '@/lib/supabase';

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
): Promise<string | undefined> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  let userId = '';
  let userName = '';
  let userRole = '';

  // Try Supabase first.
  if (supabaseEnabled) {
    const { data: dbUser } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (dbUser) {
      const match = await verifyAndUpgradePassword(
        password,
        dbUser.password,
        dbUser.id
      );
      if (!match) return 'Invalid email or password.';
      if (dbUser.status === 'pending') return 'Your account is pending admin approval.';
      if (dbUser.status === 'inactive') return 'Your account has been deactivated.';
      userId = dbUser.id;
      userName = dbUser.name;
      userRole = dbUser.role;
    }
  }

  // Fallback: local file store (dev / pre-Supabase setups).
  // The file store cannot be auto-upgraded, so we just verify.
  if (!userId) {
    const { getStoreUserByEmail } = await import('@/lib/userStore');
    const user = getStoreUserByEmail(email);
    if (!user) return 'Invalid email or password.';
    const match = await verifyPassword(password, user.password);
    if (!match) return 'Invalid email or password.';
    if (user.status === 'pending') return 'Your account is pending admin approval.';
    if (user.status === 'inactive') return 'Your account has been deactivated.';
    userId = user.id;
    userName = user.name;
    userRole = user.role;
  }

  try {
    await signIn('credentials', {
      email,
      password,
      userData: JSON.stringify({ id: userId, name: userName, role: userRole }),
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthError) return 'Something went wrong. Please try again.';
    throw error;
  }
}
