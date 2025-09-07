// size-utils.ts
// 人物画像サイズを基準に全生成物を統一するためのユーティリティ

export async function sizeFromFile(file: File): Promise<{ w: number; h: number; mime: string }> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  return { w: img.naturalWidth, h: img.naturalHeight, mime: file.type || 'image/png' };
}

export async function sizeFromB64(b64: string): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  return { w: img.naturalWidth, h: img.naturalHeight };
}

// cover / contain で正確にサイズを合わせた PNG Base64 を返す
export async function enforceSizeB64(srcB64: string, W: number, H: number, fit: 'cover' | 'contain' = 'cover'): Promise<string> {
  const img = new Image();
  img.src = `data:image/png;base64,${srcB64}`;
  await img.decode();
  const sw = img.naturalWidth; const sh = img.naturalHeight;
  const s = (fit === 'cover') ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const dw = sw * s; const dh = sh * s;
  const dx = (W - dw) / 2; const dy = (H - dh) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  (g as any).imageSmoothingQuality = 'high';
  g.clearRect(0, 0, W, H);
  g.drawImage(img, dx, dy, dw, dh);
  return canvas.toDataURL('image/png').split(',')[1];
}

export function downloadB64PNG(nameBase: string, b64: string, W: number, H: number) {
  const a = document.createElement('a');
  a.href = `data:image/png;base64,${b64}`;
  a.download = `${nameBase}_${W}x${H}.png`;
  document.body.appendChild(a);
  a.click();
  setTimeout(()=> a.remove(), 0);
}

export function clampLongEdgeSize(w: number, h: number, maxLong = 2048) {
  const long = Math.max(w, h);
  if (long <= maxLong) return { w, h, scale: 1 };
  const s = maxLong / long;
  return { w: Math.round(w * s), h: Math.round(h * s), scale: s };
}
