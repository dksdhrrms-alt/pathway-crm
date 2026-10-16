'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Contact, generateId, US_STATES } from '@/lib/data';
import { findContactDuplicates, type DupMatch } from '@/lib/duplicates';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import CountrySelect from './CountrySelect';
import AccountSearchSelect from './AccountSearchSelect';
import SubmitButton from './SubmitButton';
import { formatPhone } from '@/lib/phone';

export const SPECIES_LIST = [
  'Primary Breeder', 'Broilers', 'Turkeys', 'Layers', 'Ruminant',
  'Swine', 'Aquaculture', 'Consulting Nutritionist', 'Industry Contact',
  'Multi', 'Research / Trials', 'University', 'Other',
];

export const CONTACT_TYPES = [
  'Independent Dairy Nutritionist',
  'Independent Poultry Nutritionist',
  'Independent Swine Nutritionist',
  'Company Nutritionist',
  'Dairy Producer',
  'Feedlot Manager/Owner',
  'Feed Mill',
  'Manager',
  'Industry Contact - Dairy',
  'Industry Contact - Beef',
  'Industry Contact - Poultry',
  'Industry Contact - Swine',
  'Veterinarian',
  'Distributor',
];

interface Props {
  initialData?: Partial<Contact>;
  onSave: () => void;
  onCancel: () => void;
  mode: 'new' | 'edit';
}

export default function ContactForm({ initialData, onSave, onCancel, mode }: Props) {
  const { accounts, contacts, addContact, updateContact, addActivity } = useCRM();
  const { users } = useUsers();
  const activeUsers = users.filter((u) => u.status === 'active');

  const [firstName, setFirstName] = useState(initialData?.firstName || '');
  const [lastName, setLastName] = useState(initialData?.lastName || '');
  const [species, setSpecies] = useState(initialData?.species || '');
  const [accountId, setAccountId] = useState(initialData?.accountId || '');
  const [country, setCountry] = useState(initialData?.country || '');
  const [ownerId, setOwnerId] = useState(initialData?.ownerId || '');
  const [position, setPosition] = useState(initialData?.position || '');
  const [isKeyMan, setIsKeyMan] = useState(initialData?.isKeyMan || false);
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [tel, setTel] = useState(initialData?.tel || '');
  const [email, setEmail] = useState(initialData?.email || '');
  const [birthday, setBirthday] = useState(initialData?.birthday || '');
  const [anniversary, setAnniversary] = useState(initialData?.anniversary || '');
  const [stateVal, setStateVal] = useState(initialData?.state || '');
  const [street, setStreet] = useState(initialData?.street || '');
  const [city, setCity] = useState(initialData?.city || '');
  const [zip, setZip] = useState(initialData?.zip || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSave).
  const [submitting, setSubmitting] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === accountId);

  // ── Duplicate detection (fuzzy) ──────────────────────────────────
  // Upgraded from exact-match (Jake vs Jake only) to Jaro-Winkler
  // fuzzy matching, so "Jacob" catches "Jake", "Jonathan" catches
  // "John", and "jsmith@acme.com" catches "j.smith@acme.com".
  // Also considers email-domain overlap as a side signal.
  // Non-blocking — user can still save if they genuinely intend a
  // same-named person at a different company.
  const editingId = initialData?.id;
  const dupes = useMemo<DupMatch<Contact>[]>(() => {
    if (firstName.trim().length < 2 && lastName.trim().length < 2 && !email) return [];
    return findContactDuplicates(
      { firstName, lastName, email },
      contacts,
      { excludeId: editingId, limit: 5 },
    );
  }, [firstName, lastName, email, contacts, editingId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = 'First name is required.';
    if (!lastName.trim()) errs.lastName = 'Last name is required.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const selectedUser = activeUsers.find((u) => u.id === ownerId);

      const data: Partial<Contact> = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        species,
        accountId,
        accountName: selectedAccount?.name || '',
        country: country.trim(),
        ownerId: ownerId || '',
        ownerName: selectedUser?.name || '',
        position: position.trim(),
        isKeyMan,
        phone: phone.trim(),
        tel: tel.trim(),
        email: email.trim(),
        birthday: birthday || undefined,
        anniversary: anniversary || undefined,
        state: stateVal.trim(),
        street: street.trim(),
        city: city.trim(),
        zip: zip.trim(),
        notes: notes.trim(),
        title: position.trim() || species,
      };

      if (mode === 'new') {
        addContact({
          id: generateId(),
          createdAt: new Date().toISOString().split('T')[0],
          ...data,
        } as Contact);
      } else if (initialData?.id) {
        updateContact(initialData.id, data);
        addActivity({
          id: generateId(), type: 'Note',
          subject: 'Contact information updated',
          description: `Updated: ${firstName} ${lastName}`,
          date: new Date().toISOString().split('T')[0],
          ownerId: '', accountId: accountId,
          contactId: initialData.id,
        });
      }
      onSave();
    } catch (err) {
      console.error('ContactForm submit failed:', err);
    } finally {
      // Always release the spinner. If the parent's onSave unmounts the
      // modal this is a no-op on an unmounted component (React 19 ignores
      // it). If the parent forgets to unmount, the user can still re-submit
      // or close manually instead of being stuck on "Saving...".
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {dupes.length > 0 && (() => {
        const hasHigh = dupes.some((d) => d.severity === 'high');
        const toneCls = hasHigh
          ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-900 dark:text-red-200'
          : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200';
        return (
          <div className={`rounded-lg border p-3 text-sm ${toneCls}`}>
            <div className="font-semibold mb-1">
              {hasHigh ? '🚨 This looks like a duplicate' : '⚠️ Possible duplicate — review before saving'}
            </div>
            <ul className="space-y-1">
              {dupes.map((m) => {
                const c = m.item;
                const acct = accounts.find((a) => a.id === c.accountId);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-1.5">
                    <Link
                      href={`/contacts/${c.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline font-medium"
                    >
                      {c.firstName} {c.lastName}
                    </Link>
                    {acct && <span className="opacity-80">· {acct.name}</span>}
                    {c.email && <span className="opacity-70">· {c.email}</span>}
                    <span className="text-[10px] uppercase tracking-wide opacity-70 ml-1">({m.reason})</span>
                  </li>
                );
              })}
            </ul>
            <div className="text-xs opacity-80 mt-2">
              You can still save if this is a different person — but please check first to avoid splitting their history.
            </div>
          </div>
        );
      })()}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">First Name *</label>
          <input type="text" value={firstName} onChange={(e) => { setFirstName(e.target.value); setErrors((p) => ({ ...p, firstName: '' })); }}
            placeholder="First name" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 ${errors.firstName ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'}`} />
          {errors.firstName && <p className="text-xs text-red-600 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Last Name *</label>
          <input type="text" value={lastName} onChange={(e) => { setLastName(e.target.value); setErrors((p) => ({ ...p, lastName: '' })); }}
            placeholder="Last name" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 ${errors.lastName ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'}`} />
          {errors.lastName && <p className="text-xs text-red-600 mt-1">{errors.lastName}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Species</label>
          <select value={species} onChange={(e) => setSpecies(e.target.value)}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select species...</option>
            {SPECIES_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Company / Account</label>
          <AccountSearchSelect
            value={selectedAccount?.name || initialData?.accountName || ''}
            onChange={(name, id) => setAccountId(id)}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Country</label>
          <CountrySelect value={country} onChange={setCountry} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">State {country && country !== 'USA' && <span className="text-gray-400 dark:text-gray-500 text-xs">(US only)</span>}</label>
          {country === 'USA' || !country ? (
            <select value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">Select state...</option>
              {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          ) : (
            <input type="text" value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="State / Province / Region"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          )}
        </div>
      </div>

      {/* Physical address — street + city + zip. State is captured
          above (US dropdown / free-text for non-US). Keeping these
          three on the same row mirrors a US mailing label layout
          and stays compact for the modal width. */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Street Address</label>
        <input type="text" value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main St, Apt 4"
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">City</label>
          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">ZIP / Postal Code</label>
          <input type="text" value={zip} onChange={(e) => setZip(e.target.value)} placeholder="02134"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Owner (Sales Rep)</label>
        <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">Select owner...</option>
          {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
            <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Contact Type</label>
        <select value={position} onChange={(e) => setPosition(e.target.value)}
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
          <option value="">Select contact type...</option>
          {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          {position && !CONTACT_TYPES.includes(position) && <option value={position}>{position} (existing)</option>}
        </select>
      </div>

      {/* Key Man toggle */}
      <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${isKeyMan ? 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/40' : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60'}`}>
        <input type="checkbox" checked={isKeyMan} onChange={(e) => setIsKeyMan(e.target.checked)} className="hidden" />
        <span className="text-xl">{isKeyMan ? '★' : '☆'}</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Key Contact</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{isKeyMan ? 'Marked as key contact' : 'Mark as key contact'}</p>
        </div>
        <span className={`text-xs font-medium ${isKeyMan ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-gray-500'}`}>{isKeyMan ? 'Key Man ★' : 'Not key'}</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Cell Phone</label>
          <input type="text" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="814-466-3366"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Tel (office)</label>
          <input type="text" value={tel} onChange={(e) => setTel(formatPhone(e.target.value))} placeholder="Office telephone"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Birthday</label>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Anniversary</label>
          <input type="date" value={anniversary} onChange={(e) => setAnniversary(e.target.value)}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Personal notes, preferences, recent conversations..."
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <SubmitButton type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </SubmitButton>
        <SubmitButton type="submit" pending={submitting} pendingText={mode === 'new' ? 'Creating...' : 'Saving...'}>
          {mode === 'new' ? 'Create Contact' : 'Save Changes'}
        </SubmitButton>
      </div>
    </form>
  );
}
