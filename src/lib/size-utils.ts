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
  // キャンバスサイズは常に指定された (W,H) を使用し、人物基準のアスペクト比を固定
  const targetAspect = W / H;
  const srcAspect = sw / sh;
  // cover: 余白を残さずトリミング / contain: 余白(透明)を許容
  const scale = (fit === 'cover') ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  const dx = Math.round((W - dw) / 2);
  const dy = Math.round((H - dh) / 2);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('Canvas 2D context unavailable');
  g.imageSmoothingEnabled = true;
  if (typeof (g as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality !== 'undefined') {
    (g as CanvasRenderingContext2D & { imageSmoothingQuality?: string }).imageSmoothingQuality = 'high';
  }
  g.clearRect(0, 0, W, H);
  g.drawImage(img, dx, dy, dw, dh);
  // デバッグ用に大きく乖離する場合はコンソール通知（比率強制が効いたか確認）
  if (Math.abs(srcAspect - targetAspect) > 0.01) {
    console.info('[enforceSizeB64] aspect forced', { srcAspect, targetAspect, fit, canvas: { W, H }, draw: { dw, dh, dx, dy } });
  }
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
