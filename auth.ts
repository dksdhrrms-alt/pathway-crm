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

          // Stamp last_login_at on every successful sign-in. Fire-and-forget
          // so a transient DB hiccup doesn't break login itself.
          sb.from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', user.id)
            .then(({ error: upErr }) => {
              if (upErr) console.error('[AUTH] last_login_at update failed:', upErr.message);
            });

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
    async jwt({ token, user }) {
      // Initial sign-in: stamp the role from the authorize() result and
      // record the issue time so we know when to refresh.
      if (user) {
        token.role = (user as { role?: string }).role || 'sales';
        token.roleRefreshedAt = Date.now();
        return token;
      }

      // Subsequent requests: NextAuth usually hands us only the token,
      // which means a role promotion in Supabase (e.g. Admin flips
      // somebody from 'sales' to 'sales_director') never shows up in
      // the user's menu / permissions until they sign out and back in.
      // Brad hit exactly that on 2026-11-19. Refresh from the DB at
      // most once every 5 minutes to keep the login surface cheap.
      const FIVE_MIN = 5 * 60 * 1000;
      const last = Number(token.roleRefreshedAt || 0);
      if (token.sub && Date.now() - last > FIVE_MIN) {
        try {
          const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
          const key = process.env.SUPABASE_SERVICE_ROLE_KEY
            || process.env.SUPABASE_ANON_KEY
            || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
          if (url && key) {
            const sb = createClient(url, key, { auth: { persistSession: false } });
            const { data } = await sb.from('users')
              .select('role').eq('id', token.sub).maybeSingle();
            if (data?.role) token.role = data.role as string;
          }
          token.roleRefreshedAt = Date.now();
        } catch {
          // Best-effort — on any failure we keep the stale role rather
          // than booting the user out mid-session.
        }
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
