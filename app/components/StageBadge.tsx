'use client';

import { Stage } from '@/lib/data';

interface StageBadgeProps {
  stage: Stage;
}

const stageStyles: Record<Stage, string> = {
  Prospect: 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300',
  Prospecting: 'bg-gray-100 text-gray-700 dark:bg-gray-900/40 dark:text-gray-300',
  Qualified: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
  Qualification: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'Trial Started': 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  Proposal: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  Negotiation: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'Closed Won': 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'Closed Lost': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export default function StageBadge({ stage }: StageBadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${stageStyles[stage]}`}
    >
      {stage}
    </span>
  );
}
