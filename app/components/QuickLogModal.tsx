'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useCRM } from '@/lib/CRMContext';
import { generateId, ActivityType, ACTIVITY_PURPOSES } from '@/lib/data';

const ACTIVITY_TYPES: { id: ActivityType; emoji: string; label: string }[] = [
  { id: 'Call', emoji: '📞', label: 'Call' },
  { id: 'Meeting', emoji: '🤝', label: 'Meeting' },
  { id: 'Email', emoji: '📧', label: 'Email' },
  { id: 'Note', emoji: '📝', label: 'Note' },
];

interface Props {
  onClose: () => void;
  initialType?: ActivityType;
}

export default function QuickLogModal({ onClose, initialType }: Props) {
  const { data: session } = useSession();
  const { accounts, contacts, addActivity } = useCRM();

  const [type, setType] = useState<ActivityType>(initialType || 'Call');
  const [purpose, setPurpose] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  // Account search
  const [accountSearch, setAccountSearch] = useState('');
  const [accountId, setAccountId] = useState('');
  const [accountName, setAccountName] = useState('');
  const [showAccountDD, setShowAccountDD] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  // Contact search (multi-select)
  const [contactSearch, setContactSearch] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [showContactDD, setShowContactDD] = useState(false);
  const contactRef = useRef<HTMLDivElement>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setShowAccountDD(false);
      if (contactRef.current && !contactRef.current.contains(e.target as Node)) setShowContactDD(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredAccounts = accounts
    .filter((a) => a.name.toLowerCase().includes(accountSearch.toLowerCase()))
    .slice(0, 8);

  const filteredContacts = contacts
    .filter((c) => {
      if (selectedContactIds.has(c.id)) return false; // Skip already selected
      const name = `${c.firstName} ${c.lastName}`.toLowerCase();
      if (!name.includes(contactSearch.toLowerCase())) return false;
      if (accountId) return c.accountId === accountId;
      return true;
    })
    .slice(0, 8);

  const selectedContactObjs = contacts.filter((c) => selectedContactIds.has(c.id));

  function toggleContactSelect(id: string) {
    setSelectedContactIds((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function handleSave() {
    if (!subject.trim() || saving) return;
    setSaving(true);

    const ids = Array.from(selectedContactIds);
    const contactList: (string | undefined)[] = ids.length > 0 ? ids : [undefined];
    contactList.forEach((cid) => {
      addActivity({
        id: generateId(),
        type,
        subject: subject.trim(),
        description: description.trim(),
        date: new Date().toISOString().split('T')[0],
        ownerId: session?.user?.id || '',
        accountId: accountId || '',
        contactId: cid || '',
        purpose: purpose || undefined,
      });
    });

    setSaved(true);
    setTimeout(() => onClose(), 1200);
  }

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        zIndex: 10000, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '16px',
      }}
    >
      <div style={{ background: 'white', borderRadius: '16px', width: '100%', maxWidth: '440px', padding: '20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>Quick Log</h3>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#888' }}>
              {session?.user?.name} &middot; {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#888' }}>
            ✕
          </button>
        </div>

        {/* Type selector */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
          {ACTIVITY_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              style={{
                padding: '10px 4px', borderRadius: '10px',
                border: type === t.id ? '2px solid #1a4731' : '1px solid #e5e7eb',
                background: type === t.id ? '#f0f7ee' : 'white',
                cursor: 'pointer', display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: '4px',
              }}
            >
              <span style={{ fontSize: '20px' }}>{t.emoji}</span>
              <span style={{ fontSize: '11px', color: type === t.id ? '#1a4731' : '#666', fontWeight: type === t.id ? 500 : 400 }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>

        {/* Purpose */}
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          style={{
            width: '100%', padding: '10px 12px', fontSize: '13px',
            border: '1px solid #e5e7eb', borderRadius: '8px',
            marginBottom: '10px', boxSizing: 'border-box',
            background: 'white', cursor: 'pointer',
            color: purpose ? '#1f2937' : '#9ca3af',
          }}
        >
          <option value="">— Purpose (optional) —</option>
          {ACTIVITY_PURPOSES.map((p) => <option key={p} value={p} style={{ color: '#1f2937' }}>{p}</option>)}
        </select>

        {/* Subject */}
        <input
          autoFocus
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !showAccountDD && !showContactDD) handleSave();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Subject (required)"
          style={{
            width: '100%', padding: '10px 12px', fontSize: '14px',
            border: '1px solid #e5e7eb', borderRadius: '8px',
            marginBottom: '10px', boxSizing: 'border-box',
          }}
        />

        {/* Account Search */}
        <div ref={accountRef} style={{ position: 'relative', marginBottom: '10px' }}>
          <input
            type="text"
            value={accountSearch}
            onChange={(e) => { setAccountSearch(e.target.value); setAccountName(e.target.value); setAccountId(''); setShowAccountDD(true); }}
            onFocus={() => { if (accountSearch) setShowAccountDD(true); }}
            placeholder="Search account (optional)..."
            style={{
              width: '100%', padding: '10px 12px', paddingRight: accountName ? '32px' : '12px',
              fontSize: '14px',
              border: accountId ? '1.5px solid #1a4731' : '1px solid #e5e7eb',
              borderRadius: '8px', boxSizing: 'border-box',
              background: accountId ? '#f0f7ee' : 'white',
            }}
          />
          {accountName && (
            <button
              onClick={() => { setAccountSearch(''); setAccountName(''); setAccountId(''); setContactSearch(''); setSelectedContactIds(new Set()); }}
              style={{
                position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '18px',
              }}
            >
              ×
            </button>
          )}
          {showAccountDD && accountSearch && filteredAccounts.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
              background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 10001,
              maxHeight: '220px', overflowY: 'auto',
            }}>
              {filteredAccounts.map((a) => (
                <div
                  key={a.id}
                  onClick={() => { setAccountName(a.name); setAccountId(a.id); setAccountSearch(a.name); setShowAccountDD(false); setContactSearch(''); setSelectedContactIds(new Set()); }}
                  style={{
                    padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                    display: 'flex', alignItems: 'center', gap: '10px',
                    borderBottom: '0.5px solid #f3f4f6',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                >
                  <div style={{
                    width: '30px', height: '30px', borderRadius: '6px', background: '#1a4731',
                    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 600, flexShrink: 0,
                  }}>
                    {a.name.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500 }}>{a.name}</div>
                    {a.industry && <div style={{ fontSize: '11px', color: '#888' }}>{a.industry}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Contact Search (multi-select with tags) */}
        <div ref={contactRef} style={{ position: 'relative', marginBottom: '10px' }}>
          {/* Selected contact tags */}
          {selectedContactObjs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
              {selectedContactObjs.map((c) => (
                <span key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '12px', background: '#E1F5EE', color: '#0F6E56', fontSize: '12px', border: '1px solid #B5E3D2' }}>
                  {c.firstName} {c.lastName}
                  <button type="button" onClick={() => toggleContactSelect(c.id)} style={{ background: 'none', border: 'none', color: '#0F6E56', cursor: 'pointer', fontWeight: 700, padding: 0, marginLeft: '2px' }}>×</button>
                </span>
              ))}
            </div>
          )}
          <input
            type="text"
            value={contactSearch}
            onChange={(e) => { setContactSearch(e.target.value); setShowContactDD(true); }}
            onFocus={() => setShowContactDD(true)}
            placeholder={selectedContactObjs.length > 0 ? 'Add another contact...' : accountId ? `Search contact at ${accountName}...` : 'Search contact (optional)...'}
            style={{
              width: '100%', padding: '10px 12px', paddingRight: contactSearch ? '32px' : '12px',
              fontSize: '14px',
              border: selectedContactObjs.length > 0 ? '1.5px solid #1a4731' : '1px solid #e5e7eb',
              borderRadius: '8px', boxSizing: 'border-box',
              background: selectedContactObjs.length > 0 ? '#f0f7ee' : 'white',
            }}
          />
          {contactSearch && (
            <button
              onClick={() => setContactSearch('')}
              style={{
                position: 'absolute', right: '10px', top: selectedContactObjs.length > 0 ? 'auto' : '50%',
                bottom: selectedContactObjs.length > 0 ? '12px' : 'auto',
                transform: selectedContactObjs.length > 0 ? 'none' : 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', fontSize: '18px',
              }}
            >
              ×
            </button>
          )}
          {showContactDD && contactSearch && filteredContacts.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px',
              background: 'white', border: '1px solid #e5e7eb', borderRadius: '8px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 10001,
              maxHeight: '220px', overflowY: 'auto',
            }}>
              {filteredContacts.map((c) => {
                const fullName = `${c.firstName} ${c.lastName}`;
                const acctName = c.accountName || accounts.find((a) => a.id === c.accountId)?.name || '';
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      toggleContactSelect(c.id);
                      setContactSearch('');
                      if (!accountId && c.accountId) {
                        setAccountName(acctName);
                        setAccountId(c.accountId);
                        setAccountSearch(acctName);
                      }
                    }}
                    style={{
                      padding: '10px 14px', cursor: 'pointer', fontSize: '13px',
                      display: 'flex', alignItems: 'center', gap: '10px',
                      borderBottom: '0.5px solid #f3f4f6',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = '#f9fafb'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'white'; }}
                  >
                    <div style={{
                      width: '30px', height: '30px', borderRadius: '50%', background: '#185FA5',
                      color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: 600, flexShrink: 0,
                    }}>
                      {c.firstName?.[0]}{c.lastName?.[0]}
                    </div>
                    <div>
                      <div style={{ fontWeight: 500 }}>
                        {fullName}
                        {c.isKeyMan && <span style={{ color: '#f59e0b', marginLeft: '4px' }}>★</span>}
                      </div>
                      <div style={{ fontSize: '11px', color: '#888' }}>
                        {c.title ? `${c.title} · ` : ''}{acctName}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notes */}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes (optional)"
          rows={3}
          style={{
            width: '100%', padding: '10px 12px', fontSize: '13px',
            border: '1px solid #e5e7eb', borderRadius: '8px',
            marginBottom: '16px', resize: 'none', boxSizing: 'border-box',
            fontFamily: 'inherit',
          }}
        />

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px', borderRadius: '8px',
              border: '1px solid #e5e7eb', background: 'white',
              cursor: 'pointer', fontSize: '13px',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!subject.trim() || saving || saved}
            style={{
              padding: '8px 20px', borderRadius: '8px', border: 'none',
              background: saved ? '#1D9E75' : subject.trim() ? '#1a4731' : '#e5e7eb',
              color: subject.trim() || saved ? 'white' : '#aaa',
              cursor: subject.trim() ? 'pointer' : 'not-allowed',
              fontSize: '13px', fontWeight: 500,
            }}
          >
            {saved ? '✓ Logged!' : saving ? 'Saving...' : 'Log Activity'}
          </button>
        </div>
      </div>
    </div>
  );
}
