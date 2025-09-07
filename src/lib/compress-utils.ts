// Simple client-side image optimization helpers
// Goal: reduce combined payload under a target byte size by (1) re-encoding to WebP (lossy) and (2) optional downscaling.
// NOTE: This uses canvas; animated GIF/WEBP will lose animation. HEIC/HEIF depends on browser decode support.

export interface OptimizeResultFile {
  original: File;
  optimized: File; // may be same as original
  beforeBytes: number;
  afterBytes: number;
  downscaled: boolean;
  qualityUsed: number;
  scaleUsed: number;
}

export interface OptimizeSummary {
  files: OptimizeResultFile[];
  totalBefore: number;
  totalAfter: number;
  reducedPercent: number;
  hitTarget: boolean;
}

export interface OptimizeOptions {
  targetTotalBytes: number;          // e.g. 3.4 * 1024 * 1024
  maxLongEdge?: number;              // e.g. 2048
  minQuality?: number;               // e.g. 0.55
  qualities?: number[];              // descending tries e.g. [0.85,0.8,0.75,0.7,0.65,0.6]
  format?: 'image/webp' | 'image/jpeg';
}

const dataUrlToFile = (dataUrl: string, name: string): File => {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mimeMatch = header.match(/data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
  const b64 = dataUrl.slice(comma + 1);
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
};

async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
  img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Image decode failed')); };
    img.src = url;
  });
}

export async function optimizeImages(files: File[], opts: OptimizeOptions): Promise<OptimizeSummary> {
  const {
    targetTotalBytes,
    maxLongEdge = 2048,
    minQuality = 0.55,
    qualities = [0.85,0.8,0.75,0.7,0.65,0.6],
    format = 'image/webp'
  } = opts;
  const totalBefore = files.reduce((a,f) => a + f.size, 0);
  if (totalBefore <= targetTotalBytes) {
    return {
      files: files.map(f => ({ original: f, optimized: f, beforeBytes: f.size, afterBytes: f.size, downscaled: false, qualityUsed: 1, scaleUsed: 1 })),
      totalBefore,
      totalAfter: totalBefore,
      reducedPercent: 0,
      hitTarget: true,
    };
  }
  // scale factor suggestion based on area: sqrt(target/actual)
  const scaleSuggest = Math.min(1, Math.sqrt(targetTotalBytes / totalBefore));
  const results: OptimizeResultFile[] = [];
  // We distribute target proportionally per file initial size
  for (const file of files) {
    const fileShare = file.size / totalBefore;
    const perFileTarget = targetTotalBytes * fileShare;
    let bestFile: File = file;
    let bestBytes = file.size;
    let usedQuality = 1;
    let usedScale = 1;
    try {
      const img = await loadImage(file);
  const w = img.naturalWidth; const h = img.naturalHeight;
      const longEdge = Math.max(w,h);
      let scale = Math.min(1, scaleSuggest, maxLongEdge / longEdge);
      if (scale <= 0) scale = 1;
      // If file alone is huge compared to its per-file target, allow a second shrink heuristic
      if (file.size > perFileTarget * 1.8) {
        scale = Math.min(scale, Math.sqrt((perFileTarget * 1.1) / file.size));
      }
      if (scale < 0.15) scale = 0.15; // avoid absurd tiny
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);
      const canvas = document.createElement('canvas');
      canvas.width = targetW; canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D unavailable');
      ctx.drawImage(img, 0, 0, targetW, targetH);
      for (const q of qualities) {
        const qUse = q < minQuality ? minQuality : q;
        const dataUrl = canvas.toDataURL(format, qUse);
        const f2 = dataUrlToFile(dataUrl, file.name.replace(/\.[^.]+$/, '') + '.webp');
        if (f2.size < bestBytes) {
          bestFile = f2; bestBytes = f2.size; usedQuality = qUse; usedScale = scale;
        }
        if (bestBytes <= perFileTarget) break;
      }
      results.push({ original: file, optimized: bestFile, beforeBytes: file.size, afterBytes: bestBytes, downscaled: usedScale < 0.999, qualityUsed: usedQuality, scaleUsed: usedScale });
  } catch {
      // Fallback: keep original
      results.push({ original: file, optimized: file, beforeBytes: file.size, afterBytes: file.size, downscaled: false, qualityUsed: 1, scaleUsed: 1 });
    }
  }
  const totalAfter = results.reduce((a,r) => a + r.afterBytes, 0);
  return {
    files: results,
    totalBefore,
    totalAfter,
    reducedPercent: totalBefore ? (1 - totalAfter / totalBefore) * 100 : 0,
    hitTarget: totalAfter <= targetTotalBytes,
  };
}
