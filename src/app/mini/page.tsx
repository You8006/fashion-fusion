"use client";

import { useState, useCallback, useMemo } from 'react';
// Remove direct GoogleGenAI usage; use server proxy
import { callGenAI } from '@/lib/genai-client';
import { buildCompositePrompt, buildItemColorGridPrompt } from '@/lib/prompt-builders';
import { sizeFromFile, enforceSizeB64 as enforceSizeB64Strict, downloadB64PNG, clampLongEdgeSize } from '@/lib/size-utils';
import { sliceGridB64, assembleGridB64 } from '@/lib/grid-utils';

// Minimal tool: upload person + item, generate single composite, then 3x3 color composite grid

export default function MiniPage() {
  // APIキーはサーバ側のみ保持
  const ai = null;

  const [personFile, setPersonFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [baseW, setBaseW] = useState(0); const [baseH, setBaseH] = useState(0);
  const [resultB64, setResultB64] = useState('');
  const [colorGridB64, setColorGridB64] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onPick = useCallback(async (kind: 'person' | 'item', files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    if (kind === 'person') {
      setPersonFile(f);
      const { w, h } = await sizeFromFile(f);
      const { w: cw, h: ch } = clampLongEdgeSize(w, h, 2048);
      setBaseW(cw); setBaseH(ch);
    } else {
      setItemFile(f);
    }
  }, []);

  const toInline = useCallback(async (f: File) => {
    const MAX = 8 * 1024 * 1024; if (f.size > MAX) throw new Error('File too large');
    const b64 = await new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onerror = () => rej(new Error('Read failed'));
      r.onload = () => {
        const s = r.result; if (typeof s !== 'string') return rej(new Error('DataURL missing'));
        const i = s.indexOf(','); if (i < 0) return rej(new Error('Bad DataURL'));
        res(s.slice(i + 1));
      };
      r.readAsDataURL(f);
    });
    return { inlineData: { mimeType: f.type || 'image/png', data: b64 } };
  }, []);

  const generateComposite = useCallback(async () => {
    try {
      setError('');
      if (!personFile || !itemFile) { setError('Select person + item images'); return; }
      if (!baseW || !baseH) { setError('Base size missing'); return; }
      setBusy(true);
      const person = await toInline(personFile);
      const item = await toInline(itemFile);
      // Payload size pre-check
      const base64Bytes = (b64: string) => Math.floor(b64.length * 0.75);
      const totalBytes = base64Bytes(person.inlineData.data!) + base64Bytes(item.inlineData.data!);
      if (totalBytes > 3.5 * 1024 * 1024) {
        setError(`Payload too large (≈${(totalBytes/1024/1024).toFixed(2)}MB). Resize images below 3.5MB combined.`);
        setBusy(false);
        return;
      }
      const prompt = buildCompositePrompt(baseW, baseH);
      const res = await callGenAI({ prompt, images: [ person.inlineData, item.inlineData ].map(p => ({ data: p.data!, mimeType: p.mimeType })) });
      if (!res.imageB64) throw new Error('No image returned');
      const normalized = await enforceSizeB64Strict(res.imageB64, baseW, baseH, 'cover');
      setResultB64(normalized);
    } catch (e) {
  let msg = e instanceof Error ? e.message : String(e);
  if (/payload|body|too large|413|4mb/i.test(msg)) msg = 'Likely payload too large (>4MB). Try smaller or resized images.';
  setError(msg);
    } finally { setBusy(false); }
  }, [personFile, itemFile, baseW, baseH, toInline]);

  const generateColorGrid = useCallback(async () => {
    try {
      setError('');
      if (!personFile || !itemFile) { setError('Select person + item images'); return; }
      if (!baseW || !baseH) { setError('Base size missing'); return; }
      setBusy(true);
      const cellW = baseW; const cellH = baseH;
      const itemPrompt = buildItemColorGridPrompt([
        '#FF0000','#0055FF','#FFD700','#00B140','#7A00FF','#FF7A00','#000000','#FFFFFF','#808080'
      ], cellW, cellH);
      const itemInline = await toInline(itemFile);
      const base64Bytes = (b64: string) => Math.floor(b64.length * 0.75);
      const totalBytesSingle = base64Bytes(itemInline.inlineData.data!);
      if (totalBytesSingle > 3.5 * 1024 * 1024) {
        setError(`Item image too large (≈${(totalBytesSingle/1024/1024).toFixed(2)}MB) for grid request.`);
        setBusy(false);
        return;
      }
      const itemGridRes = await callGenAI({ prompt: itemPrompt, images: [ { data: itemInline.inlineData.data!, mimeType: itemInline.inlineData.mimeType } ] });
      if (!itemGridRes.imageB64) throw new Error('Item color grid failed');
      const itemGridNorm = await enforceSizeB64Strict(itemGridRes.imageB64, cellW * 3, cellH * 3, 'cover');
      const itemCells = await sliceGridB64(itemGridNorm, 3, 3, cellW, cellH);
      if (itemCells.length !== 9) throw new Error('Failed to slice 9 cells');
      const personInline = await toInline(personFile);
      const compositeCells: string[] = [];
      for (let i = 0; i < 9; i++) {
        const compPrompt = buildCompositePrompt(cellW, cellH) + '\nMODE=single_color_variant_cell index=' + i;
        const compRes = await callGenAI({ prompt: compPrompt, images: [ { data: personInline.inlineData.data!, mimeType: personInline.inlineData.mimeType }, { data: itemCells[i], mimeType: 'image/png' } ] });
        if (!compRes.imageB64) throw new Error('Cell composite failed');
        const norm = await enforceSizeB64Strict(compRes.imageB64, cellW, cellH, 'cover');
        compositeCells.push(norm);
      }
      const finalGrid = await assembleGridB64(compositeCells, 3, 3, cellW, cellH);
      setColorGridB64(finalGrid);
    } catch (e) {
  let msg = e instanceof Error ? e.message : String(e);
  if (/payload|body|too large|413|4mb/i.test(msg)) msg = 'Likely payload too large (>4MB). Try smaller or resized images.';
  setError(msg);
    } finally { setBusy(false); }
  }, [personFile, itemFile, baseW, baseH, toInline]);

  return (
    <main style={{ maxWidth: 1024, margin: '0 auto', padding: '24px 28px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 26, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        Mini Fashion Fusion <span style={{ background: '#444', color: '#fff', fontSize: 12, padding: '2px 6px', borderRadius: 6 }}>Mini</span>
      </h1>
      <p style={{ marginTop: 6, color: '#666', lineHeight: 1.5 }}>
        Upload a person image and a fashion item. Generate a natural composite once, then create a 3x3 color variation grid using the canonical palette. Minimal interface version.
      </p>
      <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Person Image</label>
          <input type="file" accept="image/*" onChange={(e) => onPick('person', e.target.files)} />
          {personFile && <div style={{ fontSize: 12, marginTop: 4, color: '#444' }}>{personFile.name}</div>}
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 260 }}>
          <label style={{ display: 'block', fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Item Image</label>
          <input type="file" accept="image/*" onChange={(e) => onPick('item', e.target.files)} />
          {itemFile && <div style={{ fontSize: 12, marginTop: 4, color: '#444' }}>{itemFile.name}</div>}
        </div>
      </div>
      <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button onClick={generateComposite} disabled={busy || !personFile || !itemFile} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #555', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 14 }}>Generate Composite</button>
        <button onClick={generateColorGrid} disabled={busy || !resultB64} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #555', background: '#222', color: '#fff', cursor: 'pointer', fontSize: 14 }}>Color 3x3 Variations</button>
        <button onClick={() => { setResultB64(''); setColorGridB64(''); }} disabled={busy} style={{ padding: '10px 18px', borderRadius: 8, background: '#444', color: '#fff', cursor: 'pointer', fontSize: 14, border: '1px solid #555' }}>Clear</button>
      </div>
      {error && <div style={{ marginTop: 16, color: '#d22', fontSize: 14 }}>{error}</div>}
      {resultB64 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Composite</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${resultB64}`} alt="composite" style={{ maxWidth: '100%', borderRadius: 12, boxShadow: '0 0 0 1px rgba(255,255,255,0.12),0 4px 24px -4px rgba(0,0,0,0.5)' }} />
          <div style={{ marginTop: 8 }}>
            <button onClick={() => downloadB64PNG('mini-composite', resultB64, baseW, baseH)} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 6, background: '#0a84ff', color: '#fff', border: 'none', cursor: 'pointer' }}>Download</button>
          </div>
        </div>
      )}
      {colorGridB64 && (
        <div style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Color Variations 3x3</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/png;base64,${colorGridB64}`} alt="color grid" style={{ maxWidth: '100%', borderRadius: 12, boxShadow: '0 0 0 1px rgba(255,255,255,0.12),0 4px 24px -4px rgba(0,0,0,0.5)' }} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
            <button onClick={() => downloadB64PNG('mini-color-grid-3x3', colorGridB64, baseW * 3, baseH * 3)} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 6, background: '#0a84ff', color: '#fff', border: 'none', cursor: 'pointer' }}>Download Grid</button>
          </div>
        </div>
      )}
      {busy && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: '#111', padding: '24px 32px', borderRadius: 16, color: '#eee', fontSize: 14, lineHeight: 1.5 }}>
            Generating… Please wait.
          </div>
        </div>
      )}
    </main>
  );
}
