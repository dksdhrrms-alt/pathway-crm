import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: 'Please log in to scan business cards.' }, { status: 401 });

  try {
    const body = await request.json();
    const { image } = body;
    if (!image) return Response.json({ error: 'No image provided. Please take a photo or upload an image.' }, { status: 400 });

    // Validate base64 size (rough check — 5MB base64 ~ 3.7MB image)
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    if (base64Data.length > 7 * 1024 * 1024) {
      return Response.json({ error: 'Image too large after encoding. Please use a smaller or lower-resolution image.' }, { status: 413 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey || apiKey.includes('placeholder')) {
      return Response.json({ error: 'AI service not configured. Please contact your administrator.' }, { status: 500 });
    }

    // Detect media type from data URL
    const mediaMatch = image.match(/^data:(image\/\w+);base64,/);
    const mediaType = mediaMatch ? mediaMatch[1] : 'image/jpeg';

    console.log(`[SCAN] Processing card scan, image size: ${Math.round(base64Data.length / 1024)}KB, type: ${mediaType}`);

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
              source: { type: 'base64', media_type: mediaType, data: base64Data },
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
      const errText = await res.text();
      console.error(`[SCAN] Claude API error (${res.status}):`, errText);
      if (res.status === 429) return Response.json({ error: 'AI service rate limited. Please wait a moment and try again.' }, { status: 429 });
      if (res.status === 400) return Response.json({ error: 'Image format not supported or corrupted. Try taking a new photo.' }, { status: 400 });
      return Response.json({ error: `AI service error (${res.status}). Please try again later.` }, { status: 500 });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '{}';
    const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

    console.log('[SCAN] Extracted text:', clean.substring(0, 200));

    try {
      const contact = JSON.parse(clean);
      return Response.json({ success: true, contact });
    } catch {
      console.error('[SCAN] Failed to parse JSON:', clean);
      return Response.json({ error: 'Could not parse card data. The image may not contain a business card.' }, { status: 422 });
    }
  } catch (err) {
    console.error('[SCAN] Error:', err);
    return Response.json({ error: 'An unexpected error occurred. Please try again.' }, { status: 500 });
  }
}
