import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const sb = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        const email = (credentials?.email as string || '').toLowerCase().trim();
        const password = credentials?.password as string || '';
        if (!email || !password) return null;

        if (!sb) return null;

        const { data: user } = await sb
          .from('users').select('*')
          .eq('email', email).single();

        if (!user || user.status !== 'active') return null;

        // Support both bcrypt and plain text passwords
        const pwOk = user.password.startsWith('$2')
          ? await bcrypt.compare(password, user.password)
          : password === user.password;

        if (!pwOk) return null;

        console.log('[AUTH] Login OK:', user.email, 'role:', user.role);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
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
