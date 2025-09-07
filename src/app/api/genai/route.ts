import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';

// Using default (Node) runtime; no explicit export to avoid Turbopack warning.

// POST /api/genai
// Body: { prompt: string, images?: [{ data: string, mimeType?: string }], model?: string }
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Server misconfigured: GEMINI_API_KEY missing' }), { status: 500 });
    }
    interface IncomingImage { data: string; mimeType?: string }
    interface IncomingBody { prompt?: unknown; images?: unknown; model?: unknown }
    let body: IncomingBody;
    try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 }); }
    const promptRaw = body?.prompt;
    const imagesRaw = body?.images;
    const modelRaw = body?.model;
    if (typeof promptRaw !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing prompt' }), { status: 400 });
    }
    const prompt = promptRaw;
    const images: IncomingImage[] = Array.isArray(imagesRaw)
      ? (imagesRaw as unknown[]).filter((val): val is IncomingImage => {
          if (typeof val !== 'object' || val === null) return false;
          if (!('data' in val)) return false;
          // Narrow and confirm structure
          const data = (val as { data: unknown }).data;
          return typeof data === 'string';
        })
      : [];
    const model = typeof modelRaw === 'string' ? modelRaw : 'gemini-2.5-flash-image-preview';
    if (images.length > 6) {
      return new Response(JSON.stringify({ error: 'Too many images (max 6)' }), { status: 400 });
    }
    for (const img of images) {
      const approx = Math.floor(img.data.length * 0.75);
      if (approx > 8 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: 'Image too large (>8MB)' }), { status: 400 });
      }
    }
    const ai = new GoogleGenAI({ apiKey });
    const contents = [ { text: prompt }, ...images.map(im => ({ inlineData: { mimeType: im.mimeType || 'image/png', data: im.data } })) ];
    const started = Date.now();
    const response = await ai.models.generateContent({ model, contents });
    const durationMs = Date.now() - started;
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      return new Response(JSON.stringify({ error: 'No image returned', raw: response }), { status: 502 });
    }
    return new Response(JSON.stringify({ imageB64: imgPart.inlineData.data, meta: { model, durationMs } }), { status: 200 });
  } catch (e) {
    console.error('[api/genai] error', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
  }
}
