"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { PALETTES, PaletteId } from "@/lib/palettes";
// ローカル再配色パスは削除し、クラウド(モデル)生成のみ利用
import { sizeFromFile, sizeFromB64, enforceSizeB64 as enforceSizeB64Strict, downloadB64PNG, clampLongEdgeSize } from "@/lib/size-utils";
import { sizeHint } from "@/lib/prompt-size-hint";
// 色バリエーションではなくポーズバリエーションへ変更
import { poseGridPrompt, hiResPosePrompt } from "@/lib/prompt-poses";
import { colorGridPrompt } from "@/lib/prompt-variations";
import { UNIVERSAL_PROMPT } from "@/lib/prompt-universal";
import { GoogleGenAI } from "@google/genai";

type UIState = "idle" | "working" | "done" | "error";

export default function Page() {
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [resultB64, setResultB64] = useState("");
  const [poseGridB64, setPoseGridB64] = useState("");
  const [colorGridB64, setColorGridB64] = useState("");
  const [generatingColor, setGeneratingColor] = useState(false);
  const [state, setState] = useState<UIState>("idle");
  const [error, setError] = useState("");
  const [paletteId, setPaletteId] = useState<PaletteId>("classic9");
  const [baseW, setBaseW] = useState<number>(0);
  const [baseH, setBaseH] = useState<number>(0);
  const [personW, setPersonW] = useState<number>(0);
  const [personH, setPersonH] = useState<number>(0);
  const [itemW, setItemW] = useState<number>(0);
  const [itemH, setItemH] = useState<number>(0);
  // 高画質単体出力
  const [hiResPoseB64, setHiResPoseB64] = useState("");
  const [hiResIndex, setHiResIndex] = useState<number | null>(null); // 選択セル
  const [hiResLoading, setHiResLoading] = useState(false);
  const [hiResW, setHiResW] = useState(0);
  const [hiResH, setHiResH] = useState(0);
  const personInputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const handleFilePick = useCallback(async (kind: "person" | "item", files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("画像ファイルを選択してください"); return; }
    if (kind === "person") {
      setPersonFile(file);
      // 基準サイズ記録（人物）
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

  const buildDropHandlers = (kind: "person" | "item") => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); handleFilePick(kind, e.dataTransfer.files); },
    onClick: () => { (kind === "person" ? personInputRef : itemInputRef).current?.click(); }
  });

  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || "";
  const ai = useMemo(() => (apiKey ? new GoogleGenAI({ apiKey }) : null), [apiKey]);

  const toInlineData = useCallback(async (f: File) => {
    const MAX_BYTES = 8 * 1024 * 1024; // 8MB 上限
    if (f.size > MAX_BYTES) {
      throw new Error(`ファイルが大きすぎます (${(f.size / 1024 / 1024).toFixed(2)}MB) 上限 ${(MAX_BYTES / 1024 / 1024)}MB`);
    }
    const b64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("ファイル読み込みに失敗しました"));
      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== "string") return reject(new Error("データURL取得に失敗"));
        const comma = result.indexOf(",");
        if (comma === -1) return reject(new Error("Base64形式を解析できません"));
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(f);
    });
    return { inlineData: { mimeType: f.type || "image/png", data: b64 } };
  }, []);

  const run = useCallback(async () => {
    try {
      setError("");
      if (!apiKey) { setError("APIキーが設定されていません (.env.local) "); return; }
  if (!personFile || !itemFile) { setError("人物画像とアイテム画像を両方選択してください"); return; }
  if (!baseW || !baseH) { setError("人物画像サイズ取得に失敗"); return; }
      setState("working");
      const person = await toInlineData(personFile);
      const item = await toInlineData(itemFile);
  const contents = [{ text: `${UNIVERSAL_PROMPT}\n${sizeHint(baseW, baseH)}` }, person, item];
      const response = await ai!.models.generateContent({ model: "gemini-2.5-flash-image-preview", contents });
      type Part = { inlineData?: { data?: string } };
      const parts: Part[] = (response.candidates?.[0]?.content?.parts ?? []) as Part[];
      const imgPart = parts.find(p => p.inlineData?.data);
      if (!imgPart?.inlineData?.data) throw new Error("画像が返りませんでした");
  // 返却画像を強制リサイズ（モデルがサイズを守らないケースに備える）
  const normalized = await enforceSizeB64Strict(imgPart.inlineData.data, baseW, baseH, 'cover');
  setResultB64(normalized);
      setState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setState("error");
    }
  }, [apiKey, ai, personFile, itemFile, toInlineData]);

  const generatePoseGrid = useCallback( async () => {
    try {
      setError("");
      if (!resultB64) { setError("先に合成画像を生成してください"); return; }
      if (!baseW || !baseH) { setError("基準サイズ未取得"); return; }
      if (!apiKey) { setError("APIキー未設定"); return; }
      setState("working");
      const parts: any[] = [
        { text: `${poseGridPrompt(baseW, baseH)}\n${sizeHint(baseW*3, baseH*3)}` },
        { inlineData: { mimeType: 'image/png', data: resultB64 } }
      ];
      if (itemFile) {
        const itemInline = await toInlineData(itemFile);
        parts.push(itemInline);
      }
      const res = await ai!.models.generateContent({ model: 'gemini-2.5-flash-image-preview', contents: parts });
      const gridPart = (res.candidates?.[0]?.content?.parts || []).find((p: any)=> p.inlineData?.data);
      if(!gridPart?.inlineData?.data) throw new Error('ポーズグリッドが返りませんでした');
      const rawB64 = gridPart.inlineData.data;
      const { w: rawW, h: rawH } = await sizeFromB64(rawB64);
      const colsApprox = Math.round(rawW / baseW);
      const rowsApprox = Math.round(rawH / baseH);
      const ok = Math.abs(rawW - baseW*3) <= 2 && Math.abs(rawH - baseH*3) <= 2 && colsApprox === 3 && rowsApprox === 3;
      if (!ok) {
        // 不一致でもそのまま表示 (ユーザ要求) - サイズ強制せずオリジナル
        console.warn(`Pose grid layout mismatch (expected 3x3). Detected ~${colsApprox}x${rowsApprox} px:${rawW}x${rawH}`);
        setPoseGridB64(rawB64); // そのまま保存
        setState('done');
        return;
      }
      const normalizedGrid = await enforceSizeB64Strict(rawB64, baseW*3, baseH*3, 'cover');
      setPoseGridB64(normalizedGrid);
      setState('done');
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); setState('error');
    }
  }, [apiKey, ai, resultB64, baseW, baseH, itemFile, toInlineData]);

  // 単体高画質バリエーション生成 (指定インデックス / パレットの色)
  const generateHighResPose = useCallback(async (idx: number) => {
    try {
      setError("");
      if (!apiKey) { setError("APIキー未設定"); return; }
      if (!poseGridB64) { setError("ポーズグリッドがありません"); return; }
      if (!baseW || !baseH) { setError("基準サイズ未取得"); return; }
      if (idx < 0 || idx > 8) { setError("インデックス不正"); return; }
      setHiResLoading(true);
      setHiResPoseB64("");
      setHiResIndex(idx);
      // アップスケール倍率 (過度な拡大を避けつつ画質向上)
      const upscale = (Math.max(baseW, baseH) >= 1100) ? 1.25 : 2;
      let targetW = Math.round(baseW * upscale);
      let targetH = Math.round(baseH * upscale);
      const longEdge = Math.max(targetW, targetH);
      if (longEdge > 2048) {
        const scale = 2048 / longEdge;
        targetW = Math.round(targetW * scale);
        targetH = Math.round(targetH * scale);
      }
      // 3x3 グリッドを分割抽出して対象セルをハイレゾ再生成する方式
      // まず対象セルを crop して参照として与える
      const cellCanvas = document.createElement('canvas');
      const cellW = baseW; const cellH = baseH; // 元サイズを想定
      cellCanvas.width = cellW; cellCanvas.height = cellH;
      const ctx = cellCanvas.getContext('2d');
      if (!ctx) throw new Error('Canvas未サポート');
      const gridImg = new Image();
      gridImg.src = `data:image/png;base64,${poseGridB64}`;
      await new Promise(res=> { gridImg.onload = () => res(null); });
      const col = idx % 3; const row = Math.floor(idx/3);
      ctx.drawImage(gridImg, col*cellW, row*cellH, cellW, cellH, 0,0, cellW, cellH);
      const cellDataUrl = cellCanvas.toDataURL('image/png');
      const cellB64 = cellDataUrl.split(',')[1];
      const prompt = `${hiResPosePrompt()}\n${sizeHint(targetW, targetH)}`;
      const parts: any[] = [
        { text: prompt },
        { inlineData: { mimeType: 'image/png', data: cellB64 } }, // 低解像度セル参照
        { inlineData: { mimeType: 'image/png', data: resultB64 } } // 元合成(アイデンティティ/服装保持)
      ];
      const response = await ai!.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: parts
      });
      const part = (response.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data);
      if (!part?.inlineData?.data) throw new Error('高画質ポーズ生成失敗');
      const normalized = await enforceSizeB64Strict(part.inlineData.data, targetW, targetH, 'cover');
      setHiResPoseB64(normalized);
      setHiResW(targetW); setHiResH(targetH);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHiResLoading(false);
    }
  }, [apiKey, ai, poseGridB64, resultB64, baseW, baseH]);

  // 表示用縮小寸法計算（実データはフル解像度保持）
  const displayDims = useMemo(()=>{
    if(!baseW || !baseH) return null;
    const MAX_LONG = 480; // 単体表示の長辺上限
    const scale = Math.min(1, MAX_LONG / Math.max(baseW, baseH));
    return { w: Math.round(baseW * scale), h: Math.round(baseH * scale), scale };
  }, [baseW, baseH]);

  const gridDisplayDims = useMemo(()=>{
    if(!baseW || !baseH) return null;
    const gridW = baseW * 3; const gridH = baseH * 3;
    const MAX_LONG = 780; // グリッド表示長辺上限
    const scale = Math.min(1, MAX_LONG / Math.max(gridW, gridH));
    return { w: Math.round(gridW * scale), h: Math.round(gridH * scale), scale };
  }, [baseW, baseH]);

  // 3x3 カラーグリッド生成
  const generateColorGrid = useCallback(async () => {
    try {
      setError("");
      if (!resultB64) { setError("先に合成画像を生成してください"); return; }
      if (!baseW || !baseH) { setError("基準サイズ未取得"); return; }
      if (!apiKey) { setError("APIキー未設定"); return; }
      setGeneratingColor(true);
      const colors = PALETTES[paletteId].colors;
      const parts: any[] = [
        { text: `${colorGridPrompt(colors, baseW, baseH)}\n${sizeHint(baseW*3, baseH*3)}` },
        { inlineData: { mimeType: 'image/png', data: resultB64 } }
      ];
      if (itemFile) {
        const itemInline = await toInlineData(itemFile);
        parts.push(itemInline);
      }
      const res = await ai!.models.generateContent({ model: 'gemini-2.5-flash-image-preview', contents: parts });
      const gridPart = (res.candidates?.[0]?.content?.parts || []).find((p: any)=> p.inlineData?.data);
      if(!gridPart?.inlineData?.data) throw new Error('カラーグリッドが返りませんでした');
      const rawB64 = gridPart.inlineData.data;
      const { w: rawW, h: rawH } = await sizeFromB64(rawB64);
      const colsApprox = Math.round(rawW / baseW);
      const rowsApprox = Math.round(rawH / baseH);
      const ok = Math.abs(rawW - baseW*3) <= 2 && Math.abs(rawH - baseH*3) <= 2 && colsApprox === 3 && rowsApprox === 3;
      if (!ok) {
        console.warn(`Color grid layout mismatch (expected 3x3). Detected ~${colsApprox}x${rowsApprox} px:${rawW}x${rawH}`);
        setColorGridB64(rawB64); // 生で表示
        return;
      }
      const normalized = await enforceSizeB64Strict(rawB64, baseW*3, baseH*3, 'cover');
      setColorGridB64(normalized);
    } catch(e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setGeneratingColor(false);
    }
  }, [apiKey, ai, resultB64, baseW, baseH, itemFile, paletteId, toInlineData]);

  return (
    <main className="container fade-in fx-scroll-soft" aria-labelledby="app-title">
      {(state === 'working' || generatingColor || hiResLoading) && (
        <div className="fx-busy-overlay" role="status" aria-live="assertive" aria-label="生成処理中">
          <div className="fx-busy-box">
            <div className="fx-spinner" aria-hidden="true">
              <svg viewBox="0 0 50 50">
                <circle cx="25" cy="25" r="20" />
              </svg>
            </div>
            <div className="fx-busy-title">画像生成中…</div>
            <div className="fx-busy-progress" aria-hidden="true" />
            <p className="fx-busy-sub">
              モデルへのリクエストを処理しています。<br />
              そのままお待ちください。
            </p>
          </div>
        </div>
      )}
      <header className="title-band fade-in">
        <div className="title-band-inner">
          <h1 id="app-title" className="app-title">Fashion Fusion <span className="fx-badge" aria-label="preview version">Preview</span></h1>
          <div className="hero-accent" aria-hidden="true" />
          <p className="subtitle">人物 + ファッションアイテム画像をアップロードし、Universal プロンプトで自然合成と色バリエーション生成を行うミニツール。</p>
        </div>
      </header>

      <div className="upload-grid">
        <div className="card fx-glow-ring">
          <div className="card-header">1. 画像アップロード</div>
          <div className="fx-grid">
            <div
              className={`upload-zone ${personFile ? 'has-file' : ''}`}
              {...buildDropHandlers('person')}
              aria-label="人物画像を選択 (クリック / ドラッグ&ドロップ)"
            >
              {personFile ? (
                <div className="upload-inner" style={{justifyContent:'center',alignItems:'center',minHeight:168}}>
                  <strong className="text-secondary" style={{ fontSize: 12 }}>人物画像</strong>
                  <span className="file-name" title={personFile.name}>{personFile.name}</span>
                  {(() => {
                    let w = personW || 0; let h = personH || 0;
                    const LONG_MAX = 140; const SHORT_MIN = 90;
                    if (w && h) {
                      let scale = Math.min(1, LONG_MAX / Math.max(w, h));
                      if (Math.min(w, h) * scale < SHORT_MIN) {
                        scale = SHORT_MIN / Math.min(w, h);
                      }
                      if (Math.max(w * scale, h * scale) > LONG_MAX) {
                        const adjust = LONG_MAX / Math.max(w * scale, h * scale);
                        scale *= adjust;
                      }
                      w = Math.round(w * scale); h = Math.round(h * scale);
                    } else { w = 140; h = 140; }
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt="人物プレビュー"
                        className="thumb"
                        src={URL.createObjectURL(personFile)}
                        style={{ width: w, height: h, objectFit: 'contain', background: 'var(--fx-surface-alt,transparent)', borderRadius: 6, display:'block', margin:'0 auto', maxWidth:'min(140px,90vw)', maxHeight:'min(140px,40vh)', minWidth:'40px', minHeight:'40px' }}
                        onLoad={e => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                      />
                    );
                  })()}
                  {personW && personH && (
                    <span style={{fontSize:10, opacity:.7, marginTop:4}}>{personW}×{personH}</span>
                  )}
                  <button type="button" className="fx-btn-outline fx-btn fx-btn-tone-plain" style={{ fontSize: 12, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); setPersonFile(null); }}>クリア</button>
                </div>
              ) : (
                <div className="upload-placeholder">
                  <span className="fx-section-title" style={{ marginBottom: 6 }}>人物画像</span>
                  <p className="note" style={{ fontSize: 12.5 }}>クリック or ドロップ<br />PNG / JPG / WEBP</p>
                </div>
              )}
              <input
                ref={personInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={e => handleFilePick('person', e.target.files)}
              />
            </div>

            <div
              className={`upload-zone ${itemFile ? 'has-file' : ''}`}
              {...buildDropHandlers('item')}
              aria-label="アイテム画像を選択 (クリック / ドラッグ&ドロップ)"
            >
              {itemFile ? (
                <div className="upload-inner">
                  <strong className="text-secondary" style={{ fontSize: 12 }}>アイテム画像</strong>
                  <span className="file-name" title={itemFile.name}>{itemFile.name}</span>
                  {(() => {
                    let w = itemW || 0; let h = itemH || 0;
                    const LONG_MAX = 140; const SHORT_MIN = 90;
                    if (w && h) {
                      let scale = Math.min(1, LONG_MAX / Math.max(w, h));
                      if (Math.min(w, h) * scale < SHORT_MIN) {
                        scale = SHORT_MIN / Math.min(w, h);
                      }
                      if (Math.max(w * scale, h * scale) > LONG_MAX) {
                        const adjust = LONG_MAX / Math.max(w * scale, h * scale);
                        scale *= adjust;
                      }
                      w = Math.round(w * scale); h = Math.round(h * scale);
                    } else { w = 140; h = 140; }
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt="アイテムプレビュー"
                        className="thumb"
                        src={URL.createObjectURL(itemFile)}
                        style={{ width: w, height: h, objectFit: 'contain', background: 'var(--fx-surface-alt,transparent)', borderRadius: 6, display:'block', margin:'0 auto', maxWidth:'min(140px,90vw)', maxHeight:'min(140px,40vh)', minWidth:'40px', minHeight:'40px' }}
                        onLoad={e => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
                      />
                    );
                  })()}
                  {itemW && itemH && (
                    <span style={{fontSize:10, opacity:.7, marginTop:4}}>{itemW}×{itemH}</span>
                  )}
                  <button type="button" className="fx-btn-outline fx-btn fx-btn-tone-plain" style={{ fontSize: 12, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); setItemFile(null); }}>クリア</button>
                </div>
              ) : (
                <div className="upload-placeholder">
                  <span className="fx-section-title" style={{ marginBottom: 6 }}>アイテム画像</span>
                  <p className="note" style={{ fontSize: 12.5 }}>クリック or ドロップ<br />PNG / JPG / WEBP</p>
                </div>
              )}
              <input
                ref={itemInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={e => handleFilePick('item', e.target.files)}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="fx-divider" />

      <div className="actions-bar">
        <button className="fx-btn fx-pulse" onClick={run} disabled={state === 'working'}>
          {state === 'working' ? '合成中…' : '合成する'}
        </button>
        {state === 'working' && <span className="chip">生成中</span>}
        {error && <span className="error-text" role="alert">{error}</span>}
        {resultB64 && state === 'done' && <span className="chip status-chip-success">Done</span>}
      </div>

      {resultB64 && (
        <div className="card fx-glow-ring fade-in section-block">
          <div className="card-header">
            <span>結果</span>
            <span className="chip">1</span>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="result-img"
            alt="result"
            src={`data:image/png;base64,${resultB64}`}
            style={displayDims ? { width: displayDims.w, height: displayDims.h, objectFit: 'contain', borderRadius: 12, display:'block', margin:'0 auto', maxWidth:'min(480px,96vw)', maxHeight:'min(480px,60vh)' } : {}}
          />
          {displayDims && displayDims.scale < 1 && (
            <p className="note" style={{marginTop:6,fontSize:11}}>表示縮小 {Math.round(displayDims.scale*100)}% （元 {baseW}×{baseH}）</p>
          )}
          <div className="result-actions">
            <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> downloadB64PNG('composite', resultB64, baseW, baseH)}>保存</button>
            <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={() => setResultB64("")}>クリア</button>
            <select aria-label="カラーパレット" className="fx-input palette-select" value={paletteId} disabled={state==='working' || generatingColor} onChange={e=> setPaletteId(e.target.value as PaletteId)}>
              {Object.entries(PALETTES).map(([id,p]) => <option key={id} value={id}>{p.label}</option>)}
            </select>
            <button className="fx-btn-outline fx-btn" disabled={state === 'working' || generatingColor} onClick={generatePoseGrid}>3×3ポーズ生成</button>
            <button className="fx-btn-outline fx-btn" disabled={state==='working' || generatingColor} onClick={generateColorGrid}>{generatingColor? 'カラー生成中…' : '3×3カラー生成'}</button>
          </div>
          <p className="note" style={{ marginTop: 12 }}>生成画像には不可視の SynthID が含まれる場合があります。商用利用前に利用規約を確認してください。</p>
          {poseGridB64 && (
            <div className="section-block">
              <div className="card-header" style={{ marginBottom: 10 }}>ポーズバリエ (3×3)</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="result-img"
                alt="pose grid"
                src={`data:image/png;base64,${poseGridB64}`}
                style={gridDisplayDims ? { width: gridDisplayDims.w, height: gridDisplayDims.h, objectFit: 'contain', borderRadius: 12, display:'block', margin:'0 auto', maxWidth:'min(780px,98vw)', maxHeight:'min(780px,60vh)' } : {}}
              />
              {gridDisplayDims && gridDisplayDims.scale < 1 && (
                <p className="note" style={{marginTop:6,fontSize:11}}>表示縮小 {Math.round(gridDisplayDims.scale*100)}% （元 {baseW*3}×{baseH*3}）</p>
              )}
              <div className="result-actions">
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> downloadB64PNG('pose-grid-3x3', poseGridB64, baseW*3, baseH*3)}>ポーズ保存</button>
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={() => setPoseGridB64("")}>グリッド削除</button>
              </div>
              {/* 3×3 セル対応高画質生成ボタン */}
              <div style={{ marginTop: 16 }}>
                <div className="card-header" style={{ marginBottom: 8 }}>高画質ポーズ単体生成 (セル選択)</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:8}}>
                  {Array.from({length:9}).map((_,i)=>{
                    const disabled = hiResLoading || state==='working';
                    return (
                      <button
                        key={i}
                        className="fx-btn-outline fx-btn fx-btn-tone-plain"
                        style={{padding:'6px 4px',fontSize:12,lineHeight:1.2}}
                        disabled={disabled}
                        onClick={()=> generateHighResPose(i)}
                        aria-label={`セル ${i+1} の高画質生成`}
                      >
                        {hiResLoading && hiResIndex===i ? '生成中…' : `セル ${i+1}`}
                      </button>
                    );
                  })}
                </div>
                <p className="note" style={{marginTop:8,fontSize:11}}>任意のセルを選ぶとそのポーズを高精細化して再生成します (服装・顔は維持)。</p>
              </div>
            </div>
          )}
          {colorGridB64 && (
            <div className="section-block">
              <div className="card-header" style={{ marginBottom: 10 }}>カラー バリエ (3×3)</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="result-img"
                alt="color grid"
                src={`data:image/png;base64,${colorGridB64}`}
                style={gridDisplayDims ? { width: gridDisplayDims.w, height: gridDisplayDims.h, objectFit: 'contain', borderRadius: 12, display:'block', margin:'0 auto', maxWidth:'min(780px,98vw)', maxHeight:'min(780px,60vh)' } : {}}
              />
              {gridDisplayDims && gridDisplayDims.scale < 1 && (
                <p className="note" style={{marginTop:6,fontSize:11}}>表示縮小 {Math.round(gridDisplayDims.scale*100)}% （元 {baseW*3}×{baseH*3}）</p>
              )}
              <div className="result-actions">
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> downloadB64PNG('color-grid-3x3', colorGridB64, baseW*3, baseH*3)}>カラー保存</button>
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> setColorGridB64("")}>グリッド削除</button>
              </div>
              <p className="note" style={{marginTop:8,fontSize:11}}>人物・背景は維持し衣装部分のみ色替え。</p>
            </div>
          )}
          {hiResPoseB64 && (
            <div className="section-block">
              <div className="card-header" style={{ marginBottom: 10 }}>高画質ポーズ結果 (セル {hiResIndex !== null ? hiResIndex+1 : '-'} )</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="result-img"
                alt="high-res pose"
                src={`data:image/png;base64,${hiResPoseB64}`}
                style={{
                  maxWidth: 'min(620px,96vw)',
                  width: hiResW || baseW,
                  height: hiResH || baseH,
                  aspectRatio: `${hiResW || baseW}/${hiResH || baseH}`,
                  borderRadius: 14,
                  objectFit: 'contain',
                  display:'block',
                  margin:'0 auto',
                  maxHeight: '60vh'
                }}
              />
              <div className="result-actions">
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> downloadB64PNG(`pose-cell-${(hiResIndex??0)+1}-hires`, hiResPoseB64, hiResW, hiResH)}>保存</button>
                <button className="fx-btn-outline fx-btn fx-btn-tone-plain" onClick={()=> setHiResPoseB64("")}>クリア</button>
              </div>
            </div>
          )}
        </div>
      )}

      <footer>
        Model: gemini-2.5-flash-image-preview · Front-end prototype
      </footer>
    </main>
  );
}
