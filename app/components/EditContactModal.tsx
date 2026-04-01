'use client';

import { Contact } from '@/lib/data';
import ContactForm from './ContactForm';

interface Props {
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditContactModal({ contact, onClose, onSaved }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Edit Contact — {contact.firstName} {contact.lastName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <ContactForm mode="edit" initialData={contact} onSave={onSaved} onCancel={onClose} />
      </div>
    </div>
  );
}
