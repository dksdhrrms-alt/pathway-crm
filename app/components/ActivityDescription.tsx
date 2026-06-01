'use client';

/**
 * Shared renderer for an Activity's `description` string.
 *
 * The inbound-email route appends an "📎 Attachments:" block to the
 * description; we parse that out and render each attachment as a small
 * clickable chip so users don't have to wade through a wall of signed
 * URL text.
 *
 * Description format (set in /api/inbound-email/route.ts):
 *
 *   <body text>
 *
 *   📎 Attachments:
 *   • Report.pdf (245 KB) — https://....supabase.co/.../Report.pdf
 *   • Quote.xlsx (32 KB)  — https://....supabase.co/.../Quote.xlsx
 *
 * Both the ActivityTimeline (Contact page) and the inline timeline on
 * the Account detail page render via this component, so the styling
 * stays consistent. Callers can pass tailwind classes to align with
 * their surrounding card.
 */

import React from 'react';

interface Props {
  description?: string | null;
  /** Tailwind classes for the body text container. Defaults to a soft
   *  gray block matching the existing Contact/Account inline rendering. */
  bodyClassName?: string;
}

export default function ActivityDescription({ description, bodyClassName }: Props) {
  const text = String(description || '');
  if (!text) return null;

  // Tolerate every reasonable header variant:
  //   "📎 Attachments:" "📎Attachments:" "Attachments:" — case-insensitive.
  const markerMatch = text.match(/(?:📎\s*)?attachments\s*:/i);
  const idx = markerMatch ? markerMatch.index ?? -1 : -1;
  const bodyPart = idx >= 0 ? text.slice(0, idx).trim() : text;
  const attPart  = idx >= 0 ? text.slice(idx + (markerMatch?.[0]?.length ?? 0)) : '';

  const attachments: { name: string; size: string; url: string }[] = [];
  if (attPart) {
    // Collapse any line-wrapping inside URLs (textarea / copy-paste can
    // inject hard breaks).  We rebuild the block on a single line, then
    // split into items by the bullet character.
    const compact = attPart.replace(/\s*\n\s*/g, ' ').trim();
    const items = compact.split(/\s+(?=[•\-*]\s)/).map((s) => s.trim()).filter(Boolean);
    for (const raw of items) {
      const m = raw.match(/^[•\-*]\s*(.+?)\s*\(([^)]+)\)\s*[—–\-]\s*(https?:\/\/\S+)/);
      if (m) {
        // Strip trailing punctuation that may have hitched a ride.
        const cleanUrl = m[3].replace(/[)\]>.,;]+$/, '');
        attachments.push({ name: m[1], size: m[2], url: cleanUrl });
      }
    }
  }

  return (
    <>
      {bodyPart && (
        <p
          className={
            bodyClassName ??
            'mt-1 text-sm text-gray-600 leading-relaxed dark:text-gray-300 whitespace-pre-wrap'
          }
        >
          {bodyPart}
        </p>
      )}
      {attachments.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((a, i) => (
            <a
              key={`${a.name}-${i}`}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`Open ${a.name}`}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800 hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-700 dark:text-gray-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 10-5.656-5.656L4.93 12.343a6 6 0 108.486 8.486L20.5 13.5" />
              </svg>
              <span className="font-medium truncate max-w-[14rem]">{a.name}</span>
              <span className="text-gray-400 dark:text-gray-500">{a.size}</span>
            </a>
          ))}
        </div>
      )}
    </>
  );
}
