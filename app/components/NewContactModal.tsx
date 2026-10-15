'use client';

import ContactForm from './ContactForm';
import { Modal } from './ui';

interface Props {
  defaultAccountId?: string;
  onClose: () => void;
  onSave: () => void;
}

/**
 * NewContactModal — uses the common Modal shell. The wrapper auto-closes
 * on save so the rep gets visual confirmation (modal disappearing = it
 * worked); the ContactForm itself just signals via onSave.
 */
export default function NewContactModal({ defaultAccountId, onClose, onSave }: Props) {
  return (
    <Modal onClose={onClose} size="lg">
      <Modal.Header title="New Contact" onClose={onClose} />
      <Modal.Body>
        <ContactForm
          mode="new"
          initialData={defaultAccountId ? { accountId: defaultAccountId } : undefined}
          onSave={() => { onSave(); onClose(); }}
          onCancel={onClose}
        />
      </Modal.Body>
    </Modal>
  );
}
