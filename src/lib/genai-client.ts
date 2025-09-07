interface GenAIClientImage { data: string; mimeType?: string }
export interface GenAIClientRequest { prompt: string; images?: GenAIClientImage[]; model?: string }
export interface GenAIClientResponseMeta { model?: string; durationMs?: number }
export interface GenAIClientResponse { imageB64?: string; meta?: GenAIClientResponseMeta; error?: string }

export async function callGenAI(req: GenAIClientRequest, signal?: AbortSignal): Promise<GenAIClientResponse> {
  const res = await fetch('/api/genai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { throw new Error('Invalid JSON response'); }
  if (!res.ok) {
    const errMsg = (json && typeof json === 'object' && 'error' in json) ? (json as { error: string }).error : 'GenAI request failed';
    throw new Error(errMsg);
  }
  return json as GenAIClientResponse;
}

// New: multipart (FormData) submission variant to reduce transfer size vs Base64 JSON.
export interface CallGenAIMultipartOptions {
  prompt: string;
  files: { file: File; fieldName?: string }[]; // fieldName defaults to 'images'
  model?: string;
  extraFields?: Record<string,string>;
  signal?: AbortSignal;
}
export async function callGenAIMultipart(opts: CallGenAIMultipartOptions): Promise<GenAIClientResponse> {
  const fd = new FormData();
  fd.append('prompt', opts.prompt);
  if (opts.model) fd.append('model', opts.model);
  for (const f of opts.files) {
    fd.append(f.fieldName || 'images', f.file);
  }
  if (opts.extraFields) {
    for (const [k,v] of Object.entries(opts.extraFields)) fd.append(k, v);
  }
  const res = await fetch('/api/genai', { method: 'POST', body: fd, signal: opts.signal });
  let json: unknown = null;
  try { json = await res.json(); } catch { throw new Error('Invalid JSON response'); }
  if (!res.ok) {
    const errMsg = (json && typeof json === 'object' && 'error' in json) ? (json as { error: string }).error : 'GenAI request failed';
    throw new Error(errMsg);
  }
  return json as GenAIClientResponse;
}
