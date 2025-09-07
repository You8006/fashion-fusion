// Static export モードではサーバ側の /api/genai が存在しないため、
// 呼び出し箇所は別の実装（外部 API 直呼び or ビルド時プリレンダ）に差し替える必要があります。
// 暫定的に明示的エラーを投げて気付きやすくする。
export interface GenAIClientRequest { prompt: string }
export interface GenAIClientResponse { imageB64?: string }
export async function callGenAI(_req: GenAIClientRequest): Promise<GenAIClientResponse> {
  throw new Error('GenAI API disabled: static export build (no /api routes). Provide a client-side integration or re-enable server runtime.');
}
