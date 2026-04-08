'use client';

import { useState, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import { MONOGASTRICS_GROUP } from '@/lib/teams';

export type ViewType = 'personal' | 'team' | 'company';

export function useViewFilter() {
  const { data: session } = useSession();
  const { users } = useUsers();

  const userId = session?.user?.id ?? '';
  const role = (session?.user as { role?: string })?.role ?? '';

  const isAdminOrCeo = ['admin', 'administrative_manager', 'ceo', 'coo', 'sales_director'].includes(role);

  const [activeView, setActiveView] = useState<ViewType>('personal');

  const currentUser = users.find((u) => u.id === userId);
  const userTeam = (currentUser as { team?: string } | undefined)?.team ?? '';

  // Get team member IDs
  const teamMemberIds = useMemo(() => {
    if (!userTeam) return [userId];
    const teamIds = MONOGASTRICS_GROUP.includes(userTeam) ? MONOGASTRICS_GROUP : [userTeam];
    return users
      .filter((u) => teamIds.includes((u as { team?: string }).team || ''))
      .map((u) => u.id);
  }, [users, userTeam, userId]);

  // Team label
  const teamLabel = useMemo(() => {
    if (!userTeam) return 'Team';
    const map: Record<string, string> = {
      monogastrics: 'Monogastrics',
      swine: 'Monogastrics',
      ruminants: 'Ruminants',
      latam: 'LATAM',
      familyb2b: 'Family/B2B',
      marketing: 'Marketing',
      management: 'Management',
    };
    return map[userTeam] || 'Team';
  }, [userTeam]);

  const viewLabel =
    activeView === 'company'
      ? 'Company-wide view'
      : activeView === 'team'
        ? `${teamLabel} team view`
        : 'My personal view';

  // Filter by ownerId — stable reference via useCallback
  const filterByView = useCallback(<T extends { ownerId: string }>(data: T[]): T[] => {
    if (activeView === 'company') return data;
    if (activeView === 'team') return data.filter((item) => teamMemberIds.includes(item.ownerId));
    return data.filter((item) => item.ownerId === userId);
  }, [activeView, teamMemberIds, userId]);

  return { activeView, setActiveView, filterByView, teamLabel, viewLabel, isAdminOrCeo, userId, teamMemberIds };
}
