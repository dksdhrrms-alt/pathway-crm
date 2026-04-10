'use client';

export default function OfflinePage() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: '20px' }}>
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <div style={{ fontSize: '64px', marginBottom: '16px' }}>📡</div>
        <h1 style={{ fontSize: '24px', fontWeight: 600, color: '#1a4731', margin: '0 0 8px' }}>You are offline</h1>
        <p style={{ fontSize: '14px', color: '#888', margin: '0 0 24px', lineHeight: 1.6 }}>
          It looks like you lost your internet connection. Please check your network and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '10px 24px', borderRadius: '8px', border: 'none',
            background: '#1a4731', color: 'white', fontSize: '14px',
            fontWeight: 500, cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
