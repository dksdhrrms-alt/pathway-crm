'use server';

import { signIn } from '@/auth';
import { AuthError } from 'next-auth';
import { verifyPassword } from '@/lib/auth-utils';
import { supabase, supabaseEnabled } from '@/lib/supabase';

export async function authenticate(
  _prevState: string | undefined,
  formData: FormData
): Promise<string | undefined> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  console.log('[LOGIN] Attempt:', email, '| supabaseEnabled:', supabaseEnabled);

  let userId = '';
  let userName = '';
  let userRole = '';

  // Try Supabase
  if (supabaseEnabled) {
    const { data: dbUser, error } = await supabase
      .from('users').select('*')
      .eq('email', email.toLowerCase().trim()).single();

    console.log('[LOGIN] Supabase lookup:', dbUser ? `found ${dbUser.email} role=${dbUser.role}` : `not found (${error?.message})`);

    if (dbUser) {
      const match = await verifyPassword(password, dbUser.password);
      console.log('[LOGIN] Password verify:', match);
      if (!match) return 'Invalid email or password.';
      if (dbUser.status === 'pending') return 'Your account is pending admin approval.';
      if (dbUser.status === 'inactive') return 'Your account has been deactivated.';
      userId = dbUser.id;
      userName = dbUser.name;
      userRole = dbUser.role;
    }
  }

  // Fallback: file store
  if (!userId) {
    console.log('[LOGIN] Supabase failed, trying file store...');
    const { getStoreUserByEmail } = await import('@/lib/userStore');
    const user = getStoreUserByEmail(email);
    console.log('[LOGIN] File store:', user ? `found ${user.email} role=${user.role}` : 'not found');
    if (!user) return 'Invalid email or password.';
    const match = await verifyPassword(password, user.password);
    console.log('[LOGIN] File store password verify:', match);
    if (!match) return 'Invalid email or password.';
    if (user.status === 'pending') return 'Your account is pending admin approval.';
    if (user.status === 'inactive') return 'Your account has been deactivated.';
    userId = user.id;
    userName = user.name;
    userRole = user.role;
  }

  console.log('[LOGIN] SUCCESS:', { userId, userName, userRole });

  try {
    await signIn('credentials', {
      email, password,
      userData: JSON.stringify({ id: userId, name: userName, role: userRole }),
      redirectTo: '/dashboard',
    });
  } catch (error) {
    if (error instanceof AuthError) return 'Something went wrong. Please try again.';
    throw error;
  }
}
