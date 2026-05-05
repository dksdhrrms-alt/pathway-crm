'use client';

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Opportunity, Stage, generateId, annualizedRevenue } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';
import SubmitButton from './SubmitButton';

interface NewOpportunityModalProps {
  defaultAccountId?: string;
  defaultStage?: Stage;
  onClose: () => void;
  onSave: (opportunity: Opportunity) => void;
}

const STAGES: Stage[] = ['Prospect', 'Qualified', 'Trial Started', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

const DEFAULT_PROBABILITY: Record<Stage, number> = {
  Prospect: 5,
  Prospecting: 10,
  Qualified: 20,
  Qualification: 25,
  'Trial Started': 40,
  Proposal: 50,
  Negotiation: 75,
  'Closed Won': 100,
  'Closed Lost': 0,
};

export default function NewOpportunityModal({ defaultAccountId = '', defaultStage, onClose, onSave }: NewOpportunityModalProps) {
  const { data: session } = useSession();
  const { accounts: allAccounts, addOpportunity } = useCRM();

  const userId = session?.user?.id ?? '';
  const isAdmin = ['administrative_manager','admin','ceo','sales_director','coo'].includes(session?.user?.role ?? '');
  const accounts = allAccounts; // All users see all accounts

  const { users: allUsers } = useUsers();

  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState(defaultAccountId);
  const initialStage = defaultStage || 'Prospect';
  const [stage, setStage] = useState<Stage>(initialStage);
  const [amount, setAmount] = useState('');
  const [expectedStartDate, setExpectedStartDate] = useState('');
  const [closeDate, setCloseDate] = useState('2026-06-30');
  const [probability, setProbability] = useState(DEFAULT_PROBABILITY[initialStage]);
  const [ownerId, setOwnerId] = useState(userId);
  const [nextStep, setNextStep] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Guards against double-submit (button still visible during the brief
  // window between click and the parent closing the modal via onSave).
  const [submitting, setSubmitting] = useState(false);

  function handleStageChange(newStage: Stage) {
    setStage(newStage);
    setProbability(DEFAULT_PROBABILITY[newStage]);
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Opportunity name is required.';
    if (!accountId) errs.accountId = 'Account is required.';
    if (!closeDate) errs.closeDate = 'Close date is required.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (!validate()) return;

    setSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const newOpp: Opportunity = {
        id: generateId(),
        name: name.trim(),
        accountId,
        stage,
        amount: amount ? parseInt(amount.replace(/,/g, ''), 10) : 0,
        expectedStartDate: expectedStartDate || undefined,
        closeDate,
        probability,
        ownerId,
        nextStep: nextStep.trim() || undefined,
        competitor: competitor.trim() || undefined,
        createdDate: today,
        contactIds: [],
      };

      addOpportunity(newOpp);
      onSave(newOpp);
      onClose();
    } catch (err) {
      console.error('NewOpportunityModal submit failed:', err);
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      tabIndex={-1}
    >
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Opportunity</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Opportunity Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
              placeholder="e.g. Q3 Feed Additive Package"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
              Account <span className="text-red-500">*</span>
            </label>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setErrors((p) => ({ ...p, accountId: '' })); }}
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">— Select Account —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {errors.accountId && <p className="text-xs text-red-600 mt-1">{errors.accountId}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Stage</label>
              <select
                value={stage}
                onChange={(e) => handleStageChange(e.target.value as Stage)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Amount ($ / month)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50000"
                min={0}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Expected Start Date</label>
              <input
                type="date"
                value={expectedStartDate}
                onChange={(e) => setExpectedStartDate(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">When monthly revenue begins</p>
            </div>
            {(() => {
              const monthly = parseInt((amount || '0').replace(/,/g, ''), 10) || 0;
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                Close Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={closeDate}
                onChange={(e) => { setCloseDate(e.target.value); setErrors((p) => ({ ...p, closeDate: '' })); }}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              {errors.closeDate && <p className="text-xs text-red-600 mt-1">{errors.closeDate}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Probability (%)</label>
              <input
                type="number"
                value={probability}
                onChange={(e) => setProbability(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                min={0}
                max={100}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Owner</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Next Step</label>
            <input
              type="text"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="e.g. Send proposal by Friday"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Competitor</label>
            <input type="text" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. Alltech, Zinpro, Novus"
              className="w-full border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100 dark:placeholder-gray-500 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={submitting}>
              Cancel
            </SubmitButton>
            <SubmitButton type="submit" pending={submitting} pendingText="Creating...">
              Create Opportunity
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
