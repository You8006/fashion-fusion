import { NextRequest } from 'next/server';
// GoogleGenAI SDK を直接使わず raw fetch で upstreamStatus を取得
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
    } catch {
      console.log('[log-failed]', id, o);
    }
  };
  try {
    // --- Ultra fast health / return-path diagnostic (?ping=1) ---
    // 目的: レイテンシ/返却経路/ヘッダー (X-Correlation-Id) を上流要素や画像処理を介さず即確認。
    // 特徴: API キー未設定でも成功 (鍵チェック前)。Body は一切読み込まない。
    const ping = req.nextUrl?.searchParams?.get('ping');
    if (ping === '1') {
      log({ t: 'ping', stage: 'early', memRss: process.memoryUsage().rss });
      return new Response(
        JSON.stringify({
          pong: true,
            correlationId: id,
            now: new Date().toISOString(),
            uptimeMs: Math.floor(process.uptime() * 1000),
            node: process.version,
            memRss: process.memoryUsage().rss
        }),
        { status: 200, headers: { 'X-Correlation-Id': id, 'Content-Type': 'application/json' } }
      );
    }

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
          const encStart = Date.now();
          const ab = await f.arrayBuffer();
          const b64 = Buffer.from(ab).toString('base64');
          const encMs = Date.now() - encStart;
          images.push({ data: b64, mimeType: f.type || 'image/png' });
          log({ t: 'encode', fileName: f.name, fileBytes: size, b64Len: b64.length, ms: encMs });
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
    const allowDebug = process.env.DEBUG_UPSTREAM === '1';
    const debugMode = allowDebug && (req.nextUrl?.searchParams?.get('debug') === '1' || req.headers.get('x-debug-upstream') === '1');
    if (!allowDebug && (req.nextUrl?.searchParams?.get('debug') === '1')) {
      log({ t: 'debug_blocked' });
    }
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
        // 送信直前ボディログ (400 Bad Request 切り分け用)
        try {
          const full = process.env.LOG_GEMINI_BODY === '1' || req.nextUrl?.searchParams?.get('body') === '1';
          const sanitize = (body: typeof geminiBody) => {
            if (full) return body; // フル出力 (画像 Base64 も含む: サイズ大注意)
            return {
              contents: body.contents.map(c => ({
                role: c.role,
                parts: c.parts.map(p => {
                  if (typeof p === 'object' && p && 'text' in p && typeof (p as any).text === 'string') {
                    const textVal = (p as any).text as string;
                    return { text: textVal.length > 400 ? textVal.slice(0,400) + `...(+${textVal.length-400} chars)` : textVal };
                  }
                  if (typeof p === 'object' && p && 'inlineData' in p) {
                    const inline: any = (p as any).inlineData;
                    const d = inline?.data as string | undefined;
                    return {
                      inlineData: {
                        mimeType: inline?.mimeType,
                        data: d ? `<base64 length=${d.length}>` : '<missing>'
                      }
                    };
                  }
                  return p;
                })
              }))
            };
          };
          log({ t: 'upstream_request_body', debug: true, model, full, body: sanitize(geminiBody) });
        } catch { /* ignore logging errors */ }
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

    // --- Upstream (Gemini) 呼び出し: raw fetch で status と本文を完全把握 ---
    const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const upstreamBody = {
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
    // Upstream 呼び出し前の本番向けサニタイズログ (400 原因特定用)
    try {
      const full = process.env.LOG_GEMINI_BODY === '1' || req.nextUrl?.searchParams?.get('body') === '1';
      const summarize = (body: typeof upstreamBody) => {
        if (full) return body; // 危険: 画像 Base64 を含むため大量ログ注意
        return {
          contents: body.contents.map(c => ({
            role: c.role,
            parts: c.parts.map(p => {
              if (typeof p === 'object' && p && 'text' in p && typeof (p as any).text === 'string') {
                const txt = (p as any).text as string;
                return { textPreview: txt.slice(0,160), textLen: txt.length };
              }
              if (typeof p === 'object' && p && 'inlineData' in p) {
                const inline: any = (p as any).inlineData;
                const d = inline?.data as string | undefined;
                return {
                  inlineData: {
                    mimeType: inline?.mimeType,
                    base64Len: d?.length || 0
                  }
                };
              }
              return { kind: 'unknown_part' };
            })
          }))
        };
      };
      log({ t: 'upstream_request_body', model, full, body: summarize(upstreamBody) });
    } catch { /* ignore logging errors */ }
    const started = Date.now();
    log({ t: 'fetch', phase: 'start', memRss: process.memoryUsage().rss, upstreamUrl });
  let upstreamStatus: number | undefined;
  // --- Minimal type definitions to avoid any ---
  interface GeminiPart { inlineData?: { data?: string; mimeType?: string }; text?: string }
  interface GeminiContent { role?: string; parts?: GeminiPart[] }
  interface GeminiCandidate { content?: GeminiContent }
  interface GeminiResponse { candidates?: GeminiCandidate[]; promptFeedback?: { blockReason?: string } }
  let jsonAny: GeminiResponse | null = null;
    try {
      const upstreamRes = await fetch(upstreamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(upstreamBody)
      });
      upstreamStatus = upstreamRes.status;
      const text = await upstreamRes.text();
      const bodyLen = text.length;
  let parsed: unknown = null;
      try { parsed = JSON.parse(text); } catch {
        log({ t: 'error', stage: 'upstream', kind: 'json_parse_fail', upstreamStatus, bodyLen });
        return new Response(JSON.stringify({ error: 'Upstream JSON parse failed', upstreamStatus, correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
      }
  jsonAny = parsed as GeminiResponse;
      const durationMs = Date.now() - started;
      log({ t: 'fetch', phase: 'end', ms: durationMs, upstreamStatus, bodyLen, memRss: process.memoryUsage().rss });
      if (!upstreamRes.ok) {
        const snippet = text.slice(0, 300);
        log({ t: 'error', stage: 'upstream', kind: 'non_200', upstreamStatus, snippetLen: snippet.length });
        return new Response(JSON.stringify({ error: 'Upstream non-200', upstreamStatus, snippet, correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
      }
    } catch (err) {
      log({ t: 'error', stage: 'upstream', kind: 'fetch_throw', message: err instanceof Error ? err.message : String(err) });
      return new Response(JSON.stringify({ error: 'Upstream call failed', upstreamStatus: upstreamStatus ?? null, correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
    }
    const durationMs = Date.now() - started;
  const parts: GeminiPart[] = jsonAny?.candidates?.[0]?.content?.parts || [];
    const imgPart = parts.find((p: { inlineData?: { data?: string } }) => p?.inlineData?.data);
    if (!imgPart?.inlineData?.data) {
  log({ t: 'error', stage: 'response', kind: 'no_image_part', upstreamStatus: upstreamStatus });
      return new Response(JSON.stringify({ error: 'No image returned', upstreamStatus, correlationId: id }), { status: 502, headers: { 'X-Correlation-Id': id } });
    }
    const imageBytes = base64Bytes(imgPart.inlineData.data);
    const wantRaw = req.nextUrl?.searchParams?.get('raw') === '1';
    if (wantRaw) {
      // 生バイナリ返却モード（デバッグ / 直接表示用途）
      log({ t: 'result_raw', imageBytes, durationMs, memRss: process.memoryUsage().rss });
      const buf = Buffer.from(imgPart.inlineData.data, 'base64');
      const totalMsRaw = Date.now() - startedAll;
      log({ t: 'complete', totalMs: totalMsRaw, raw: true, memRss: process.memoryUsage().rss });
      return new Response(buf, { status: 200, headers: { 'Content-Type': 'image/png', 'X-Correlation-Id': id } });
    }
    log({ t: 'result', imageBytes, durationMs, memRss: process.memoryUsage().rss });
    const totalMs = Date.now() - startedAll;
    log({ t: 'complete', totalMs, memRss: process.memoryUsage().rss });
  return new Response(JSON.stringify({ imageB64: imgPart.inlineData.data, meta: { model, durationMs, upstreamStatus: upstreamStatus || 200, correlationId: id } }), { status: 200, headers: { 'X-Correlation-Id': id, 'Content-Type': 'application/json' } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
  log({ t: 'error', stage: 'unhandled', kind: 'unexpected', message, memRss: process.memoryUsage().rss });
    return new Response(JSON.stringify({ error: 'Internal server error', correlationId: id }), { status: 500, headers: { 'X-Correlation-Id': id } });
  }
}
