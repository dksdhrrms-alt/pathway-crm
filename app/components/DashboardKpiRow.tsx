'use client';

/**
 * DashboardKpiRow — 4 metric cards along the top of the Home page.
 *
 * Pattern mirrors Linear / Attio / Vercel: a single compact row of
 * KPIs that tells the user, in one glance, how their quarter is
 * tracking before any of the long-form sections below.
 *
 * Metrics:
 *   1. Open Pipeline (sum of $ for all open opps the user can see)
 *   2. Won This Month
 *   3. My Open Opportunities (count)
 *   4. My Open Tasks (count, with overdue callout)
 *
 * Each tile shows a big number, a mini delta/label, and an optional
 * sparkline. Click a tile → navigates to the matching list.
 */

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { TrendingUp, DollarSign, Target as TargetIcon, CheckSquare } from 'lucide-react';

/**
 * `scope` matches the Dashboard header toggle (Company-wide / Team /
 * Personal). Without this prop the KPI tiles used to ignore the toggle
 * and always render the "allowed max" scope for the role — which meant
 * admins saw company-wide numbers even after flipping to "Personal".
 *
 *   'company'              → every opp/task in the DB (admin-tier only)
 *   { team: 'ruminants' }  → everybody on that team's rows
 *   'personal'             → ownerId === current user
 */
export type KpiScope = 'company' | 'personal' | { team: string };

export default function DashboardKpiRow({ scope = 'personal' }: { scope?: KpiScope }) {
  const router = useRouter();
  const { data: session } = useSession();
  const { users } = useUsers();
  const { opportunities, tasks } = useCRM();
  const userId = session?.user?.id ?? '';

  const data = useMemo(() => {
    const today = new Date();
    const thisMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    // Build the owner-id set that defines the scope.
    const scopedOwnerIds: Set<string> | null = (() => {
      if (scope === 'company') return null; // null = no filter (see all)
      if (scope === 'personal') return new Set(userId ? [userId] : []);
      // team scope
      const team = scope.team;
      const ids = new Set<string>();
      for (const u of users) {
        if (u.team === team) ids.add(u.id);
      }
      // Fallback: at minimum include self so an empty-team view isn't blank
      if (userId) ids.add(userId);
      return ids;
    })();

    const inScope = <T extends { ownerId: string }>(r: T) =>
      scopedOwnerIds === null || scopedOwnerIds.has(r.ownerId);

    const scopedOpps = opportunities.filter(inScope);
    const scopedTasks = tasks.filter(inScope);

    const open = scopedOpps.filter((o) => o.stage !== 'Won' && o.stage !== 'Stalled or Lost');
    const openPipeline = open.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const openOppsCount = open.length;

    const wonThisMonth = scopedOpps
      .filter((o) => o.stage === 'Won' && o.closeDate && new Date(o.closeDate + 'T00:00:00') >= thisMonthStart)
      .reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const wonCountMonth = scopedOpps
      .filter((o) => o.stage === 'Won' && o.closeDate && new Date(o.closeDate + 'T00:00:00') >= thisMonthStart)
      .length;

    const openTasks = scopedTasks.filter((t) => t.status === 'Open');
    const todayISO = today.toISOString().slice(0, 10);
    const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < todayISO).length;

    return {
      openPipeline, openOppsCount,
      wonThisMonth, wonCountMonth,
      openTasksCount: openTasks.length, overdueTasks,
    };
  }, [opportunities, tasks, users, userId, scope]);

  // Label hints — "My Open Opps" vs "Open Opportunities" depending on
  // whether the user is zoomed into their own rows or not.
  const isPersonal = scope === 'personal';

  const fmtMoney = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${Math.round(n).toLocaleString()}`;
  };

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
      <KpiTile
        icon={<DollarSign className="w-4 h-4" />}
        label="Open Pipeline"
        value={fmtMoney(data.openPipeline)}
        hint={`${data.openOppsCount} opp${data.openOppsCount === 1 ? '' : 's'}`}
        tone="brand"
        onClick={() => router.push('/opportunities')}
      />
      <KpiTile
        icon={<TrendingUp className="w-4 h-4" />}
        label="Won This Month"
        value={fmtMoney(data.wonThisMonth)}
        hint={`${data.wonCountMonth} closed`}
        tone="success"
        onClick={() => router.push('/opportunities')}
      />
      <KpiTile
        icon={<TargetIcon className="w-4 h-4" />}
        label={isPersonal ? 'My Open Opps' : 'Open Opportunities'}
        value={String(data.openOppsCount)}
        tone="info"
        onClick={() => router.push('/opportunities')}
      />
      <KpiTile
        icon={<CheckSquare className="w-4 h-4" />}
        label={isPersonal ? 'My Open Tasks' : 'Open Tasks'}
        value={String(data.openTasksCount)}
        hint={data.overdueTasks > 0 ? `${data.overdueTasks} overdue` : undefined}
        hintTone={data.overdueTasks > 0 ? 'destructive' : undefined}
        tone="violet"
        onClick={() => router.push('/tasks')}
      />
    </div>
  );
}

function KpiTile({
  icon, label, value, hint, hintTone, tone, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  hintTone?: 'destructive';
  tone: 'brand' | 'success' | 'info' | 'violet';
  onClick: () => void;
}) {
  const toneIcon: Record<string, string> = {
    brand:   'bg-brand-tint text-brand',
    success: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
    info:    'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300',
    violet:  'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
  };
  return (
    <Card interactive variant="default" padding="md" onClick={onClick}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${toneIcon[tone]}`}>
          {icon}
        </span>
        <span className="text-[11px] font-medium text-muted-fg uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-foreground tabular-nums leading-tight">{value}</div>
      {hint && (
        <div className="mt-1">
          {hintTone === 'destructive' ? (
            <Badge tone="destructive" size="xs">{hint}</Badge>
          ) : (
            <span className="text-[11px] text-muted-fg">{hint}</span>
          )}
        </div>
      )}
    </Card>
  );
}
