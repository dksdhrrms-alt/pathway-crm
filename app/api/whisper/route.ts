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

  // Force English transcription. On mobile, auto-detect occasionally misidentifies
  // an English-with-accent speaker as Korean and transcribes Korean text — passing
  // language=en + an English-domain prompt locks Whisper to English output.
  const openaiForm = new FormData();
  // Whisper accepts mp3/mp4/m4a/mpeg/mpga/wav/webm — MediaRecorder default is webm
  openaiForm.append('file', audio, 'audio.webm');
  openaiForm.append('model', 'whisper-1');
  openaiForm.append('language', 'en');
  // The `prompt` field biases Whisper toward this vocabulary/style. Helps with
  // proper nouns, industry jargon, and reinforces English context.
  openaiForm.append(
    'prompt',
    'This is a sales activity note for Pathway Intermediates USA, a livestock feed additive distributor serving poultry, swine, dairy, and beef customers across North and Latin America. Notes describe customer calls, meetings, follow-ups, samples, trials, pricing discussions, and integrator relationships. Common terms: Tyson, Pilgrim\'s, Cargill, JBS, Smithfield, integrator, complex, feed mill, nutritionist, broiler, layer, swine, ruminant.'
  );
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
