'use client';

import { useSession } from 'next-auth/react';
import { useEffect, useState, useCallback } from 'react';
import { supabase, supabaseEnabled } from '@/lib/supabase';

const ROLE_DEFAULTS: Record<string, Set<string>> = {
  administrative_manager: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports', 'sales', 'sales_dashboard', 'admin']),
  admin: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports', 'sales', 'sales_dashboard', 'admin']),
  ceo: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports', 'sales', 'sales_dashboard', 'admin']),
  coo: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports', 'sales', 'sales_dashboard']),
  sales_director: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports', 'sales', 'sales_dashboard']),
  sales: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks']),
  marketing: new Set(['home', 'accounts', 'contacts', 'opportunities', 'tasks', 'reports']),
};

const FULL_ACCESS = ['admin', 'administrative_manager', 'ceo'];

export function useMenuAccess() {
  const { data: session, status } = useSession();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  const userId = (session?.user as { id?: string })?.id;
  const role = ((session?.user as { role?: string })?.role ?? '').toLowerCase().trim();

  const loadPerms = useCallback(async () => {
    if (!userId || !supabaseEnabled) { setLoaded(true); return; }
    try {
      const { data } = await supabase.from('user_permissions').select('menu_item, permission').eq('user_id', userId);
      const map: Record<string, string> = {};
      data?.forEach((r) => {
        // Normalize: "Sales Dashboard" → "sales_dashboard", "Sales" → "sales"
        const key = r.menu_item.toLowerCase().replace(/ /g, '_');
        map[key] = r.permission;
      });
      setOverrides(map);
    } catch { /* */ }
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    if (status === 'authenticated') loadPerms();
    else if (status === 'unauthenticated') setLoaded(true);
  }, [status, loadPerms]);

  const canAccess = useCallback((menuItem: string): boolean => {
    if (FULL_ACCESS.includes(role)) return true;
    if (!loaded) return false;
    const o = overrides[menuItem];
    if (o === 'allow') return true;
    if (o === 'deny') return false;
    return ROLE_DEFAULTS[role]?.has(menuItem) ?? false;
  }, [role, overrides, loaded]);

  return { canAccess, loaded };
}
