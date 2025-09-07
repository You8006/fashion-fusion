// grid-utils.ts
// 3x3 などのグリッド画像を分割 / 再構築するユーティリティ

export async function sliceGridB64(gridB64: string, cols: number, rows: number, cellW: number, cellH: number): Promise<string[]> {
  const img = new Image();
  img.src = `data:image/png;base64,${gridB64}`;
  await img.decode();
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement('canvas');
      canvas.width = cellW; canvas.height = cellH;
      const g = canvas.getContext('2d');
      if (!g) throw new Error('2D context unavailable');
      g.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
      out.push(canvas.toDataURL('image/png').split(',')[1]);
    }
  }
  return out;
}

export async function assembleGridB64(cells: string[], cols: number, rows: number, cellW: number, cellH: number): Promise<string> {
  if (cells.length !== cols * rows) throw new Error('cells length mismatch');
  const canvas = document.createElement('canvas');
  canvas.width = cellW * cols; canvas.height = cellH * rows;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2D context unavailable');
  for (let i = 0; i < cells.length; i++) {
    const r = Math.floor(i / cols); const c = i % cols;
    const img = new Image();
    img.src = `data:image/png;base64,${cells[i]}`;
  await img.decode(); // sequential decode needed to preserve index order
    g.drawImage(img, c * cellW, r * cellH, cellW, cellH);
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
