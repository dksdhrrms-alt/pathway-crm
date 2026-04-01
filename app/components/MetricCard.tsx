'use client';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  valueClassName?: string;
}

export default function MetricCard({ title, value, subtitle, valueClassName }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{title}</p>
      <p className={`mt-2 text-3xl font-bold text-gray-900 ${valueClassName ?? ''}`}>{value}</p>
      {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
    </div>
  );
}
