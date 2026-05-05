'use client';

import ContactForm from './ContactForm';

interface Props {
  defaultAccountId?: string;
  onClose: () => void;
  onSave: () => void;
}

export default function NewContactModal({ defaultAccountId, onClose, onSave }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">New Contact</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <ContactForm mode="new" initialData={defaultAccountId ? { accountId: defaultAccountId } : undefined} onSave={onSave} onCancel={onClose} />
      </div>
    </div>
  );
}
