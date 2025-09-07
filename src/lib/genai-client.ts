interface GenAIClientImage { data: string; mimeType?: string }
interface GenAIClientRequest { prompt: string; images?: GenAIClientImage[]; model?: string }
interface GenAIClientResponse { imageB64?: string; meta?: any; error?: string }

export async function callGenAI(req: GenAIClientRequest, signal?: AbortSignal): Promise<GenAIClientResponse> {
  const res = await fetch('/api/genai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
    signal,
  });
  let json: any = null;
  try { json = await res.json(); } catch { throw new Error('Invalid JSON response'); }
  if (!res.ok) {
    throw new Error(json?.error || 'GenAI request failed');
  }
  return json as GenAIClientResponse;
}
