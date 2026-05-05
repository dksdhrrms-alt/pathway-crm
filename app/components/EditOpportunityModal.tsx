'use client';

import { useState } from 'react';
import { Opportunity, Stage, annualizedRevenue } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import { getRoleLabel } from '@/lib/users';
import AccountSearchSelect from './AccountSearchSelect';
import SubmitButton from './SubmitButton';

const STAGES: Stage[] = ['Prospect', 'Qualified', 'Trial Started', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
const STAGE_PROB: Record<string, number> = { Prospect: 5, Prospecting: 10, Qualified: 20, Qualification: 25, 'Trial Started': 40, Proposal: 50, Negotiation: 75, 'Closed Won': 100, 'Closed Lost': 0 };

interface Props { opportunity: Opportunity; onClose: () => void; onSaved: () => void; }

export default function EditOpportunityModal({ opportunity, onClose, onSaved }: Props) {
  const { updateOpportunityStage, accounts } = useCRM();
  const { users } = useUsers();
  const activeUsers = users.filter((u) => u.status === 'active');

  const [name, setName] = useState(opportunity.name);
  const [accountId, setAccountId] = useState(opportunity.accountId || '');
  const [stage, setStage] = useState<Stage>(opportunity.stage);
  const [amount, setAmount] = useState(String(opportunity.amount || ''));
  const [expectedStartDate, setExpectedStartDate] = useState(opportunity.expectedStartDate || '');
  const [closeDate, setCloseDate] = useState(opportunity.closeDate || '');
  const [probability, setProbability] = useState(opportunity.probability || 10);
  const [nextStep, setNextStep] = useState(opportunity.nextStep || '');
  const [competitor, setCompetitor] = useState(opportunity.competitor || '');
  const [ownerId, setOwnerId] = useState(opportunity.ownerId || '');
  const [error, setError] = useState('');
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSaved).
  const [submitting, setSubmitting] = useState(false);

  const accountName = accounts.find((a) => a.id === accountId)?.name || '';

  function handleStageChange(s: Stage) { setStage(s); setProbability(STAGE_PROB[s] ?? probability); }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!name.trim()) { setError('Name is required.'); return; }
    if (!closeDate) { setError('Close date is required.'); return; }

    setSubmitting(true);
    try {
      const selectedUser = activeUsers.find((u) => u.id === ownerId);
      const updates: Partial<Opportunity> = {
        name: name.trim(), accountId, stage,
        amount: parseInt(String(amount).replace(/,/g, '')) || 0,
        expectedStartDate: expectedStartDate || undefined,
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
    } catch (err) {
      console.error('EditOpportunityModal save failed:', err);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Opportunity</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Opportunity Name *</label>
            <input type="text" value={name} onChange={(e) => { setName(e.target.value); setError(''); }}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Account</label>
            <AccountSearchSelect value={accountName} onChange={(_, id) => setAccountId(id)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Stage</label>
              <select value={stage} onChange={(e) => handleStageChange(e.target.value as Stage)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                {!STAGES.includes(stage) && <option value={stage}>{stage} (legacy)</option>}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Probability (%)</label>
              <input type="number" min={0} max={100} value={probability} onChange={(e) => setProbability(Number(e.target.value))}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Amount ($ / month)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Close Date *</label>
              <input type="date" value={closeDate} onChange={(e) => { setCloseDate(e.target.value); setError(''); }}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Expected Start Date</label>
              <input type="date" value={expectedStartDate} onChange={(e) => setExpectedStartDate(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">When monthly revenue begins</p>
            </div>
            {(() => {
              const monthly = parseInt(String(amount).replace(/,/g, '')) || 0;
              const yr = new Date().getFullYear();
              const thisYr = annualizedRevenue(monthly, expectedStartDate, yr);
              const nextYr = annualizedRevenue(monthly, expectedStartDate, yr + 1);
              const fmt = (n: number) => '$' + n.toLocaleString('en-US');
              return (
                <div className="bg-green-50 dark:bg-green-950/40 border border-green-100 dark:border-green-800 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-green-800 dark:text-green-300 uppercase tracking-wide mb-1.5">Annualized Revenue</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">{yr}:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{fmt(thisYr)}</span>
                  </div>
                  <div className="flex justify-between text-sm mt-0.5">
                    <span className="text-gray-600 dark:text-gray-400">{yr + 1}:</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{fmt(nextYr)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Next Step</label>
            <input type="text" value={nextStep} onChange={(e) => setNextStep(e.target.value)} placeholder="e.g. Send sample kit"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Competitor</label>
            <input type="text" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. Alltech, Zinpro, Novus"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Owner</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="">— Select owner —</option>
              {activeUsers.sort((a, b) => a.name.localeCompare(b.name)).map((u) => (
                <option key={u.id} value={u.id}>{u.name} — {getRoleLabel(u.role)}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</SubmitButton>
            <SubmitButton type="submit" pending={submitting} pendingText="Saving...">Save Changes</SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
