/**
 * Legacy /projects route — kept only to redirect bookmarked links
 * to the new /trials surface. The Gantt-chart Project Tracker that
 * used to live here was removed in favour of the Trial Tracker (see
 * app/trials/page.tsx, data-migration/36-trials.sql).
 *
 * This file can be deleted entirely once we're confident no one has
 * /projects in a bookmark or an email link.
 */

import { redirect } from 'next/navigation';

export default function LegacyProjectsRedirect(): never {
  redirect('/trials');
}
