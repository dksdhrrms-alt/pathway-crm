'use client';

import { useState } from 'react';
import { Opportunity, Stage } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import AccountSearchSelect from './AccountSearchSelect';

const STAGES: Stage[] = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const STAGE_PROB: Record<string, number> = { Prospecting: 10, Qualification: 25, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0 };

interface Props { opportunity: Opportunity; onClose: () => void; onSaved: () => void; }

export default function EditOpportunityModal({ opportunity, onClose, onSaved }: Props) {
  const { updateOpportunityStage, accounts } = useCRM();
  const { users } = useUsers();
  const activeUsers = users.filter((u) => u.status === 'active');

  const [name, setName] = useState(opportunity.name);
  const [accountId, setAccountId] = useState(opportunity.accountId || '');
  const [stage, setStage] = useState<Stage>(opportunity.stage);
  const [amount, setAmount] = useState(String(opportunity.amount || ''));
  const [closeDate, setCloseDate] = useState(opportunity.closeDate || '');
  const [probability, setProbability] = useState(opportunity.probability || 10);
  const [nextStep, setNextStep] = useState(opportunity.nextStep || '');
  const [competitor, setCompetitor] = useState(opportunity.competitor || '');
  const [ownerId, setOwnerId] = useState(opportunity.ownerId || '');
  const [error, setError] = useState('');

  const accountName = accounts.find((a) => a.id === accountId)?.name || '';

  function handleStageChange(s: Stage) { setStage(s); setProbability(STAGE_PROB[s] ?? probability); }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Name is required.'); return; }
    if (!closeDate) { setError('Close date is required.'); return; }

    const selectedUser = activeUsers.find((u) => u.id === ownerId);
    const updates: Partial<Opportunity> = {
      name: name.trim(), accountId, stage,
      amount: parseInt(String(amount).replace(/,/g, '')) || 0,
      closeDate, probability, nextStep: nextStep.trim(), competitor: competitor.trim(),
      ownerId, ownerName: selectedUser?.name,
    };

    // Use updateOpportunityStage for stage changes, and direct db update for everything else
    if (stage !== opportunity.stage) updateOpportunityStage(opportunity.id, stage);

    // Update all fields via db
    import('@/lib/db').then(({ dbUpdateOpportunity }) => {
      dbUpdateOpportunity(opportunity.id, updates).catch(console.error);
    });

    // Update local context
    const { useCRM: _ } = require('@/lib/CRMContext');
    void _;
    // The parent will handle context update via onSaved callback

    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Edit Opportunity</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opportunity Name *</label>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account</label>
            <AccountSearchSelect value={accountName} onChange={(_, id) => setAccountId(id)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
              <select value={stage} onChange={(e) => handleStageChange(e.target.value as Stage)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Probability (%)</label>
              <input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Close Date *</label>
              <input type="date" value={closeDate} onChange={(e) => { setCloseDate(e.target.value); setError(''); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Step</label>
            <input type="text" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="e.g. Send sample kit"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Competitor</label>
            <input type="text" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. Alltech, Zinpro, Novus"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">— Select owner —</option>
              {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">Cancel</button>
            <button type="submit" className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90" style={{ backgroundColor: '#1a4731' }}>Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  );
}
