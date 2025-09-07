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
