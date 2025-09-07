// 解像度ヒントをプロンプト末尾へ付与してモデルの出力揺れを抑制
export const sizeHint = (w: number, h: number) => `Output resolution: EXACTLY ${w}x${h} pixels. Preserve this exact aspect; do not add padding bars and do not convert to a square.`;
