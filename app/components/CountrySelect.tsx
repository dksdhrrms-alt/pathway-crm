'use client';

import { useState, useEffect } from 'react';

const COUNTRIES = [
  { code: 'US', name: 'USA', flag: '🇺🇸' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'PE', name: 'Peru', flag: '🇵🇪' },
  { code: 'PA', name: 'Panama', flag: '🇵🇦' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'DO', name: 'Dominican Republic', flag: '🇩🇴' },
  { code: 'JM', name: 'Jamaica', flag: '🇯🇲' },
  { code: 'KR', name: 'Korea', flag: '🇰🇷' },
  { code: 'GB', name: 'UK', flag: '🇬🇧' },
  { code: 'OTHER', name: 'Other', flag: '🌐' },
];

interface Props {
  value: string;
  onChange: (val: string) => void;
}

export default function CountrySelect({ value, onChange }: Props) {
  const isKnown = COUNTRIES.some((c) => c.name === value);
  const [isOther, setIsOther] = useState(!isKnown && !!value);
  const [customVal, setCustomVal] = useState(!isKnown ? value : '');

  useEffect(() => {
    const known = COUNTRIES.some((c) => c.name === value);
    if (!known && value) { setIsOther(true); setCustomVal(value); }
  }, [value]);

  return (
    <div>
      <select
        value={isOther ? 'Other' : value}
        onChange={(e) => {
          if (e.target.value === 'Other') { setIsOther(true); onChange(customVal || 'Other'); }
          else { setIsOther(false); setCustomVal(''); onChange(e.target.value); }
        }}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:border-slate-600 dark:text-gray-100"
      >
        <option value="">Select country...</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.name}>{c.flag} {c.name}</option>
        ))}
      </select>
      {isOther && (
        <input type="text" value={customVal} onChange={(e) => { setCustomVal(e.target.value); onChange(e.target.value); }}
          placeholder="Enter country name" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-2 focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:border-slate-600 dark:text-gray-100 dark:placeholder-gray-500" />
      )}
    </div>
  );
}
