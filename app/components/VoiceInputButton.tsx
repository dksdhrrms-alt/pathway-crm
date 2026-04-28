'use client';

import { useState, useRef, useEffect } from 'react';

interface Props {
  onTranscript: (text: string) => void;          // called with the transcribed text
  language?: 'en' | 'ko' | 'auto';               // hint to Whisper
  size?: 'sm' | 'md';
  title?: string;
}

export default function VoiceInputButton({ onTranscript, language = 'auto', size = 'md', title = 'Voice input' }: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'processing' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop(); } catch { /* */ }
      }
    };
  }, []);

  async function start() {
    setErrorMsg('');
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setErrorMsg('Microphone not supported in this browser');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        // release mic
        stream.getTracks().forEach((t) => t.stop());
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        if (blob.size === 0) { setState('idle'); return; }
        await transcribe(blob);
      };

      recorder.start();
      setState('recording');
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (err) {
      console.error('[VoiceInput] mic error:', err);
      setState('error');
      setErrorMsg('Microphone access denied');
    }
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setState('processing');
  }

  async function transcribe(blob: Blob) {
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'audio.webm');
      if (language !== 'auto') formData.append('language', language);
      const res = await fetch('/api/whisper', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.text) {
        setState('error');
        setErrorMsg(data.error || 'Transcription failed');
        setTimeout(() => setState('idle'), 2500);
        return;
      }
      onTranscript(String(data.text).trim());
      setState('idle');
    } catch (err) {
      console.error('[VoiceInput] transcribe error:', err);
      setState('error');
      setErrorMsg('Network error');
      setTimeout(() => setState('idle'), 2500);
    }
  }

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'idle' || state === 'error') start();
    else if (state === 'recording') stop();
  }

  const dim = size === 'sm' ? 28 : 36;
  const icon = (() => {
    if (state === 'recording') return '⏺';
    if (state === 'processing') return '⏳';
    if (state === 'error') return '⚠';
    return '🎤';
  })();
  const bg = state === 'recording' ? '#dc2626' : state === 'processing' ? '#f59e0b' : state === 'error' ? '#fee2e2' : 'white';
  const color = state === 'recording' || state === 'processing' ? 'white' : state === 'error' ? '#991b1b' : '#1a4731';
  const border = state === 'idle' ? '1px solid #e5e7eb' : state === 'error' ? '1px solid #fecaca' : 'none';

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'processing'}
      title={state === 'recording' ? `Recording… ${elapsed}s — click to stop` : state === 'processing' ? 'Transcribing…' : errorMsg || title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: '6px', padding: '0 10px',
        height: dim, minWidth: dim, borderRadius: '999px',
        border, background: bg, color,
        cursor: state === 'processing' ? 'default' : 'pointer',
        fontSize: size === 'sm' ? '12px' : '13px',
        fontWeight: 500, transition: 'all 0.15s',
        boxShadow: state === 'recording' ? '0 0 0 4px rgba(220,38,38,0.15)' : 'none',
      }}
    >
      <span style={{ animation: state === 'recording' ? 'pulse 1s infinite' : 'none' }}>{icon}</span>
      {state === 'recording' && <span>{elapsed}s</span>}
      {state === 'processing' && <span>Transcribing…</span>}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </button>
  );
}
