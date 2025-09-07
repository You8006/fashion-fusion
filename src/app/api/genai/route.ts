import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import crypto from 'node:crypto';

// Using default (Node) runtime; no explicit export to avoid Turbopack warning.

// POST /api/genai
// Body: { prompt: string, images?: [{ data: string, mimeType?: string }], model?: string }
export async function POST(req: NextRequest) {
  const id = crypto.randomUUID();
  const startedAll = Date.now();
  const log = (o: Record<string, unknown>) => {
    try {
      console.log(JSON.stringify({ id, ts: new Date().toISOString(), ...o }));
    } catch (e) {
      console.log('[log-failed]', id, o);
    }
  };
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      log({ t: 'error', stage: 'config', kind: 'missing_api_key' });
      return new Response(JSON.stringify({ error: 'Server misconfigured: GEMINI_API_KEY missing', correlationId: id }), { status: 500, headers: { 'X-Correlation-Id': id } });
    } else {
      // マスク付き API キー存在ログ (先頭4文字 + 長さ + ハッシュ先頭12桁) ※本番で不要なら削除可
      try {
        const masked = apiKey.slice(0,4) + '***';
        const hash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0,12);
        log({ t: 'config', stage: 'config', apiKeyMask: masked, apiKeyLen: apiKey.length, apiKeyHash12: hash });
      } catch { /* ignore logging errors */ }
    }
    interface IncomingImage { data: string; mimeType?: string }
    const contentType = req.headers.get('content-type') || '';
    let prompt: string | null = null;
    let model: string = 'gemini-2.5-flash-image-preview';
    let images: IncomingImage[] = [];
    let rawBytesTotal = 0; // multipart raw bytes (sum of file.size)

    if (contentType.includes('multipart/form-data')) {
      // Multipart: FormData 経由 (推奨ルート)
      let form: FormData;
      try { form = await req.formData(); } catch {
        log({ t: 'error', stage: 'parse', kind: 'multipart_parse_error' });
        return new Response(JSON.stringify({ error: 'Invalid multipart form', correlationId: id }), { status: 400, headers: { 'X-Correlation-Id': id } });
      }
      const p = form.get('prompt');
      if (typeof p === 'string') prompt = p; else prompt = null;
      const m = form.get('model');
      if (typeof m === 'string' && m.trim()) model = m.trim();
      const files = form.getAll('images');
      for (const f of files) {
        if (f instanceof File) {
          const size = f.size;
            rawBytesTotal += size;
            // Convert to base64 (Gemini SDK expects inlineData base64)
            const ab = await f.arrayBuffer();
            const b64 = Buffer.from(ab).toString('base64');
            images.push({ data: b64, mimeType: f.type || 'image/png' });
        }
      }
      log({ t: 'multipart', imagesFiles: files.length, accepted: images.length, rawBytesTotal });
    } else {
      // JSON: 従来 Base64 埋め込み
      interface IncomingBody { prompt?: unknown; images?: unknown; model?: unknown }
      let body: IncomingBody;
      try { body = await req.json(); } catch {
        log({ t: 'error', stage: 'parse', kind: 'invalid_json' });
        return new Response(JSON.stringify({ error: 'Invalid JSON', correlationId: id }), { status: 400, headers: { 'X-Correlation-Id': id } });
      }
      const promptRaw = body?.prompt;
      const imagesRaw = body?.images;
      const modelRaw = body?.model;
      if (typeof promptRaw === 'string') prompt = promptRaw; else prompt = null;
      if (typeof modelRaw === 'string') model = modelRaw; else model = 'gemini-2.5-flash-image-preview';
      images = Array.isArray(imagesRaw)
        ? (imagesRaw as unknown[]).filter((val): val is IncomingImage => {
            if (typeof val !== 'object' || val === null) return false;
            if (!('data' in val)) return false;
            const data = (val as { data: unknown }).data;
            return typeof data === 'string';
          })
        : [];
    }

    if (!prompt) {
      log({ t: 'error', stage: 'validate', kind: 'missing_prompt' });
      return new Response(JSON.stringify({ error: 'Missing prompt', correlationId: id }), { status: 400, headers: { 'X-Correlation-Id': id } });
    }
    if (images.length > 6) {
      log({ t: 'error', stage: 'validate', kind: 'too_many_images', count: images.length });
      return new Response(JSON.stringify({ error: 'Too many images (max 6)', correlationId: id }), { status: 400, headers: { 'X-Correlation-Id': id } });
    }
    // サイズ評価: multipart なら rawBytesTotal / JSON なら推定
    const base64Bytes = (b64: string) => Math.floor(b64.length * 0.75);
    let totalImageBytes: number;
    if (contentType.includes('multipart/form-data')) {
      totalImageBytes = rawBytesTotal; // 実バイト
    } else {
      let sum = 0; for (const img of images) sum += base64Bytes(img.data); totalImageBytes = sum;
    }
    const LIMIT_WARN = 3.9 * 1024 * 1024; // ほぼ 4MB 制限に対する余裕
    if (totalImageBytes >= LIMIT_WARN) {
      log({ t: 'error', stage: 'validate', kind: 'payload_too_large', totalImageBytes, multipart: contentType.includes('multipart/form-data') });
      return new Response(JSON.stringify({ error: 'Payload too large (>=3.9MB). Resize images.', correlationId: id }), { status: 413, headers: { 'X-Correlation-Id': id } });
    }
    // 個別画像 8MB ガード (Base64換算は JSON 経路のみ)
    for (const img of images) {
      const approx = base64Bytes(img.data);
      if (approx > 8 * 1024 * 1024) {
        log({ t: 'error', stage: 'validate', kind: 'single_image_too_large', imageBytes: approx });
        return new Response(JSON.stringify({ error: 'Image too large (>8MB)', correlationId: id }), { status: 400, headers: { 'X-Correlation-Id': id } });
      }
    }
    log({ t: 'request', images: images.length, totalImageBytes, model, promptPreview: prompt.slice(0, 160), multipart: contentType.includes('multipart/form-data') });

    // --- Debug pass-through mode (raw Gemini API) ---
    const debugMode = req.nextUrl?.searchParams?.get('debug') === '1' || req.headers.get('x-debug-upstream') === '1';
    if (debugMode) {
      try {
        const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const geminiBody = {
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                ...images.map(im => ({ inlineData: { mimeType: im.mimeType || 'image/png', data: im.data } }))
              ]
            }
          ]
        };
        const upstreamStarted = Date.now();
        const upstreamRes = await fetch(GEMINI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(geminiBody)
        });
        const upstreamText = await upstreamRes.text();
        log({ t: 'upstream_debug', status: upstreamRes.status, bodyLen: upstreamText.length, ms: Date.now() - upstreamStarted });
        return new Response(JSON.stringify({ debug: true, upstreamStatus: upstreamRes.status, upstreamBody: upstreamText, correlationId: id }), { status: 200, headers: { 'X-Correlation-Id': id } });
      } catch (err) {
        log({ t: 'error', stage: 'upstream_debug', kind: 'exception', message: err instanceof Error ? err.message : String(err) });
        return new Response(JSON.stringify({ error: 'Upstream debug failed', correlationId: id }), { status: 500, headers: { 'X-Correlation-Id': id } });
      }
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents = [ { text: prompt }, ...images.map(im => ({ inlineData: { mimeType: im.mimeType || 'image/png', data: im.data } })) ];
    const started = Date.now();
    log({ t: 'fetch', phase: 'start' });
    let response;
    try {
      response = await ai.models.generateContent({ model, contents });
    } catch (err) {
      log({ t: 'error', stage: 'upstream', kind: 'fetch_throw', message: err instanceof Error ? err.message : String(err) });
      return new Response(JSON.stringify({ error: 'Upstream call failed', correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
    }
    const durationMs = Date.now() - started;
    log({ t: 'fetch', phase: 'end', ms: durationMs });
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
      log({ t: 'error', stage: 'response', kind: 'no_image_part' });
      return new Response(JSON.stringify({ error: 'No image returned', correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
    }
    const imageBytes = base64Bytes(imgPart.inlineData.data);
    log({ t: 'result', imageBytes, durationMs });
    const totalMs = Date.now() - startedAll;
    log({ t: 'complete', totalMs });
    return new Response(JSON.stringify({ imageB64: imgPart.inlineData.data, meta: { model, durationMs, correlationId: id } }), { status: 200, headers: { 'X-Correlation-Id': id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log({ t: 'error', stage: 'unhandled', kind: 'unexpected', message });
    return new Response(JSON.stringify({ error: 'Internal server error', correlationId: id }), { status: 500, headers: { 'X-Correlation-Id': id } });
  }
}
