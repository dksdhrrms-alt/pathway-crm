'use client';

import { useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCRM } from '@/lib/CRMContext';
import { generateId } from '@/lib/data';
import TopBar from '@/app/components/TopBar';

export default function ScanCardPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const { addContact, accounts } = useCRM();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [image, setImage] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function compressImage(dataUrl: string, maxWidth: number, quality: number): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round(h * (maxWidth / w)); w = maxWidth; }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });
  }

  function handleFile(file: File) {
    if (!file.type.startsWith('image/')) { setError('Please select an image file (JPG, PNG, HEIC)'); return; }
    if (file.size > 20 * 1024 * 1024) { setError('Image too large. Maximum 20MB.'); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
      const raw = e.target?.result as string;
      // Compress to max 1200px wide, 80% quality to stay under API limits
      const compressed = await compressImage(raw, 1200, 0.8);
      setImage(compressed);
      setResult(null);
      setError(null);
      setSaved(false);
    };
    reader.readAsDataURL(file);
  }

  async function handleScan() {
    if (!image) return;
    setScanning(true);
    setError(null);
    try {
      const res = await fetch('/api/scan-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }),
      });
      if (!res.ok) {
        const status = res.status;
        if (status === 401) { setError('Please log in to use card scanning.'); return; }
        if (status === 413) { setError('Image too large. Please use a smaller image.'); return; }
        if (status === 500) { setError('Server error. The AI service may be unavailable. Try again later.'); return; }
        setError(`Scan failed (error ${status}). Please try again.`);
        return;
      }
      const data = await res.json();
      if (data.success && data.contact) {
        const hasData = Object.values(data.contact).some((v) => v);
        if (!hasData) { setError('Could not read any text from the image. Try a clearer photo with good lighting.'); return; }
        setResult(data.contact);
      } else {
        setError(data.error || 'Failed to extract contact info. Try a different angle or lighting.');
      }
    } catch {
      setError('Network error. Check your connection and try again.');
    } finally {
      setScanning(false);
    }
  }

  function handleSaveContact() {
    if (!result) return;
    const matchedAccount = accounts.find((a) => a.name.toLowerCase() === (result.company || '').toLowerCase());
    addContact({
      id: generateId(),
      firstName: result.firstName || '',
      lastName: result.lastName || '',
      title: result.title || '',
      phone: result.phone || result.mobile || '',
      email: result.email || '',
      linkedIn: result.linkedin || '',
      accountId: matchedAccount?.id || '',
      accountName: result.company || '',
      ownerId: session?.user?.id || '',
      status: 'active',
    });
    setSaved(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopBar />
      <main className="pt-16 px-6 pb-10">
        <div className="max-w-lg mx-auto">
          <div className="mt-6 mb-6">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Scan Business Card</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Take a photo or upload an image to extract contact info</p>
          </div>

          {/* Upload area */}
          {!image && (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: 'white', border: '2px dashed #d1d5db', borderRadius: '16px',
                padding: '48px 24px', textAlign: 'center', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📷</div>
              <p style={{ fontSize: '15px', fontWeight: 500, color: '#374151' }}>Tap to take photo or upload</p>
              <p style={{ fontSize: '13px', color: '#9ca3af', marginTop: '4px' }}>Supports JPG, PNG, HEIC</p>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                onChange={(e) => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }} />
            </div>
          )}

          {/* Image preview */}
          {image && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ position: 'relative', borderRadius: '12px', overflow: 'hidden', border: '1px solid #e5e7eb' }}>
                <img src={image} alt="Business card" loading="lazy" decoding="async" style={{ width: '100%', display: 'block' }} />
                <button
                  onClick={() => { setImage(null); setResult(null); setSaved(false); }}
                  style={{
                    position: 'absolute', top: '8px', right: '8px', width: '28px', height: '28px',
                    borderRadius: '50%', background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none',
                    cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              </div>
              {!result && !scanning && (
                <button onClick={handleScan} style={{
                  marginTop: '12px', width: '100%', padding: '12px', borderRadius: '10px',
                  border: 'none', background: '#1a4731', color: 'white', fontSize: '14px',
                  fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px',
                }}>
                  Scan with AI
                </button>
              )}
              {scanning && (
                <div style={{ marginTop: '12px', textAlign: 'center', padding: '16px', color: '#888', fontSize: '14px' }}>
                  Scanning business card...
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '12px 16px', background: '#FCEBEB', borderRadius: '8px', color: '#A32D2D', fontSize: '13px', marginBottom: '16px' }}>
              {error}
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ background: 'white', borderRadius: '12px', border: '1px solid #e5e7eb', padding: '20px', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px', color: '#1a4731' }}>Extracted Information</h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                {[
                  { label: 'First Name', key: 'firstName' },
                  { label: 'Last Name', key: 'lastName' },
                  { label: 'Title', key: 'title' },
                  { label: 'Company', key: 'company' },
                  { label: 'Email', key: 'email' },
                  { label: 'Phone', key: 'phone' },
                  { label: 'Mobile', key: 'mobile' },
                  { label: 'Website', key: 'website' },
                ].filter((f) => result[f.key]).map((f) => (
                  <div key={f.key}>
                    <label style={{ fontSize: '11px', color: '#888', fontWeight: 500, display: 'block', marginBottom: '2px' }}>{f.label}</label>
                    <input
                      type="text"
                      value={result[f.key] || ''}
                      onChange={(e) => setResult({ ...result, [f.key]: e.target.value })}
                      style={{
                        width: '100%', padding: '8px 10px', fontSize: '14px',
                        border: '1px solid #e5e7eb', borderRadius: '6px', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                {saved ? (
                  <div style={{ flex: 1, padding: '12px', borderRadius: '8px', background: '#E1F5EE', color: '#0F6E56', textAlign: 'center', fontWeight: 500, fontSize: '14px' }}>
                    Contact saved!
                  </div>
                ) : (
                  <>
                    <button onClick={handleSaveContact} style={{
                      flex: 1, padding: '12px', borderRadius: '8px', border: 'none',
                      background: '#1a4731', color: 'white', fontSize: '14px', fontWeight: 500, cursor: 'pointer',
                    }}>
                      Save as Contact
                    </button>
                    <button onClick={() => { setImage(null); setResult(null); }} style={{
                      padding: '12px 20px', borderRadius: '8px', border: '1px solid #e5e7eb',
                      background: 'white', fontSize: '14px', cursor: 'pointer',
                    }}>
                      Scan Another
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
