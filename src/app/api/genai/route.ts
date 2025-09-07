import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

export const runtime = 'node';

// POST /api/genai
// Body: { prompt: string, images?: [{ data: string, mimeType?: string }], model?: string }
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server misconfigured: GEMINI_API_KEY missing' }), { status: 500 });
    }
    let body: any;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }
    const { prompt, images = [], model = 'gemini-2.5-flash-image-preview' } = body || {};
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400 });
    }
    if (!Array.isArray(images)) {
      return new Response(JSON.stringify({ error: 'images must be an array' }), { status: 400 });
    }
    if (images.length > 6) {
      return new Response(JSON.stringify({ error: 'Too many images (max 6)' }), { status: 400 });
    }
    for (const img of images) {
      if (!img || typeof img.data !== 'string') {
        return new Response(JSON.stringify({ error: 'Each image requires base64 data' }), { status: 400 });
      }
      const approx = Math.floor(img.data.length * 0.75);
      if (approx > 8 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Image too large (>8MB)' }), { status: 400 });
      }
    }
    const ai = new GoogleGenAI({ apiKey });
    const contents: any[] = [ { text: prompt }, ...images.map(im => ({ inlineData: { mimeType: im.mimeType || 'image/png', data: im.data } })) ];
    const started = Date.now();
    const response = await ai.models.generateContent({ model, contents });
    const durationMs = Date.now() - started;
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p: any) => p?.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      return new Response(JSON.stringify({ error: 'No image returned', raw: response }), { status: 502 });
    }
    return new Response(JSON.stringify({ imageB64: imgPart.inlineData.data, meta: { model, durationMs } }), { status: 200 });
  } catch (e) {
    console.error('[api/genai] error', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
