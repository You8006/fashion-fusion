// 解像度ヒントをプロンプト末尾へ付与してモデルの出力揺れを抑制
export const sizeHint = (w: number, h: number) => `Output resolution: EXACTLY ${w}x${h} pixels. Match the aspect ratio and crop/extend internally as needed.`;
