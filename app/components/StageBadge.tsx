'use client';

import { Stage } from '@/lib/data';

interface StageBadgeProps {
  stage: Stage;
}

const stageStyles: Record<Stage, string> = {
  Prospect: 'bg-slate-100 text-slate-700',
  Prospecting: 'bg-gray-100 text-gray-700',
  Qualified: 'bg-cyan-100 text-cyan-700',
  Qualification: 'bg-blue-100 text-blue-700',
  'Trial Started': 'bg-teal-100 text-teal-700',
  Proposal: 'bg-amber-100 text-amber-700',
  Negotiation: 'bg-purple-100 text-purple-700',
  'Closed Won': 'bg-green-100 text-green-700',
  'Closed Lost': 'bg-red-100 text-red-700',
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
