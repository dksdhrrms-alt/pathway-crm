'use client';

import { useState } from 'react';
import { Account, generateId, US_STATES } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import CountrySelect from './CountrySelect';
import AccountParentSelector from './AccountParentSelector';

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
  const [parentAccountId, setParentAccountId] = useState(initialData?.parentAccountId || '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Account name is required.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

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
      parentAccountId: parentAccountId || undefined,
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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Account Name *</label>
          <input type="text" value={name} onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
            placeholder="e.g. Tyson Foods" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errors.name ? 'border-red-400' : 'border-gray-300'}`} />
          {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Species / Industry</label>
          <select value={industry} onChange={(e) => setIndustry(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select species...</option>
            {INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Sales Owner</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select owner...</option>
            {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <CountrySelect value={country} onChange={setCountry} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">State {country && country !== 'USA' && <span className="text-gray-400 text-xs">(US only)</span>}</label>
          {country === 'USA' || !country ? (
            <select value={stateVal} onChange={(e) => setStateVal(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">Select state...</option>
              {US_STATES.map((s) => <option key={s.code} value={s.code}>{s.name} ({s.code})</option>)}
            </select>
          ) : (
            <input type="text" value={stateVal} onChange={(e) => setStateVal(e.target.value)} placeholder="State / Province / Region"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Telephone</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Employee Count</label>
        <input type="number" value={employee} onChange={(e) => setEmployee(e.target.value)} placeholder="e.g. 100" min={0}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
        <input type="text" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://example.com"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
        <textarea value={location} onChange={(e) => setLocation(e.target.value)} rows={2} placeholder="Full address..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Parent Account <span className="text-gray-400 text-xs">(optional)</span></label>
        <AccountParentSelector
          value={parentAccountId}
          onChange={setParentAccountId}
          excludeAccountId={initialData?.id}
          placeholder="Search to link as a child of another account..."
        />
        <p className="text-[11px] text-gray-400 mt-1">Use for headquarters → branch / parent company → subsidiary relationships</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Summary</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} placeholder="Background, key relationships, recent updates, strategic context..."
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y" />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
        <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
          {mode === 'new' ? 'Create Account' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
