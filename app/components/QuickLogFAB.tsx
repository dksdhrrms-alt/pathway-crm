'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import QuickLogModal from './QuickLogModal';
import type { ActivityType } from '@/lib/data';

export default function QuickLogFAB({ initialType }: { initialType?: ActivityType }) {
  const { data: session } = useSession();
  const [isOpen, setIsOpen] = useState(!!initialType);

  if (!session) return null;

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: '32px',
          right: '32px',
          zIndex: 9999,
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: '#1a4731',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '28px',
          fontWeight: '300',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(26,71,49,0.5)',
        }}
        title="Quick Log Activity"
      >
        +
      </button>

      {/* Modal */}
      {isOpen && (
        <QuickLogModal
          onClose={() => setIsOpen(false)}
          initialType={initialType}
        />
      )}
    </>
  );
}
