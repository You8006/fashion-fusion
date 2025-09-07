"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PaletteId } from "@/lib/palettes";
import { UploadArea } from "./components/UploadArea";
import { ResultPanel } from "./components/ResultPanel";
import { HighResPanel } from "./components/HighResPanel";
// Local recolor path removed – only cloud (model) generation is used now
import { sizeFromFile, sizeFromB64, enforceSizeB64 as enforceSizeB64Strict, downloadB64PNG, clampLongEdgeSize } from "@/lib/size-utils";
import { sizeHint } from "@/lib/prompt-size-hint";
// Legacy prompt helpers removed (now unified via prompt-builders)
import { buildCompositePrompt, buildColorGridPrompt } from "@/lib/prompt-builders";
import { callGenAI } from "@/lib/genai-client";

// Minimal structural type for Gemini image parts to avoid using 'any'
interface GenAIInlinePart { inlineData?: { data?: string; mimeType?: string } }

type UIState = "idle" | "working" | "done" | "error";

export default function Page() {
  // Drag-over state is managed inside UploadArea now
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [resultB64, setResultB64] = useState("");
  // Final adopted composite size (if model output diverges from base person size)
  const [compW, setCompW] = useState(0);
  const [compH, setCompH] = useState(0);
  const [poseGridB64, setPoseGridB64] = useState("");
  const [colorGridB64, setColorGridB64] = useState("");
  const [garmentMaskB64, setGarmentMaskB64] = useState(""); // API-generated binary mask (white garment / black non-garment)
  const [generatingColor, setGeneratingColor] = useState(false);
  const [colorProgress, setColorProgress] = useState<number>(0); // 0..9
  // (Legacy removed) itemColorGridB64 no longer needed; two-call pipeline is: (1) composite, (2) recolor grid
  const [state, setState] = useState<UIState>("idle");
  const [error, setError] = useState("");
  const [paletteId, setPaletteId] = useState<PaletteId>("classic9");
  const [baseW, setBaseW] = useState<number>(0);
  const [baseH, setBaseH] = useState<number>(0);
  const [personW, setPersonW] = useState<number>(0);
  const [personH, setPersonH] = useState<number>(0);
  const [itemW, setItemW] = useState<number>(0);
  const [itemH, setItemH] = useState<number>(0);
  // Fullscreen image viewer state
  const [fullscreen, setFullscreen] = useState<{ kind: 'composite' | 'poseGrid' | 'colorGrid'; b64: string } | null>(null);
  // High-res single cell output
  const [hiResPoseB64, setHiResPoseB64] = useState("");
  const [hiResIndex, setHiResIndex] = useState<number | null>(null); // selected cell index
  const [hiResLoading, setHiResLoading] = useState(false);
  const [hiResW, setHiResW] = useState(0);
  const [hiResH, setHiResH] = useState(0);
  // Which grid type to upscale (pose or color)
  const [hiResSource, setHiResSource] = useState<'pose' | 'color'>('pose');
  const hiResSourceRef = useRef<'pose' | 'color'>('pose');
  const setHiResSourceImmediate = (v: 'pose' | 'color') => { hiResSourceRef.current = v; setHiResSource(v); };
  // Input refs are retained inside UploadArea component

  // Some drag sources yield empty or generic MIME (application/octet-stream); fall back to extension
  const handleFilePick = useCallback(async (kind: "person" | "item", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
  const mime = file.type; // e.g. "image/png" / "" / "application/octet-stream"
    const nameLower = (file.name || "").toLowerCase();
    const extMatch = nameLower.match(/\.([a-z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : "";
    const EXT_WHITELIST = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif", "tif", "tiff"]);
    const looksImageByExt = EXT_WHITELIST.has(ext);
    const looksImageByMime = mime.startsWith("image/");
    if (!looksImageByMime && !looksImageByExt) {
      console.warn("Rejected file (not image)", { name: file.name, type: file.type, size: file.size });
  setError("Please select an image file");
      return;
    }
  // Debug: MIME fallback info (for user issue tracing)
    if (!looksImageByMime && looksImageByExt) {
  console.info("MIME fallback allowed by extension", { name: file.name, inferredExt: ext, originalType: file.type });
    }
    if (kind === "person") {
      setPersonFile(file);
  // Record base size (person)
      const { w, h } = await sizeFromFile(file);
      const { w: cw, h: ch } = clampLongEdgeSize(w, h, 2048);
      setBaseW(cw); setBaseH(ch);
      setPersonW(cw); setPersonH(ch);
    } else {
      setItemFile(file);
      const { w, h } = await sizeFromFile(file);
      setItemW(w); setItemH(h);
    }
  }, []);

  // Old drop handler moved to UploadArea

  // APIキーはクライアントに出さない。存在チェックはサーバ応答エラーで判断。
  const ai = null;

  const toInlineData = useCallback(async (f: File) => {
    const MAX_BYTES = 8 * 1024 * 1024; // 8MB limit
    if (f.size > MAX_BYTES) {
      throw new Error(`File too large (${(f.size / 1024 / 1024).toFixed(2)}MB) – limit ${(MAX_BYTES / 1024 / 1024)}MB`);
    }
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") return reject(new Error("Failed to obtain data URL"));
        const comma = result.indexOf(",");
        if (comma === -1) return reject(new Error("Cannot parse Base64 format"));
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(f);
    });
    return { inlineData: { mimeType: f.type || "image/png", data: b64 } };
  }, []);

  // === Sampling utilities (非衣服領域の色保持) ===
  // Removed border/face sampling & drift detection: simplifying to reduce model confusion & global recolor tendencies.

  const run = useCallback(async () => {
    try {
      setError("");
      if (!personFile || !itemFile) { setError("Please select both a person image and an item image"); return; }
      if (!baseW || !baseH) { setError("Failed to get person image size"); return; }
      setState("working");
      const person = await toInlineData(personFile);
      const item = await toInlineData(itemFile);
      const prompt = buildCompositePrompt(baseW, baseH);
      const response = await callGenAI({ prompt, images: [ person.inlineData, item.inlineData ].map(p => ({ data: p.data!, mimeType: p.mimeType })) });
      if (!response.imageB64) throw new Error('No image returned');
      const rawB64 = response.imageB64;
      let outW = baseW, outH = baseH;
      try { const { w, h } = await sizeFromB64(rawB64); outW = w; outH = h; } catch (e) { console.warn('[composite] sizeFromB64 failed', e); }
      const outAspect = outW / outH;
      const baseAspect = baseW / baseH;
      const aspectDiff = Math.abs(outAspect - baseAspect);
      if (aspectDiff <= 0.04) {
        const normalized = await enforceSizeB64Strict(rawB64, baseW, baseH, 'cover');
        setResultB64(normalized); setCompW(baseW); setCompH(baseH);
      } else {
        let finalW = outW, finalH = outH; let finalB64 = rawB64;
        const longEdge = Math.max(finalW, finalH);
        if (longEdge > 2048) {
          const s = 2048 / longEdge; finalW = Math.round(finalW * s); finalH = Math.round(finalH * s);
          const img = new Image(); img.src = `data:image/png;base64,${rawB64}`;
          await new Promise(res => { img.onload = () => res(null); });
          const canvas = document.createElement('canvas'); canvas.width = finalW; canvas.height = finalH;
          const ctx = canvas.getContext('2d'); if (ctx) { ctx.drawImage(img, 0, 0, finalW, finalH); finalB64 = canvas.toDataURL('image/png').split(',')[1]; }
        }
        setResultB64(finalB64); setCompW(finalW); setCompH(finalH);
      }
      setState('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e); setError(msg); setState('error');
    }
  }, [personFile, itemFile, baseW, baseH, toInlineData]);

  // Display size downscale calculation (full-resolution data retained)
  const displayDims = useMemo(() => {
    const w = compW || baseW; const h = compH || baseH;
    if (!w || !h) return null;
    const MAX_LONG = 480;
    const scale = Math.min(1, MAX_LONG / Math.max(w, h));
    return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
  }, [baseW, baseH, compW, compH]);

  // Simplified grid display dims
  const gridDisplayDims = useMemo(() => {
    const cellW = compW || baseW; const cellH = compH || baseH;
    if (!cellW || !cellH) return null;
    const gridW = cellW * 3; const gridH = cellH * 3;
    const MAX_LONG = 780;
    const scale = Math.min(1, MAX_LONG / Math.max(gridW, gridH));
    return { w: Math.round(gridW * scale), h: Math.round(gridH * scale), scale, origW: gridW, origH: gridH };
  }, [baseW, baseH, compW, compH]);

      
  // Simplified color grid generation (two-call pipeline total: composite + color grid)
  const generateColorGrid = useCallback(async () => {
    try {
      setError("");
      if (!personFile) { setError('Upload a person image'); return; }
      if (!itemFile) { setError('Upload a fashion item image'); return; }
      if (!baseW || !baseH) { setError('Base size not available'); return; }
      setGeneratingColor(true);
      setColorProgress(0);
      if (!resultB64) { await run(); setColorProgress(1); } else { setColorProgress(1); }
      setColorProgress(2);
      const cellW = compW || baseW; const cellH = compH || baseH;
      const gridW = cellW * 3; const gridH = cellH * 3;
      const prompt = buildColorGridPrompt([
        '#FF0000','#0055FF','#FFD700','#00B140','#7A00FF','#FF7A00','#000000','#FFFFFF','#808080'
      ], cellW, cellH);
      const res = await callGenAI({ prompt, images: [ { data: (resultB64 || ''), mimeType: 'image/png' } ] });
      if (!res.imageB64) throw new Error('Color grid not returned');
      const grid = await enforceSizeB64Strict(res.imageB64, gridW, gridH, 'cover');
      setColorGridB64(grid);
      setColorProgress(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingColor(false);
      setTimeout(() => setColorProgress(0), 600);
    }
  }, [personFile, itemFile, baseW, baseH, compW, compH, resultB64, run]);

  // Placeholder (pose grid feature trimmed in this refactor). Keeps UI functional without errors.
  const generatePoseGrid = useCallback(() => {
    console.warn('[generatePoseGrid] placeholder: pose grid generation disabled in simplified refactor');
  }, []);

  // Placeholder high-res (could be re-implemented later)
  const generateHighResPose = useCallback((index: number) => {
    console.warn('[generateHighResPose] placeholder: high-res pose generation disabled', index);
  }, []);

  return (
    <main className="container fade-in fx-scroll-soft" aria-labelledby="app-title">
      {(state === 'working' || generatingColor || hiResLoading) && (
        <div className="fx-busy-overlay" role="alert" aria-live="assertive" aria-label="Generating images">
          <div className="fx-busy-box">
            <div className="fx-busy-title" style={{ marginTop: 4 }}>Generating images…</div>
            <div
              className="fx-busy-progress"
              role="progressbar"
              aria-valuetext="in progress"
              aria-label="progress (indeterminate)"
            />
            <p className="fx-busy-sub" style={{ marginTop: 10 }}>
              Processing requests to the model.<br />
              Please wait.
              {generatingColor && (
                <>
                  <br />
                  {colorProgress === 0 && 'Stage 1: generating base composite'}
                  {colorProgress === 1 && 'Stage 2: generating garment binary mask'}
                  {colorProgress === 2 && 'Stage 3: garment recolor 3x3 grid'}
                  {colorProgress === 3 && 'Finalizing color grid…'}
                </>
              )}
            </p>
          </div>
        </div>
      )}
      <header className="title-band fade-in">
        <div className="title-band-inner">
          <h1 id="app-title" className="app-title">Fashion Fusion <span className="fx-badge" aria-label="preview version">Preview</span></h1>
          <div className="hero-accent" aria-hidden="true" />
          <p className="subtitle">Upload a person image plus a fashion item image, then generate a natural composite and 3x3 color variation grid using the unified universal prompt pipeline.</p>
        </div>
      </header>

      <UploadArea
        personFile={personFile}
        itemFile={itemFile}
        personW={personW} personH={personH} itemW={itemW} itemH={itemH}
        onPick={handleFilePick}
        onClear={(k) => k === 'person' ? setPersonFile(null) : setItemFile(null)}
      />

      <div className="fx-divider" />

      <ResultPanel
        state={state}
        error={error}
        resultB64={resultB64}
        baseW={baseW} baseH={baseH} compW={compW} compH={compH}
        paletteId={paletteId}
        onPalette={setPaletteId}
        onDownloadComposite={() => downloadB64PNG('composite', resultB64, (compW || baseW), (compH || baseH))}
        onClearComposite={() => setResultB64("")}
  onGeneratePose={run}
  onGeneratePoseGrid={generatePoseGrid}
        onGenerateColor={generateColorGrid}
        generatingColor={generatingColor}
        poseGridB64={poseGridB64}
        colorGridB64={colorGridB64}
        gridDisplayDims={gridDisplayDims}
        downloadGrid={(k) => downloadB64PNG(`${k}-grid-3x3`, k === 'pose' ? poseGridB64 : colorGridB64, (compW || baseW) * 3, (compH || baseH) * 3)}
        clearGrid={(k) => k === 'pose' ? setPoseGridB64("") : setColorGridB64("")}
  setShowCompositeFull={(v) => { if (v && resultB64) setFullscreen({ kind: 'composite', b64: resultB64 }); else setFullscreen(null); }}
        displayDims={displayDims}
  onFullscreen={(kind, b64) => setFullscreen({ kind, b64 })}
      />

      <HighResPanel
        poseGridB64={poseGridB64}
        colorGridB64={colorGridB64}
        source={hiResSource}
        hiResPoseB64={hiResPoseB64}
        hiResIndex={hiResIndex}
        hiResLoading={hiResLoading}
        hiResW={hiResW} hiResH={hiResH}
        compW={compW} compH={compH} baseW={baseW} baseH={baseH}
        onGenerate={(i, src) => { setHiResSourceImmediate(src); generateHighResPose(i); }}
        onClear={() => setHiResPoseB64("")}
        download={(label, b64, w, h) => downloadB64PNG(label, b64, w, h)}
      />
      {fullscreen && (
        <div
          onClick={() => setFullscreen(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out', padding: '4vh 4vw' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${fullscreen.b64}`}
            alt={`${fullscreen.kind} fullscreen`}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', boxShadow: '0 0 0 1px rgba(255,255,255,0.15),0 6px 32px -4px rgba(0,0,0,0.6)', borderRadius: 16 }}
          />
        </div>
      )}
    </main>
  );
}
