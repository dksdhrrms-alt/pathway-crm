import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { createClient } from '@supabase/supabase-js';
import { verifyAndUpgradePassword } from '@/lib/auth-utils';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        try {
          const email = (credentials?.email as string || '').toLowerCase().trim();
          const password = credentials?.password as string || '';
          if (!email || !password) return null;

          // Server-side env vars first, fall back to NEXT_PUBLIC_ vars.
          const supabaseUrl =
            process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
          const supabaseKey =
            process.env.SUPABASE_ANON_KEY ||
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
            '';

          if (!supabaseUrl || !supabaseKey) {
            console.error('[AUTH] Supabase env vars not configured');
            return null;
          }

          const sb = createClient(supabaseUrl, supabaseKey);

          const { data: user, error } = await sb
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

          // Treat "not found" and "DB error" the same so we don't leak which
          // emails are registered. Generic error log on the server side only.
          if (error || !user) {
            if (error && error.code !== 'PGRST116') {
              // PGRST116 = no rows; that's the expected miss case.
              console.error('[AUTH] User lookup failed:', error.code);
            }
            return null;
          }

          if (user.status !== 'active') return null;

          const pwOk = await verifyAndUpgradePassword(
            password,
            user.password,
            user.id
          );
          if (!pwOk) return null;

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[AUTH] authorize() threw:', msg);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role || 'sales';
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
