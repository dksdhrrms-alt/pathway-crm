'use client';

/**
 * Self-signup has been disabled. Accounts are provisioned only by
 * an administrator via Admin → Users. Anyone who lands here (an old
 * bookmark, a stale link) is redirected to the login page with a
 * short notice instead of a working form.
 *
 * The old form + /api/auth/register endpoint are now server-side
 * no-ops (the API returns 410 Gone) — see
 *   app/api/auth/register/route.ts
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupDisabledPage() {
  const router = useRouter();
  useEffect(() => {
    // Soft redirect after a brief read of the notice.
    const t = setTimeout(() => router.replace('/login'), 2500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50 dark:bg-slate-950">
      <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 shadow-sm p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Self-signup is disabled</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Accounts are created by an administrator. If you need access to the CRM, please contact your admin or manager.
        </p>
        <Link href="/login" className="inline-block px-4 py-2 rounded-lg text-sm font-semibold text-white"
          style={{ backgroundColor: '#1a4731' }}>
          Go to sign in
        </Link>
      </div>
    </div>
  );
}
