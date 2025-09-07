// Local recoloring utilities for variant generation (A方式)
// Handles cross-browser (PC / iOS Safari / Android) with graceful fallbacks.

export interface RecolorOptions {
  targetColor: string; // hex or css color
  width: number;
  height: number;
  dpr?: number; // device pixel ratio upscale (optional)
  smoothing?: boolean;
}

export interface GridAssembleOptions {
  gap: number; // gap in px (logical)
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  dpr?: number;
  background?: string;
}

// Create a canvas (Offscreen if possible)
export function makeCanvas(w: number, h: number, dpr = 1): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  const realW = Math.round(w * dpr);
  const realH = Math.round(h * dpr);
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(realW, realH);
  } else {
    const c = document.createElement('canvas');
    c.width = realW;
    c.height = realH;
    canvas = c;
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  if ('scale' in ctx && dpr !== 1) {
    // Only scale drawing space for DOM canvas
    if (canvas instanceof HTMLCanvasElement) {
      (canvas as HTMLCanvasElement).width = realW;
      (canvas as HTMLCanvasElement).height = realH;
      ctx.scale(dpr, dpr);
    }
  }
  (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  }
  return { canvas, ctx };
}

// Enforce source base64 image into given size by cover fit (trim or pad not implemented - simple draw scale)
export async function enforceSizeB64(b64: string, sizeHint: { width: number; height: number }, dpr = 1): Promise<string> {
  const img = await loadImageFromB64(b64);
  const { width, height } = sizeHint;
  const { canvas, ctx } = makeCanvas(width, height, dpr);
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToB64(canvas);
}

export function clampLongEdge(width: number, height: number, maxLong = 2048) {
  const long = Math.max(width, height);
  if (long <= maxLong) return { width, height, scale: 1 };
  const scale = maxLong / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale), scale };
}

// Detect blend mode support
export function supportsGCO(mode: GlobalCompositeOperation): boolean {
  if (typeof document === 'undefined') return false;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = mode;
  const ok = ctx.globalCompositeOperation === mode;
  ctx.globalCompositeOperation = prev;
  return ok;
}

async function loadImageFromB64(b64: string): Promise<HTMLImageElement | ImageBitmap> {
  const dataUrl = `data:image/png;base64,${b64}`;
  // Fast path: createImageBitmap
  if (typeof createImageBitmap !== 'undefined') {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    try { return await createImageBitmap(blob); } catch { /* fallback below */ }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像読み込み失敗'));
    img.src = dataUrl;
  });
}

function canvasToB64(canvas: HTMLCanvasElement | OffscreenCanvas): string {
  if (canvas instanceof OffscreenCanvas) {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
      .then(blob => new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => {
          const result = r.result as string;
            resolve(result.split(',')[1]);
        };
        r.readAsDataURL(blob);
      })) as unknown as string; // caller uses await when needed
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1];
}

// Recolor with optional mask (white = garment). Falls back for iOS Safari.
export async function recolorWithMaskMobileSafe(baseB64: string, maskB64: string | null, color: string, opt: { width: number; height: number; dpr?: number }): Promise<string> {
  const baseImg = await loadImageFromB64(baseB64);
  let maskImg: HTMLImageElement | ImageBitmap | null = null;
  if (maskB64) maskImg = await loadImageFromB64(maskB64);
  const { width, height, dpr = 1 } = opt;
  const { canvas, ctx } = makeCanvas(width, height, dpr);
  ctx.drawImage(baseImg, 0, 0, width, height);
  if (!maskImg) {
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return await blobToB64(blob);
    }
    return (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1];
  }

  const mainSupports = supportsGCO('color');
  // Draw garment area only (mask) into temp
  const { canvas: maskCanvas, ctx: maskCtx } = makeCanvas(width, height, dpr);
  maskCtx.drawImage(maskImg as HTMLImageElement | ImageBitmap, 0, 0, width, height);
  // Extract mask data
  const imageData = maskCtx.getImageData(0, 0, width, height);
  const data = imageData.data;
  // We will tint only where mask is white-ish
  const { r: tr, g: tg, b: tb } = parseColor(color);
  for (let i = 0; i < data.length; i += 4) {
    const R = data[i], G = data[i + 1], B = data[i + 2];
    const isWhite = R > 220 && G > 220 && B > 220; // simple threshold
    if (!isWhite) { data[i + 3] = 0; } // make transparent
  }
  maskCtx.putImageData(imageData, 0, 0);

  if (mainSupports) {
    ctx.save();
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = `rgb(${tr} ${tg} ${tb})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas as HTMLCanvasElement | OffscreenCanvas, 0, 0, width, height);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
    // Re-draw base under tinted area with mask composite
    // (already applied)
  } else {
    // Fallback multiply + screen approximation
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${tr} ${tg} ${tb})`;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'screen';
  ctx.drawImage(maskCanvas as HTMLCanvasElement | OffscreenCanvas, 0, 0, width, height);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToB64(blob);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1];
}

function parseColor(c: string): { r: number; g: number; b: number } {
  // Supports #rgb, #rrggbb
  if (c.startsWith('#')) {
    if (c.length === 4) {
      const r = parseInt(c[1] + c[1], 16);
      const g = parseInt(c[2] + c[2], 16);
      const b = parseInt(c[3] + c[3], 16);
      return { r, g, b };
    }
    if (c.length === 7) {
      return { r: parseInt(c.slice(1, 3), 16), g: parseInt(c.slice(3, 5), 16), b: parseInt(c.slice(5, 7), 16) };
    }
  }
  // Fallback parse via canvas
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = 1;
  const ctx = cvs.getContext('2d')!;
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2] };
}

async function blobToB64(blob: Blob): Promise<string> {
  return await new Promise(resolve => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(',')[1]);
    r.readAsDataURL(blob);
  });
}

export async function assembleGrid(cells: string[], opt: GridAssembleOptions): Promise<string> {
  const { cols, rows, cellWidth, cellHeight, gap, dpr = 1, background = '#000000' } = opt;
  const totalW = cellWidth * cols + gap * (cols + 1);
  const totalH = cellHeight * rows + gap * (rows + 1);
  const { canvas, ctx } = makeCanvas(totalW, totalH, dpr);
  (ctx as CanvasRenderingContext2D).imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in ctx) {
    (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  }
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, totalW, totalH);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (!cells[idx]) continue;
      const img = await loadImageFromB64(cells[idx]);
      const x = gap + c * (cellWidth + gap);
      const y = gap + r * (cellHeight + gap);
  ctx.drawImage(img as HTMLImageElement | ImageBitmap, x, y, cellWidth, cellHeight);
    }
  }
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToB64(blob);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/png').split(',')[1];
}

// Smart save for iOS fallback
export function saveB64Smart(b64: string, filename: string) {
  const dataUrl = `data:image/png;base64,${b64}`;
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 0);
  // If download attribute ignored (iOS), open new tab
  setTimeout(() => {
    // Heuristic: if file not prompted, user can long-press
    window.open(dataUrl, '_blank');
  }, 400);
}

export async function buildNineVariants(base: string, mask: string | null, colors: string[], size: { width: number; height: number }): Promise<string[]> {
  const out: string[] = [];
  for (const col of colors.slice(0, 9)) {
    const b = await recolorWithMaskMobileSafe(base, mask, col, size);
    out.push(b);
  }
  return out;
}
