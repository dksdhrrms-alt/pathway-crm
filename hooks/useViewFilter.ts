'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useUsers } from '@/lib/UserContext';
import { MONOGASTRICS_GROUP } from '@/lib/teams';

export type ViewType = 'personal' | 'team' | 'company';

// Role-based view permissions:
//   - Admin tier (admin / administrative_manager / ceo): all 3 views
//   - Director tier (sales_director / coo): personal + team only
//   - Staff tier (sales / marketing / others): personal only
const ADMIN_ROLES = ['admin', 'administrative_manager', 'ceo'];
const DIRECTOR_ROLES = ['sales_director', 'coo'];

export function useViewFilter() {
  const { data: session } = useSession();
  const { users } = useUsers();

  const userId = session?.user?.id ?? '';
  const role = (session?.user as { role?: string })?.role ?? '';

  const isAdminOrCeo = ADMIN_ROLES.includes(role);
  const canViewCompany = isAdminOrCeo;
  const canViewTeam = isAdminOrCeo || DIRECTOR_ROLES.includes(role);

  // Default landing view: highest permitted scope
  const defaultView: ViewType = canViewCompany ? 'company' : canViewTeam ? 'team' : 'personal';
  const [activeView, setActiveViewRaw] = useState<ViewType>(defaultView);

  // Guard against unauthorized view changes (bypass attempts via stale state)
  const setActiveView = useCallback((v: ViewType) => {
    if (v === 'company' && !canViewCompany) return;
    if (v === 'team' && !canViewTeam) return;
    setActiveViewRaw(v);
  }, [canViewCompany, canViewTeam]);

  // Auto-correct if current view becomes unauthorized (e.g., role changes mid-session)
  useEffect(() => {
    if (activeView === 'company' && !canViewCompany) setActiveViewRaw(canViewTeam ? 'team' : 'personal');
    else if (activeView === 'team' && !canViewTeam) setActiveViewRaw('personal');
  }, [activeView, canViewCompany, canViewTeam]);

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

  // Filter by ownerId — automatically includes activities where the user (or a team
  // member) is an internal participant. Records without `internalParticipants` (e.g.
  // Opportunities, Tasks) keep the original owner-only behavior.
  const filterByView = useCallback(<T extends { ownerId: string; internalParticipants?: string[] }>(data: T[]): T[] => {
    if (activeView === 'company') return data;
    const matches = (item: T, idCheck: (id: string) => boolean) =>
      idCheck(item.ownerId) || (item.internalParticipants || []).some(idCheck);
    if (activeView === 'team') return data.filter((item) => matches(item, (id) => teamMemberIds.includes(id)));
    return data.filter((item) => matches(item, (id) => id === userId));
  }, [activeView, teamMemberIds, userId]);

  // Alias for callers that want to make participant-awareness explicit. Same behavior
  // as filterByView — kept for backwards compatibility / readability.
  const filterActivitiesByView = filterByView;

  return { activeView, setActiveView, filterByView, filterActivitiesByView, teamLabel, viewLabel, isAdminOrCeo, canViewCompany, canViewTeam, userId, teamMemberIds };
}
