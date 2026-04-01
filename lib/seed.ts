import { supabase, supabaseEnabled } from './supabase';
import { initialAccounts, initialContacts, initialOpportunities, initialActivities, initialTasks } from './data';
import { users as mockUsers } from './users';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSnake(obj: any): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const snakeKey = k.replace(/[A-Z]/g, (c: string) => '_' + c.toLowerCase());
    result[snakeKey] = v;
  }
  return result;
}

export async function seedDatabase(): Promise<{ ok: boolean; message: string }> {
  if (!supabaseEnabled) {
    return { ok: false, message: 'Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local' };
  }

  try {
    // Check if data already exists
    const { data: existingUsers } = await supabase.from('users').select('id').limit(1);
    if (existingUsers && existingUsers.length > 0) {
      return { ok: false, message: 'Database already has data. Clear tables first if you want to re-seed.' };
    }

    // Seed users
    const userRows = mockUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      password: u.password,
      phone: u.phone || null,
      role: u.role,
      initials: u.initials,
      status: u.status,
      profile_photo: u.profilePhoto || null,
    }));
    const { error: userErr } = await supabase.from('users').insert(userRows);
    if (userErr) throw new Error(`Users: ${userErr.message}`);

    // Seed accounts
    const accountRows = initialAccounts.map((a) => toSnake(a));
    const { error: accErr } = await supabase.from('accounts').insert(accountRows);
    if (accErr) throw new Error(`Accounts: ${accErr.message}`);

    // Seed contacts
    const contactRows = initialContacts.map((c) => toSnake(c));
    const { error: conErr } = await supabase.from('contacts').insert(contactRows);
    if (conErr) throw new Error(`Contacts: ${conErr.message}`);

    // Seed opportunities
    const oppRows = initialOpportunities.map((o) => toSnake(o));
    const { error: oppErr } = await supabase.from('opportunities').insert(oppRows);
    if (oppErr) throw new Error(`Opportunities: ${oppErr.message}`);

    // Seed activities
    const actRows = initialActivities.map((a) => toSnake(a));
    const { error: actErr } = await supabase.from('activities').insert(actRows);
    if (actErr) throw new Error(`Activities: ${actErr.message}`);

    // Seed tasks
    const taskRows = initialTasks.map((t) => toSnake(t));
    const { error: taskErr } = await supabase.from('tasks').insert(taskRows);
    if (taskErr) throw new Error(`Tasks: ${taskErr.message}`);

    return { ok: true, message: `Seeded: ${userRows.length} users, ${accountRows.length} accounts, ${contactRows.length} contacts, ${oppRows.length} opportunities, ${actRows.length} activities, ${taskRows.length} tasks` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Unknown error' };
  }
}
