'use client';

import { Account } from '@/lib/data';
import AccountForm from './AccountForm';
import { Modal } from './ui';

interface Props {
  account: Account;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * EditAccountModal — now uses the common Modal shell (app/components/ui).
 * ESC + backdrop + mobile safe-area + 100dvh cap come built in; the only
 * thing this component owns is the title and which form to render.
 */
export default function EditAccountModal({ account, onClose, onSaved }: Props) {
  return (
    <Modal onClose={onClose} size="lg">
      <Modal.Header title={`Edit Account — ${account.name}`} onClose={onClose} />
      <Modal.Body>
        <AccountForm mode="edit" initialData={account} onSave={() => { onSaved(); onClose(); }} onCancel={onClose} />
      </Modal.Body>
    </Modal>
  );
}
