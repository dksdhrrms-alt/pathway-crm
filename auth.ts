import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { createClient } from '@supabase/supabase-js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        try {
          console.log('=== AUTH ATTEMPT ===', credentials?.email);

          const email = (credentials?.email as string || '').toLowerCase().trim();
          const password = credentials?.password as string || '';
          if (!email || !password) {
            console.log('[AUTH] Missing credentials');
            return null;
          }

          // Use server-side env vars first, fall back to NEXT_PUBLIC_ vars
          const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

          console.log('[AUTH] Supabase URL:', supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : 'MISSING');
          console.log('[AUTH] Supabase key exists:', !!supabaseKey);

          if (!supabaseUrl || !supabaseKey) {
            console.error('[AUTH] Supabase env vars not configured');
            return null;
          }

          const sb = createClient(supabaseUrl, supabaseKey);

          const { data: user, error } = await sb
            .from('users').select('*')
            .eq('email', email).single();

          console.log('[AUTH] DB result:', {
            found: !!user,
            error: error?.message,
            errorCode: error?.code,
            userName: user?.name,
            userRole: user?.role,
            pwLength: user?.password?.length,
          });

          if (error || !user) {
            console.log('[AUTH] User not found or DB error:', error?.message);
            return null;
          }

          if (user.status !== 'active') {
            console.log('[AUTH] User not active:', user.status);
            return null;
          }

          // Support both bcrypt and plain text passwords
          const bcrypt = await import('bcryptjs');
          const pwOk = user.password.startsWith('$2')
            ? await bcrypt.compare(password, user.password)
            : password === user.password;

          console.log('[AUTH] Password match:', pwOk);

          if (!pwOk) return null;

          console.log('=== AUTH SUCCESS ===', user.email, user.role);

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : '';
          console.error('=== AUTH ERROR ===', msg, stack);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role || 'sales';
        console.log('[AUTH] JWT:', token.sub, 'role:', token.role, 'name:', token.name);
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub || '',
          role: (token.role as string) || 'sales',
        },
      };
    },
  },
  pages: { signIn: '/login' },
  session: { strategy: 'jwt' },
});
