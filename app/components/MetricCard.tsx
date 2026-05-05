'use client';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  valueClassName?: string;
}

export default function MetricCard({ title, value, subtitle, valueClassName }: MetricCardProps) {
  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-100 dark:border-slate-800 p-6">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{title}</p>
      <p className={`mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100 ${valueClassName ?? ''}`}>{value}</p>
      {subtitle && <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>}
    </div>
  );
}
