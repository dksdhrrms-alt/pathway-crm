'use client';

import { useState, useEffect } from 'react';
import { Account, generateId, US_STATES } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import CountrySelect from './CountrySelect';
import AccountParentSelector from './AccountParentSelector';
import SubmitButton from './SubmitButton';

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
  const { addAccount, updateAccount, addActivity } = useCRM();
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
      // Re-enable the button so the user can retry instead of being stuck
      // on a forever-disabled "Saving..." state.
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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

      <div className="grid grid-cols-2 gap-4">
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
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Telephone</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000"
            className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
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

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Address</label>
        <textarea value={location} onChange={(e) => setLocation(e.target.value)} rows={2} placeholder="Full address..."
          className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
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
        <SubmitButton type="submit" pending={submitting} pendingText={mode === 'new' ? 'Creating...' : 'Saving...'}>
          {mode === 'new' ? 'Create Account' : 'Save Changes'}
        </SubmitButton>
      </div>
    </form>
  );
}
