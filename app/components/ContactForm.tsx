'use client';

import { useState } from 'react';
import { Contact, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import CountrySelect from './CountrySelect';
import AccountSearchSelect from './AccountSearchSelect';

const SPECIES_LIST = [
  'Primary Breeder', 'Broilers', 'Turkeys', 'Layers', 'Ruminant',
  'Swines', 'Aquaculture', 'Consulting Nutritionist', 'Industry Contact',
  'Multi', 'Research / Trials', 'University', 'Other',
];

interface Props {
  initialData?: Partial<Contact>;
  onSave: () => void;
  onCancel: () => void;
  mode: 'new' | 'edit';
}

export default function ContactForm({ initialData, onSave, onCancel, mode }: Props) {
  const { accounts, addContact, updateContact, addActivity } = useCRM();
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
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selectedAccount = accounts.find((a) => a.id === accountId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!firstName.trim()) errs.firstName = 'First name is required.';
    if (!lastName.trim()) errs.lastName = 'Last name is required.';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

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
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">First Name *</label>
          <input type="text" value={firstName} onChange={(e) => { setFirstName(e.target.value); setErrors((p) => ({ ...p, firstName: '' })); }}
            placeholder="First name" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errors.firstName ? 'border-red-400' : 'border-gray-300'}`} />
          {errors.firstName && <p className="text-xs text-red-600 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Last Name *</label>
          <input type="text" value={lastName} onChange={(e) => { setLastName(e.target.value); setErrors((p) => ({ ...p, lastName: '' })); }}
            placeholder="Last name" className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 ${errors.lastName ? 'border-red-400' : 'border-gray-300'}`} />
          {errors.lastName && <p className="text-xs text-red-600 mt-1">{errors.lastName}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Species</label>
          <select value={species} onChange={(e) => setSpecies(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
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
          <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
          <CountrySelect value={country} onChange={setCountry} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Owner (Sales Rep)</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="">Select owner...</option>
            {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
              <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Position / Title</label>
        <input type="text" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Director of Procurement"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      {/* Key Man toggle */}
      <label className={`flex items-center gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${isKeyMan ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 hover:bg-gray-50'}`}>
        <input type="checkbox" checked={isKeyMan} onChange={(e) => setIsKeyMan(e.target.checked)} className="hidden" />
        <span className="text-xl">{isKeyMan ? '★' : '☆'}</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-800">Key Contact</p>
          <p className="text-xs text-gray-500">{isKeyMan ? 'Marked as key contact' : 'Mark as key contact'}</p>
        </div>
        <span className={`text-xs font-medium ${isKeyMan ? 'text-amber-700' : 'text-gray-400'}`}>{isKeyMan ? 'Key Man ★' : 'Not key'}</span>
      </label>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Cell Phone</label>
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+1 (555) 000-0000"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tel (office)</label>
          <input type="text" value={tel} onChange={(e) => setTel(e.target.value)} placeholder="Office telephone"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Birthday</label>
          <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Anniversary</label>
          <input type="date" value={anniversary} onChange={(e) => setAnniversary(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
        <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>
          {mode === 'new' ? 'Create Contact' : 'Save Changes'}
        </button>
      </div>
    </form>
  );
}
