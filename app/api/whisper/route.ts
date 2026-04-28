import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy to OpenAI Whisper. The browser sends an audio blob via
// FormData; we forward it to api.openai.com and return the transcript.
// Required env: OPENAI_API_KEY
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'OPENAI_API_KEY not configured on the server' }, { status: 500 });
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const audio = incoming.get('audio');
  if (!audio || !(audio instanceof Blob)) {
    return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
  }

  // Optional language hint ("en", "ko", or omit for auto-detect)
  const language = (incoming.get('language') as string | null) || '';

  const openaiForm = new FormData();
  // Whisper accepts mp3/mp4/m4a/mpeg/mpga/wav/webm — MediaRecorder default is webm
  openaiForm.append('file', audio, 'audio.webm');
  openaiForm.append('model', 'whisper-1');
  if (language && language !== 'auto') openaiForm.append('language', language);
  openaiForm.append('response_format', 'json');

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openaiForm,
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('[Whisper] OpenAI error:', res.status, errText);
      return NextResponse.json({ error: `Whisper API error: ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({ text: data.text || '' });
  } catch (err) {
    console.error('[Whisper] Network error:', err);
    return NextResponse.json({ error: 'Failed to reach OpenAI' }, { status: 502 });
  }
}
