'use client';

import { useState } from 'react';
import SubmitButton from './SubmitButton';

interface Recipient {
  email: string;
  name: string;
  contactId: string;
}

interface SendEmailModalProps {
  recipients: Recipient[];
  onClose: () => void;
  onSent: (subject: string, body: string, recipients: Recipient[]) => void;
  singleRecipient?: boolean;
}

export default function SendEmailModal({ recipients, onClose, onSent, singleRecipient = true }: SendEmailModalProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const toLabel = singleRecipient
    ? recipients[0]?.email ?? ''
    : `${recipients.length} contacts selected`;

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;

    if (!subject.trim()) { setError('Subject is required.'); return; }
    if (!body.trim()) { setError('Email body is required.'); return; }

    setSending(true);
    try {
      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients.map((r) => r.email),
          subject: subject.trim(),
          body: body.trim(),
          fromName: 'Pathway CRM',
          contactName: singleRecipient ? recipients[0]?.name : `${recipients.length} contacts`,
        }),
      });
      const data = await res.json();
      if (!data.ok && !data.mock) {
        setError(data.message || 'Failed to send.');
        setSending(false);
        return;
      }
      onSent(subject.trim(), body.trim(), recipients);
      onClose();
    } catch {
      setError('Network error. Please try again.');
      setSending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Send Email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
            <input
              type="text"
              value={toLabel}
              readOnly
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject *</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => { setSubject(e.target.value); setError(''); }}
              placeholder="Email subject"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body *</label>
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); setError(''); }}
              placeholder="Write your email..."
              rows={5}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
              style={{ minHeight: '120px' }}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <SubmitButton type="button" variant="secondary" onClick={onClose} disabled={sending}>
              Cancel
            </SubmitButton>
            <SubmitButton type="submit" pending={sending} pendingText="Sending...">
              Send Email
            </SubmitButton>
          </div>
        </form>
      </div>
    </div>
  );
}
