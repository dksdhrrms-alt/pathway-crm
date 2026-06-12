'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Account, generateId, US_STATES } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import CountrySelect from './CountrySelect';
import AccountParentSelector from './AccountParentSelector';
import SubmitButton from './SubmitButton';
import { formatPhone } from '@/lib/phone';

const INDUSTRIES = [
  'Dairy/Beef', 'Poultry', 'Swine', 'Feed Mill / Premix', 'Aquaculture',
  'Multi-Species', 'Research / Trials', 'University', 'Other',
];

interface Props {
  initialData?: Partial<Account>;
  onSave: () => void;
  onCancel: () => void;
  mode: 'new' | 'edit';
}

function findUserByName(name: string, users: { id: string; name: string }[]) {
  if (!name) return null;
  const n = name.toLowerCase();
  return users.find((u) =>
    u.name.toLowerCase() === n ||
    u.name.toLowerCase().includes(n.split(' ')[0]?.toLowerCase()) ||
    n.includes(u.name.toLowerCase().split(' ')[0]?.toLowerCase())
  ) ?? null;
}

export default function AccountForm({ initialData, onSave, onCancel, mode }: Props) {
  const { accounts, addAccount, updateAccount, addActivity } = useCRM();
  const { users } = useUsers();
  const activeUsers = users.filter((u) => u.status === 'active');

  const matchedUser = initialData?.ownerName ? findUserByName(initialData.ownerName, activeUsers) : null;

  const [name, setName] = useState(initialData?.name || '');
  const [industry, setIndustry] = useState(initialData?.industry || '');
  const [ownerId, setOwnerId] = useState(initialData?.ownerId || matchedUser?.id || '');
  const [country, setCountry] = useState(initialData?.country || '');
  const [phone, setPhone] = useState(initialData?.phone || '');
  const [employee, setEmployee] = useState(initialData?.employee != null ? String(initialData.employee) : '');
  const [website, setWebsite] = useState(initialData?.website || '');
  const [location, setLocation] = useState(initialData?.location || '');
  const [stateVal, setStateVal] = useState(initialData?.state || '');
  // Physical address — Street and ZIP are dedicated new columns;
  // City and State live in the legacy `location` and `state` columns
  // (re-using `location` / `stateVal` above). See 19-accounts-physical-address.sql.
  const [physicalStreet, setPhysicalStreet] = useState(initialData?.physicalStreet || '');
  const [physicalZip, setPhysicalZip] = useState(initialData?.physicalZip || '');
  // Billing / Shipping address fields — see Account interface in lib/data.ts.
  const [billingStreet, setBillingStreet] = useState(initialData?.billingStreet || '');
  const [billingCity, setBillingCity] = useState(initialData?.billingCity || '');
  const [billingState, setBillingState] = useState(initialData?.billingState || '');
  const [billingZip, setBillingZip] = useState(initialData?.billingZip || '');
  const [shippingStreet, setShippingStreet] = useState(initialData?.shippingStreet || '');
  const [shippingCity, setShippingCity] = useState(initialData?.shippingCity || '');
  const [shippingState, setShippingState] = useState(initialData?.shippingState || '');
  const [shippingZip, setShippingZip] = useState(initialData?.shippingZip || '');
  const [notes, setNotes] = useState(initialData?.notes || '');
  // "Integration" toggle — when ON, this account is part of an Integration (parent-child) hierarchy.
  // Start with safe defaults; the useEffect below will sync values from `initialData`
  // once it's actually loaded. This avoids the useState-initializer-runs-once trap where
  // initialData was still undefined / unfetched when the form first mounted.
  const [parentAccountId, setParentAccountId] = useState('');
  const [isIntegration, setIsIntegration] = useState(false);

  useEffect(() => {
    setParentAccountId(initialData?.parentAccountId || '');
    setIsIntegration(Boolean(initialData?.parentAccountId));
  }, [initialData?.id, initialData?.parentAccountId]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSave).
  const [submitting, setSubmitting] = useState(false);

  // ── Duplicate detection ──────────────────────────────────────────
  // Trigger once the typed name is ≥4 chars (avoids matching every
  // 2-letter draft). Match strategy:
  //   - exact case-insensitive name match (highest signal)
  //   - substring match either direction ("Poulin" in "Poulin Grain"
  //     or "Cargill Mid-West" containing user-typed "Cargill")
  // Edit mode excludes the current row.
  //
  // Reps flagged that as Pathway expands across the country there are
  // legitimately same-named farms in different states (Visser, DeGroot,
  // North Side, etc.). We now split hits into two buckets:
  //   - hardDupes:  same name AND same state → red "looks like a true
  //                 duplicate, review before saving"
  //   - softDupes:  same/overlapping name BUT different (known) state →
  //                 informational blue "FYI, similar name in another
  //                 state — fine to proceed if this is a different farm"
  // If the user hasn't typed a state yet we play it safe and treat
  // everything as a hard dup (no signal to prove they're different).
  const editingId = initialData?.id;
  const { hardDupes, softDupes } = useMemo(() => {
    if (mode !== 'new') return { hardDupes: [] as Account[], softDupes: [] as Account[] };
    const n = name.trim().toLowerCase();
    if (n.length < 4) return { hardDupes: [], softDupes: [] };
    // Fallback chain for the state the rep is typing — Physical first
    // (the meaningful one), then Billing, then Shipping. Same chain on
    // the candidate side below. Mirrors bestStateCity in lib/accountDisplay.ts.
    const typedState = (stateVal || billingState || shippingState || '').trim().toLowerCase();
    const hard: Account[] = [];
    const soft: Account[] = [];
    for (const a of accounts) {
      if (a.id === editingId) continue;
      const an = (a.name || '').trim().toLowerCase();
      if (!an) continue;
      const nameMatches = an === n || an.includes(n) || n.includes(an);
      if (!nameMatches) continue;
      const otherState = (a.state || a.billingState || a.shippingState || '').trim().toLowerCase();
      // No state on either side → can't disambiguate → treat as hard.
      if (!typedState || !otherState) hard.push(a);
      else if (typedState === otherState) hard.push(a);
      else soft.push(a);
      if (hard.length + soft.length >= 8) break;
    }
    return { hardDupes: hard.slice(0, 5), softDupes: soft.slice(0, 5) };
  }, [mode, name, stateVal, billingState, shippingState, accounts, editingId]);
  // Preserved for the existing JSX render below — composed of hardDupes
  // only so the strong "review before saving" warning still feels
  // strict. Soft (different-state) matches get their own gentler box.
  const dupes = hardDupes;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Account name is required.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSubmitting(true);
    try {
      const selectedUser = activeUsers.find((u) => u.id === ownerId);
      let ws = website.trim();
      if (ws && !ws.startsWith('http') && ws.startsWith('www.')) ws = 'https://' + ws;

      const data: Partial<Account> = {
        name: name.trim(),
        industry: industry as Account['industry'],
        ownerId: ownerId || '',
        ownerName: selectedUser?.name || '',
        country: country.trim(),
        phone: phone.trim(),
        employee: employee ? parseInt(employee) : null,
        website: ws,
        location: location.trim(),
        state: stateVal.trim(),
        physicalStreet: physicalStreet.trim(),
        physicalZip: physicalZip.trim(),
        billingStreet: billingStreet.trim(),
        billingCity: billingCity.trim(),
        billingState: billingState.trim(),
        billingZip: billingZip.trim(),
        shippingStreet: shippingStreet.trim(),
        shippingCity: shippingCity.trim(),
        shippingState: shippingState.trim(),
        shippingZip: shippingZip.trim(),
        notes: notes.trim(),
        // Persist explicit empty string (not undefined) when clearing the link, so
        // updateAccount actually overwrites the existing parent_account_id in the DB
        // instead of silently skipping the field.
        parentAccountId: isIntegration && parentAccountId ? parentAccountId : '',
      };

      if (mode === 'new') {
        addAccount({
          id: generateId(),
          contactIds: [],
          opportunityIds: [],
          annualRevenue: 0,
          createdAt: new Date().toISOString().split('T')[0],
          ...data,
        } as Account);
      } else if (initialData?.id) {
        // Track changed fields
        const changed: string[] = [];
        if (data.name !== initialData.name) changed.push('Name');
        if (data.industry !== initialData.industry) changed.push('Species');
        if (data.ownerName !== (initialData.ownerName || '')) changed.push('Sales Owner');
        if (data.country !== (initialData.country || '')) changed.push('Country');

        updateAccount(initialData.id, data);

        if (changed.length > 0) {
          addActivity({
            id: generateId(), type: 'Note',
            subject: 'Account information updated',
            description: `Updated: ${changed.join(', ')}`,
            date: new Date().toISOString().split('T')[0],
            ownerId: '', accountId: initialData.id,
          });
        }
      }
      onSave();
    } catch (err) {
      console.error('AccountForm submit failed:', err);
    } finally {
      // Always release the spinner. If the parent unmounts the modal in
      // onSave this is a no-op; if it doesn't, the user isn't stuck.
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {dupes.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 p-3 text-sm">
          <div className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
            ⚠️ Possible duplicate{dupes.length > 1 ? 's' : ''} — review before saving
          </div>
          <ul className="text-amber-900 dark:text-amber-100 space-y-1">
            {dupes.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/accounts/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-700 dark:hover:text-amber-300"
                >
                  {a.name}
                </Link>
                {a.industry ? <span className="text-amber-700 dark:text-amber-300"> · {a.industry}</span> : null}
                {a.state ? <span className="text-amber-700 dark:text-amber-300"> · {a.state}</span> : null}
                {a.country ? <span className="text-amber-600 dark:text-amber-400"> · {a.country}</span> : null}
              </li>
            ))}
          </ul>
          <div className="text-xs text-amber-700 dark:text-amber-300 mt-2">
            You can still save if this is a different company — but please check first to avoid splitting their data.
          </div>
        </div>
      )}
      {/* Soft duplicates — same name but explicitly different state.
          Rendered in calm blue so the rep doesn't feel blocked; this
          is purely informational ("there's a Visser Dairy in WI, but
          you're entering IA — heads up, not a problem"). */}
      {softDupes.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 text-sm">
          <div className="font-medium text-blue-900 dark:text-blue-200 mb-1">
            ℹ️ Same name in another state — likely a different farm
          </div>
          <ul className="text-blue-900 dark:text-blue-100 space-y-1">
            {softDupes.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/accounts/${a.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-blue-700 dark:hover:text-blue-300"
                >
                  {a.name}
                </Link>
                {a.industry ? <span className="text-blue-700 dark:text-blue-300"> · {a.industry}</span> : null}
                {a.state ? <span className="text-blue-700 dark:text-blue-300"> · {a.state}</span> : null}
              </li>
            ))}
          </ul>
          <div className="text-xs text-blue-700 dark:text-blue-300 mt-2">
            Fine to proceed — just confirming this isn&apos;t the same farm.
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Account Name *</label>
          <input type="text" value={name} onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
            placeholder="e.g. Tyson Foods" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 ${errors.name ? 'border-red-400' : 'border-gray-300 dark:border-slate-600'}`} />
          {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Species / Industry</label>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select species...</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Sales Owner</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select owner...</option>
            {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Country</label>
          <CountrySelect value={country} onChange={setCountry} />
        </div>
      </div>

      {/* Company Address — single source of truth for the account's
          physical/operational location. Uses existing columns: street
          → physical_street, city → location, state → state, zip →
          physical_zip. Same fieldset shape as Billing / Shipping
          below so the form reads consistently. */}
      <fieldset className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
        <legend className="px-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Company Address</legend>
        <input type="text" value={physicalStreet} onChange={(e) => setPhysicalStreet(e.target.value)} placeholder="Street"
          className="w-full mb-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        <div className="grid grid-cols-3 gap-2">
          <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City"
            className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          {country === 'USA' || !country ? (
            <select value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">ST</option>
              {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}
            </select>
          ) : (
            <input type="text" value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="State"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          )}
          <input type="text" value={physicalZip} onChange={(e) => setPhysicalZip(e.target.value)} placeholder="ZIP"
            className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </fieldset>

      {/* Billing + Shipping addresses. Two side-by-side fieldsets so
          the rep can see the difference at a glance. Re-added after
          an earlier truncated commit dropped the JSX — state/save
          handlers were intact but the form had no inputs to populate
          them, so the data never reached the DB. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <fieldset className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <legend className="px-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Billing Address</legend>
          <input type="text" value={billingStreet} onChange={(e) => setBillingStreet(e.target.value)} placeholder="Street"
            className="w-full mb-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={billingCity} onChange={(e) => setBillingCity(e.target.value)} placeholder="City"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="text" value={billingState} onChange={(e) => setBillingState(e.target.value)} placeholder="ST"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="text" value={billingZip} onChange={(e) => setBillingZip(e.target.value)} placeholder="ZIP"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </fieldset>
        <fieldset className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
          <legend className="px-1 text-sm font-semibold text-gray-700 dark:text-gray-200">Shipping Address</legend>
          <input type="text" value={shippingStreet} onChange={(e) => setShippingStreet(e.target.value)} placeholder="Street"
            className="w-full mb-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          <div className="grid grid-cols-3 gap-2">
            <input type="text" value={shippingCity} onChange={(e) => setShippingCity(e.target.value)} placeholder="City"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="text" value={shippingState} onChange={(e) => setShippingState(e.target.value)} placeholder="ST"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            <input type="text" value={shippingZip} onChange={(e) => setShippingZip(e.target.value)} placeholder="ZIP"
              className="col-span-1 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
        </fieldset>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Telephone</label>
        <input type="text" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="814-466-3366"
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Employee Count</label>
        <input type="number" value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="e.g. 100" min={0}
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Website</label>
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com"
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Integration Account toggle */}
      <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${isIntegration ? 'border-blue-300 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/40' : 'border-gray-200 hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800/60'}`}>
        <input
          type="checkbox"
          checked={isIntegration}
          onChange={(e) => {
            setIsIntegration(e.target.checked);
            if (!e.target.checked) setParentAccountId('');
          }}
          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-100">Integration Account</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">{isIntegration ? 'Linked under a parent account (HQ, holding, integrator, etc.)' : 'Mark as part of a parent-child / integration hierarchy'}</p>
        </div>
        <span className={`text-xs font-medium ${isIntegration ? 'text-blue-700 dark:text-blue-300' : 'text-gray-400 dark:text-gray-500'}`}>{isIntegration ? 'Integration' : 'Standalone'}</span>
      </label>

      {isIntegration && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Parent Account <span className="text-gray-400 dark:text-gray-500 text-xs">(required when Integration is ON)</span></label>
          <AccountParentSelector
            value={parentAccountId}
            onChange={setParentAccountId}
            excludeAccountId={initialData?.id}
            placeholder="Search to link as a child of another account..."
          />
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Use for headquarters → branch / parent company → subsidiary relationships</p>
        </div>
      )}



      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Notes / Summary</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Background, key relationships, recent updates, strategic context..."
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <SubmitButton type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </SubmitButton>
        <SubmitButton type="submit" disabled={submitting} pending={submitting} pendingText={mode === 'new' ? 'Creating...' : 'Saving...'}>
          {mode === 'new' ? 'Create Account' : 'Save Changes'}
        </SubmitButton>
      </div>
    </form>
  );
}
