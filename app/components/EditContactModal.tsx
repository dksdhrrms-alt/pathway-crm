'use client';

import { Contact } from '@/lib/data';
import ContactForm from './ContactForm';
import { Modal } from './ui';

interface Props {
  contact: Contact;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditContactModal({ contact, onClose, onSaved }: Props) {
  return (
    <Modal onClose={onClose} size="lg">
      <Modal.Header title={`Edit Contact — ${contact.firstName} ${contact.lastName}`} onClose={onClose} />
      <Modal.Body>
        <ContactForm mode="edit" initialData={contact} onSave={() => { onSaved(); onClose(); }} onCancel={onClose} />
      </Modal.Body>
    </Modal>
  );
}
