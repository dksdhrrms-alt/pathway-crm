'use client';

import React, { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { Opportunity, Stage, generateId } from '@/lib/data';
import { useCRM } from '@/lib/CRMContext';
import { useUsers } from '@/lib/UserContext';

interface NewOpportunityModalProps {
  defaultAccountId?: string;
  defaultStage?: Stage;
  onClose: () => void;
  onSave: (opportunity: Opportunity) => void;
}

const STAGES: Stage[] = ['Prospecting', 'Qualification', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];

const DEFAULT_PROBABILITY: Record<Stage, number> = {
  Prospecting: 10,
  Qualification: 20,
  Proposal: 40,
  Negotiation: 60,
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
  const initialStage = defaultStage || 'Prospecting';
  const [stage, setStage] = useState<Stage>(initialStage);
  const [amount, setAmount] = useState('');
  const [closeDate, setCloseDate] = useState('2026-06-30');
  const [probability, setProbability] = useState(DEFAULT_PROBABILITY[initialStage]);
  const [ownerId, setOwnerId] = useState(userId);
  const [nextStep, setNextStep] = useState('');
  const [competitor, setCompetitor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

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
    if (!validate()) return;

    const today = new Date().toISOString().split('T')[0];
    const newOpp: Opportunity = {
      id: generateId(),
      name: name.trim(),
      accountId,
      stage,
      amount: amount ? parseInt(amount.replace(/,/g, ''), 10) : 0,
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">New Opportunity</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Opportunity Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: '' })); }}
              placeholder="e.g. Q3 Feed Additive Package"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Account <span className="text-red-500">*</span>
            </label>
            <select
              value={accountId}
              onChange={(e) => { setAccountId(e.target.value); setErrors((p) => ({ ...p, accountId: '' })); }}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Stage</label>
              <select
                value={stage}
                onChange={(e) => handleStageChange(e.target.value as Stage)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 50000"
                min={0}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Close Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={closeDate}
                onChange={(e) => { setCloseDate(e.target.value); setErrors((p) => ({ ...p, closeDate: '' })); }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              {errors.closeDate && <p className="text-xs text-red-600 mt-1">{errors.closeDate}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Probability (%)</label>
              <input
                type="number"
                value={probability}
                onChange={(e) => setProbability(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))}
                min={0}
                max={100}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>

          {isAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Owner</label>
              <select
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                {allUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Step</label>
            <input
              type="text"
              value={nextStep}
              onChange={(e) => setNextStep(e.target.value)}
              placeholder="e.g. Send proposal by Friday"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Competitor</label>
            <input type="text" value={competitor} onChange={(e) => setCompetitor(e.target.value)} placeholder="e.g. Alltech, Zinpro, Novus"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
              style={{ backgroundColor: '#1a4731' }}
            >
              Create Opportunity
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
