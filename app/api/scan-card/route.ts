import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { image } = await request.json();
    if (!image) return Response.json({ error: 'No image provided' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return Response.json({ error: 'API key not configured' }, { status: 500 });

    // Send to Claude Vision API
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: image.replace(/^data:image\/\w+;base64,/, '') },
            },
            {
              type: 'text',
              text: 'Extract contact information from this business card image. Return ONLY valid JSON with these fields (use empty string if not found): {"firstName":"","lastName":"","title":"","company":"","email":"","phone":"","mobile":"","address":"","website":"","linkedin":""}',
            },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[SCAN] Claude API error:', err);
      return Response.json({ error: 'Failed to process image' }, { status: 500 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    try {
      const contact = JSON.parse(clean);
      return Response.json({ success: true, contact });
    } catch {
      return Response.json({ success: true, contact: {}, rawText: text });
    }
  } catch (err) {
    console.error('[SCAN] Error:', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
