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
import { buildCompositePrompt, buildPoseGridPrompt, buildColorGridPrompt, buildHiResPosePrompt, buildGarmentMaskPrompt } from "@/lib/prompt-builders";
// Removed direct GoogleGenAI usage on client; now proxied via /api/genai
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
  async function sampleBorderRGB(b64: string, w: number, h: number): Promise<{ r:number; g:number; b:number }> {
    return await new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); if (!ctx) return reject(new Error('Canvas 2D unavailable'));
            ctx.drawImage(img, 0, 0, w, h);
            const strip = Math.max(4, Math.round(Math.min(w, h) * 0.02));
            const data = ctx.getImageData(0, 0, w, h).data;
            let sr=0,sg=0,sb=0,cnt=0;
            const push=(x:number,y:number)=>{const i=(y*w+x)*4; sr+=data[i]; sg+=data[i+1]; sb+=data[i+2]; cnt++;};
            for (let x=0;x<w;x++){for(let y=0;y<strip;y++)push(x,y);for(let y=h-strip;y<h;y++)push(x,y);} 
            for (let y=strip;y<h-strip;y++){for(let x=0;x<strip;x++)push(x,y);for(let x=w-strip;x<w;x++)push(x,y);} 
            resolve({ r:Math.round(sr/cnt), g:Math.round(sg/cnt), b:Math.round(sb/cnt) });
          } catch(err){ reject(err instanceof Error?err:new Error('Border sampling failed')); }
        };
        img.onerror=()=>reject(new Error('Image decode failed'));
        img.src=`data:image/png;base64,${b64}`;
      } catch(e){ reject(e instanceof Error?e:new Error('Border sampling error')); }
    });
  }

  async function sampleFaceApproxRGB(b64: string, w: number, h: number): Promise<{ r:number; g:number; b:number }> {
    return await new Promise((resolve, reject) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext('2d'); if (!ctx) return reject(new Error('Canvas 2D unavailable'));
            ctx.drawImage(img,0,0,w,h);
            const fx=Math.round(w*0.3), fw=Math.round(w*0.4); const fy=Math.round(h*0.08), fh=Math.round(h*0.22);
            const data=ctx.getImageData(fx,fy,fw,fh).data; let sr=0,sg=0,sb=0; const len=data.length/4; for(let i=0;i<data.length;i+=4){sr+=data[i];sg+=data[i+1];sb+=data[i+2];}
            resolve({ r:Math.round(sr/len), g:Math.round(sg/len), b:Math.round(sb/len)});
          } catch(err){ reject(err instanceof Error?err:new Error('Face sampling failed')); }
        };
        img.onerror=()=>reject(new Error('Image decode failed'));
        img.src=`data:image/png;base64,${b64}`;
      } catch(e){ reject(e instanceof Error?e:new Error('Face sampling error')); }
    });
  }

  const run = useCallback(async () => {
    try {
      setError("");
  // APIキーはサーバ側。ここでは不要。
  if (!personFile || !itemFile) { setError("Please select both a person image and an item image"); return; }
  if (!baseW || !baseH) { setError("Failed to get person image size"); return; }
      setState("working");
      const person = await toInlineData(personFile);
      const item = await toInlineData(itemFile);
  // Single attempt
      const prompt = buildCompositePrompt(baseW, baseH);
  const response = await callGenAI({ prompt, images: [ person.inlineData, item.inlineData ].map(p => ({ data: p.data!, mimeType: p.mimeType })) });
  if (!response.imageB64) throw new Error('No image returned');
  const rawB64 = response.imageB64;
  // Obtain model output size
      let outW = baseW, outH = baseH;
      try {
        const { w, h } = await sizeFromB64(rawB64);
        outW = w; outH = h;
      } catch (e) {
        console.warn('[composite] sizeFromB64 failed, using base size', e);
      }
      const outAspect = outW / outH;
      const baseAspect = baseW / baseH;
      const aspectDiff = Math.abs(outAspect - baseAspect);
      if (aspectDiff <= 0.04) {
  // Close aspect ratio → normalize to base size
        const normalized = await enforceSizeB64Strict(rawB64, baseW, baseH, 'cover');
        setResultB64(normalized);
        setCompW(baseW); setCompH(baseH);
      } else {
  // Divergent → adopt model output aspect (scale down if >2048)
        let finalW = outW, finalH = outH;
        const longEdge = Math.max(finalW, finalH);
        let finalB64 = rawB64;
        if (longEdge > 2048) {
          const s = 2048 / longEdge;
          finalW = Math.round(finalW * s);
          finalH = Math.round(finalH * s);
          const img = new Image();
          img.src = `data:image/png;base64,${rawB64}`;
          await new Promise(res => { img.onload = () => res(null); });
          const canvas = document.createElement('canvas');
          canvas.width = finalW; canvas.height = finalH;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, finalW, finalH);
            finalB64 = canvas.toDataURL('image/png').split(',')[1];
          }
        }
        setResultB64(finalB64);
        setCompW(finalW); setCompH(finalH);
        console.warn('[composite] adopt model aspect', { outW, outH, baseW, baseH });
      }
      setState('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState('error');
    }
  }, [personFile, itemFile, toInlineData, baseW, baseH]);

  const generatePoseGrid = useCallback(async () => {
    try {
      setError("");
      if (!resultB64) { setError('Generate a composite first'); return; }
      if (!baseW || !baseH) { setError('Base size not available'); return; }
  // key handled server-side
      setState('working');
      const cellW = compW || baseW; const cellH = compH || baseH;
      const gridW = cellW * 3; const gridH = cellH * 3;
      const posePrompt = buildPoseGridPrompt(cellW, cellH) + '\nMODE=pose_variations_from_composite';
      interface InlinePart { inlineData: { mimeType: string; data: string } }
      interface TextPart { text: string }
      type ContentPart = InlinePart | TextPart;
      // Use the already generated composite as the single reference image
      const compositeInline: InlinePart = { inlineData: { mimeType: 'image/png', data: resultB64 } };
      const parts: ContentPart[] = [ { text: posePrompt }, compositeInline ];
  const res = await callGenAI({ prompt: posePrompt, images: [ { data: resultB64, mimeType: 'image/png' } ] });
  if (!res.imageB64) throw new Error('Pose grid not returned');
  const raw = res.imageB64;
      const normalized = await enforceSizeB64Strict(raw, gridW, gridH, 'cover');
      const { w: gotW, h: gotH } = await sizeFromB64(normalized);
      const colInt = Math.round(gotW / cellW); const rowInt = Math.round(gotH / cellH);
      if (!(gotW === gridW && gotH === gridH && colInt === 3 && rowInt === 3)) {
        throw new Error(`Not 3x3 (${colInt}x${rowInt})`);
      }
      setPoseGridB64(normalized);
      setState('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); setState('error');
    }
  }, [resultB64, baseW, baseH, compW, compH]);

  // High-res single-cell variation generation (specified index / palette color)
  const generateHighResPose = useCallback(async (idx: number) => {
    try {
      setError("");
  // server will hold key
  // Which grid to crop from (use latest selection via ref)
      const source = hiResSourceRef.current;
      const gridB64 = source === 'pose' ? poseGridB64 : colorGridB64;
  if (!gridB64) { setError(source === 'pose' ? "No pose grid" : "No color grid"); return; }
  if (!baseW || !baseH) { setError("Base size not available"); return; }
  if (idx < 0 || idx > 8) { setError("Invalid index"); return; }
      setHiResLoading(true);
      setHiResPoseB64("");
      setHiResIndex(idx);
      const baseForHiResW = compW || baseW;
      const baseForHiResH = compH || baseH;
      const upscale = (Math.max(baseForHiResW, baseForHiResH) >= 1100) ? 1.25 : 2;
      let targetW = Math.round(baseForHiResW * upscale);
      let targetH = Math.round(baseForHiResH * upscale);
      const longEdge = Math.max(targetW, targetH);
      if (longEdge > 2048) {
        const scale = 2048 / longEdge;
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetH * scale);
      }
  // Split 3x3 grid, crop target cell, and re-generate at higher resolution
  // First crop the target cell and supply it as a reference
      const cellCanvas = document.createElement('canvas');
      const cellW = baseForHiResW; const cellH = baseForHiResH;
      cellCanvas.width = cellW; cellCanvas.height = cellH;
      const ctx = cellCanvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not supported');
      const gridImg = new Image();
      gridImg.src = `data:image/png;base64,${gridB64}`;
      await new Promise(res => { gridImg.onload = () => res(null); });
      const col = idx % 3; const row = Math.floor(idx / 3);
      ctx.drawImage(gridImg, col * cellW, row * cellH, cellW, cellH, 0, 0, cellW, cellH);
      const cellDataUrl = cellCanvas.toDataURL('image/png');
      const cellB64 = cellDataUrl.split(',')[1];
      const prompt = `${buildHiResPosePrompt()}\n${sizeHint(targetW, targetH)}`;
      interface InlinePart { inlineData: { mimeType: string; data: string }; }
      interface TextPart { text: string; }
      type ContentPart = TextPart | InlinePart;
      const parts: ContentPart[] = [
        { text: prompt },
        { inlineData: { mimeType: 'image/png', data: cellB64 } },
        { inlineData: { mimeType: 'image/png', data: resultB64 } }
      ];
  const response = await callGenAI({ prompt, images: parts.filter(p => 'inlineData' in p).map((p: any) => ({ data: p.inlineData.data, mimeType: p.inlineData.mimeType })) });
  if (!response.imageB64) throw new Error('High-res pose generation failed');
  const normalized = await enforceSizeB64Strict(response.imageB64, targetW, targetH, 'cover');
      setHiResPoseB64(normalized);
      setHiResW(targetW); setHiResH(targetH);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHiResLoading(false);
    }
  }, [poseGridB64, colorGridB64, resultB64, baseW, baseH, compW, compH]);

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

  // Generate 3x3 color composite grid (person + item → 9 color variants)
  const generateColorGrid = useCallback(async () => {
    try {
      setError("");
      if (!personFile) { setError('Upload a person image'); return; }
      if (!itemFile) { setError('Upload a fashion item image'); return; }
      if (!baseW || !baseH) { setError('Base size not available'); return; }
  // key server-side
      setGeneratingColor(true);
      setColorProgress(0);
      // Stage 1: ensure base composite exists (person + original item)
      if (!resultB64) {
        await run(); // this sets resultB64 / compW / compH
        setColorProgress(1); // composite ready
      } else {
        setColorProgress(1); // composite already existed
      }
      // Stage 2 (new): generate garment binary mask via API if not cached
      const maskW = compW || baseW; const maskH = compH || baseH;
      if (!garmentMaskB64) {
        try {
          const maskPrompt = buildGarmentMaskPrompt(maskW, maskH) + '\nMODE=garment_binary_mask_from_composite';
          const compositeInline = { inlineData: { mimeType: 'image/png', data: resultB64 } };
          const itemInline = itemFile ? await toInlineData(itemFile) : null;
          const maskRes = await callGenAI({ prompt: maskPrompt, images: [ { data: resultB64, mimeType: 'image/png' }, ...(itemFile ? [ { data: (await toInlineData(itemFile)).inlineData.data!, mimeType: 'image/png' } ] : []) ] });
          if (!maskRes.imageB64) throw new Error('Mask not returned');
          const normalizedMask = await enforceSizeB64Strict(maskRes.imageB64, maskW, maskH, 'cover');
          setGarmentMaskB64(normalizedMask);
        } catch (err) {
          console.warn('[mask] generation failed, falling back to mask-less recolor', err);
        }
      }
      setColorProgress(2); // mask stage complete (or skipped)
      // Stage 3: single call 3x3 recolor grid from existing composite (garment only recolored) using mask if available
      const origCellW = compW || baseW; const origCellH = compH || baseH;
      const TARGET_LONG = 768;
      const scale = Math.min(1, TARGET_LONG / Math.max(origCellW, origCellH));
      const cellW = Math.round(origCellW * scale);
      const cellH = Math.round(origCellH * scale);
      const gridW = cellW * 3; const gridH = cellH * 3;
      // Lock reference metrics
      let origBorder: { r:number; g:number; b:number } | null = null;
      let origFace: { r:number; g:number; b:number } | null = null;
      try { origBorder = await sampleBorderRGB(resultB64, origCellW, origCellH); } catch {}
      try { origFace = await sampleFaceApproxRGB(resultB64, origCellW, origCellH); } catch {}
      const lockLines: string[] = [];
      if (origBorder) lockLines.push(`GLOBAL_COLOR_LOCK: BORDER_MEAN_RGB=(${origBorder.r},${origBorder.g},${origBorder.b}) tolerance=2`);
      if (origFace) lockLines.push(`FACE_COLOR_LOCK: FACE_MEAN_RGB=(${origFace.r},${origFace.g},${origFace.b}) tolerance=3`);
      lockLines.push('IMMUTABLE_NON_GARMENT: Background, skin, hair, face features, shadows remain pixel-identical (ΔE<2). Garment only recolor.');
      lockLines.push('METHOD: Segment garment -> hue/value remap garment layer only -> composite over original unchanged pixels (no background repaint).');
      if (garmentMaskB64) {
        lockLines.push('MASK_PROVIDED: White region = garment recolor allowed. Black region MUST remain bitwise identical (no hue/brightness/saturation shift). Use strict masked recolor.');
        lockLines.push('DO NOT modify any black pixel even slightly. No global grading.');
      } else {
        lockLines.push('NO_MASK_FALLBACK: Infer garment region internally but still prohibit changes to non-garment pixels.');
      }
      const baseColorPrompt = buildColorGridPrompt([
        '#FF0000','#0055FF','#FFD700','#00B140','#7A00FF','#FF7A00','#000000','#FFFFFF','#808080'
      ], cellW, cellH);
      const colorPrompt = [...lockLines, baseColorPrompt, 'MODE=stage2_recolor_from_composite'].join('\n');
      const compositeInline = { inlineData: { mimeType: 'image/png', data: resultB64 } };
  type TextPart = { text: string };
  type ImagePart = { inlineData: { mimeType: string; data: string } };
  const contentsParts: (TextPart | ImagePart)[] = [ { text: colorPrompt }, compositeInline ];
      if (garmentMaskB64) contentsParts.push({ inlineData: { mimeType: 'image/png', data: garmentMaskB64 } });
      // Repeat composite to further anchor non-garment reference
      contentsParts.push(compositeInline);
      const withTimeout = async <T,>(p: Promise<T>, ms: number, label: string): Promise<T> => {
        return await Promise.race([
          p,
          new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms))
        ]) as T;
      };
      // Retry up to 3 times if non-garment color drift detected
      let normalized: string | null = null;
      const MAX_TRIES = 3;
      for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        const attemptPrompt = colorPrompt + `\nATTEMPT=${attempt}` + (attempt>1 ? '\nREINFORCE: Previous attempt drifted non-garment colors – tighten lock.' : '');
        contentsParts[0] = { text: attemptPrompt }; // replace first text part with attempt-specific prompt
        const res = await withTimeout(
          callGenAI({ prompt: attemptPrompt, images: contentsParts.filter(p => 'inlineData' in p).slice(0).map((p: any) => ({ data: p.inlineData.data, mimeType: p.inlineData.mimeType })) }),
          120000,
          'Color grid'
        );
        if (!res.imageB64) throw new Error('Color grid not returned');
        const candidate = await enforceSizeB64Strict(res.imageB64, gridW, gridH, 'cover');
        try {
          let accept = true;
          if (origBorder) {
            const gridBorder = await sampleBorderRGB(candidate, gridW, gridH);
            const diffBorder = Math.abs(gridBorder.r-origBorder.r) + Math.abs(gridBorder.g-origBorder.g) + Math.abs(gridBorder.b-origBorder.b);
            if (diffBorder > 6) accept = false; // >2 avg per channel
          }
          if (accept && origFace) {
            // Extract first cell region to approximate face area (assuming consistent placement)
            const cellCanvas = document.createElement('canvas'); cellCanvas.width = cellW; cellCanvas.height = cellH;
            const ctx = cellCanvas.getContext('2d');
            if (ctx) {
              const img = new Image(); img.src = `data:image/png;base64,${candidate}`;
              await new Promise(r => { img.onload = () => r(null); });
              ctx.drawImage(img, 0, 0, cellW, cellH, 0, 0, cellW, cellH);
              const firstCellB64 = cellCanvas.toDataURL('image/png').split(',')[1];
              const faceNow = await sampleFaceApproxRGB(firstCellB64, cellW, cellH);
              const diffFace = Math.abs(faceNow.r-origFace.r) + Math.abs(faceNow.g-origFace.g) + Math.abs(faceNow.b-origFace.b);
              if (diffFace > 9) accept = false; // >3 avg per channel
            }
          }
          if (accept) { normalized = candidate; break; }
          if (attempt === MAX_TRIES) {
            normalized = candidate; console.warn('[color-grid] accepting last attempt with drift');
          } else {
            // retry
          }
        } catch (e) {
          // If sampling fails, accept candidate to avoid infinite loop
          normalized = candidate;
          break;
        }
      }
      if (!normalized) throw new Error('Color grid generation failed after retries');
      const { w: gotW, h: gotH } = await sizeFromB64(normalized);
      const colInt = Math.round(gotW / cellW); const rowInt = Math.round(gotH / cellH);
      if (!(gotW === gridW && gotH === gridH && colInt === 3 && rowInt === 3)) {
        throw new Error(`Not 3x3 (${colInt}x${rowInt})`);
      }
  setColorGridB64(normalized);
  setColorProgress(3);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setGeneratingColor(false);
      setTimeout(() => setColorProgress(0), 800);
    }
  }, [personFile, itemFile, baseW, baseH, compW, compH, run, resultB64, garmentMaskB64, toInlineData]);

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
