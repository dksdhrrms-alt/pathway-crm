'use client';

import { Account } from '@/lib/data';
import AccountForm from './AccountForm';
import { useEscClose } from '@/lib/useEscClose';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditAccountModal({ account, onClose, onSaved }: Props) {
  // Esc closes the modal — backdrop-click dismiss was removed.
  useEscClose(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Edit Account — {account.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        {/* Auto-close on successful save — see NewAccountModal comment. */}
        <AccountForm mode="edit" initialData={account} onSave={() => { onSaved(); onClose(); }} onCancel={onClose} />
      </div>
    </div>
  );
}
