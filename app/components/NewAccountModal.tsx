'use client';

import AccountForm from './AccountForm';
import { Modal } from './ui';

interface Props {
  onClose: () => void;
  onSave: () => void;
}

/**
 * NewAccountModal — now uses the common Modal shell. Auto-closes
 * on successful save (gives the rep visual confirmation that the
 * save worked, instead of leaving the modal sitting open).
 */
export default function NewAccountModal({ onClose, onSave }: Props) {
  return (
    <Modal onClose={onClose} size="lg">
      <Modal.Header title="New Account" onClose={onClose} />
      <Modal.Body>
        <AccountForm mode="new" onSave={() => { onSave(); onClose(); }} onCancel={onClose} />
      </Modal.Body>
    </Modal>
  );
}
