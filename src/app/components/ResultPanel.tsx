"use client";
import React from 'react';
import { PALETTES, PaletteId } from '@/lib/palettes';

export interface ResultPanelProps {
  state: string;
  error: string;
  resultB64: string;
  baseW: number; baseH: number; compW: number; compH: number;
  paletteId: PaletteId;
  onPalette(id: PaletteId): void;
  onDownloadComposite(): void;
  onClearComposite(): void;
  onGeneratePose(): void;
  onGeneratePoseGrid(): void; // 3x3 ポーズグリッド生成用 (新規追加)
  onGenerateColor(): void;
  generatingPoseGrid: boolean; // 追加: ポーズグリッド生成中
  generatingColor: boolean;
  poseGridB64: string; colorGridB64: string;
  gridDisplayDims: { w: number; h: number; scale: number; origW: number; origH: number } | null;
  downloadGrid(kind: 'pose' | 'color'): void;
  clearGrid(kind: 'pose' | 'color'): void;
  setShowCompositeFull(v: boolean): void;
  displayDims: { w: number; h: number; scale: number } | null;
  // フルスクリーン表示用(新規): composite 以外のグリッド用
  onFullscreen?(kind: 'poseGrid' | 'colorGrid', b64: string): void;
}

export const ResultPanel: React.FC<ResultPanelProps> = ({ state, error, resultB64, baseW, baseH, compW, compH, paletteId, onPalette, onDownloadComposite, onClearComposite, onGeneratePose, onGeneratePoseGrid, onGenerateColor, generatingPoseGrid, generatingColor, poseGridB64, colorGridB64, gridDisplayDims, downloadGrid, clearGrid, setShowCompositeFull, displayDims, onFullscreen }) => {
  return (
    <>
      <div className="actions-bar" role="group" aria-label="Primary Actions">
        <button className="btn" data-variant="primary" onClick={onGeneratePose} disabled={state === 'working'} aria-live="polite">{state === 'working' ? 'Compositing…' : 'Compose'}</button>
        {state === 'working' && <span className="chip" aria-live="assertive">Working</span>}
        {error && <span className="error-text" role="alert" aria-live="assertive">{error}</span>}
        {resultB64 && state === 'done' && <span className="chip status-chip-success" aria-live="polite">Done</span>}
      </div>
      {resultB64 && (
        <div className="card fx-glow-ring fade-in section-block" aria-label="Composite Result">
          <div className="card-header"><span>Result</span><span className="chip">1</span></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="result-img" alt="result" src={`data:image/png;base64,${resultB64}`} style={displayDims ? { cursor: 'zoom-in', width: displayDims.w, height: displayDims.h, objectFit: 'contain', borderRadius: 12, display: 'block', margin: '0 auto', maxWidth: 'min(480px,96vw)', maxHeight: 'min(480px,60vh)' } : {}} onClick={() => setShowCompositeFull(true)} />
          {displayDims && displayDims.scale < 1 && (<p className="note" style={{ marginTop: 6, fontSize: 11 }}>Scaled down {Math.round(displayDims.scale * 100)}% (original {(compW || baseW)}×{(compH || baseH)})</p>)}
          <div className="result-actions" role="group" aria-label="Result Actions">
            <button className="btn" data-variant="outline" onClick={onDownloadComposite}>Download</button>
            <button className="btn" data-variant="outline" onClick={onClearComposite}>Clear</button>
            <select aria-label="Color Palette" className="fx-input palette-select" value={paletteId} disabled={state === 'working' || generatingColor} onChange={e => onPalette(e.target.value as PaletteId)}>
              {Object.entries(PALETTES).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
            </select>
            <button className="btn" data-variant="outline" disabled={state === 'working' || generatingColor || generatingPoseGrid} onClick={onGeneratePoseGrid}>{generatingPoseGrid ? 'Generating Poses…' : 'Generate 3×3 Poses'}</button>
            <button className="btn" data-variant="outline" disabled={state === 'working' || generatingColor} onClick={onGenerateColor}>{generatingColor ? 'Generating Colors…' : 'Generate 3×3 Colors'}</button>
          </div>
          {poseGridB64 && gridDisplayDims && (
            <div className="section-block">
              <div className="card-header" style={{ marginBottom: 10 }}>Pose Variations (3×3)</div>
              <img className="result-img result-grid" alt="pose grid" src={`data:image/png;base64,${poseGridB64}`} style={{ width: gridDisplayDims.w, height: 'auto', aspectRatio: `${gridDisplayDims.origW}/${gridDisplayDims.origH}`, objectFit: 'contain', borderRadius: 12, display: 'block', margin: '0 auto', maxWidth: 'min(780px,98vw)', cursor: 'zoom-in' }} onClick={() => onFullscreen?.('poseGrid', poseGridB64)} />
              {gridDisplayDims.scale < 1 && (<p className="note" style={{ marginTop: 6, fontSize: 11 }}>Scaled down {Math.round(gridDisplayDims.scale * 100)}% (original {gridDisplayDims.origW}×{gridDisplayDims.origH})</p>)}
              <div className="result-actions" role="group" aria-label="Pose Grid Actions">
                <button className="btn" data-variant="outline" onClick={() => downloadGrid('pose')}>Download Poses</button>
                <button className="btn" data-variant="outline" onClick={() => clearGrid('pose')}>Delete Grid</button>
              </div>
            </div>
          )}
          {colorGridB64 && gridDisplayDims && (
            <div className="section-block">
              <div className="card-header" style={{ marginBottom: 10 }}>Color Variations (3×3)</div>
              <img className="result-img result-grid" alt="color grid" src={`data:image/png;base64,${colorGridB64}`} style={{ width: gridDisplayDims.w, height: 'auto', aspectRatio: `${gridDisplayDims.origW}/${gridDisplayDims.origH}`, objectFit: 'contain', borderRadius: 12, display: 'block', margin: '0 auto', maxWidth: 'min(780px,98vw)', cursor: 'zoom-in' }} onClick={() => onFullscreen?.('colorGrid', colorGridB64)} />
              {gridDisplayDims.scale < 1 && (<p className="note" style={{ marginTop: 6, fontSize: 11 }}>Scaled down {Math.round(gridDisplayDims.scale * 100)}% (original {gridDisplayDims.origW}×{gridDisplayDims.origH})</p>)}
              <div className="result-actions" role="group" aria-label="Color Grid Actions">
                <button className="btn" data-variant="outline" onClick={() => downloadGrid('color')}>Download Colors</button>
                <button className="btn" data-variant="outline" onClick={() => clearGrid('color')}>Delete Grid</button>
              </div>
              <p className="note" style={{ marginTop: 8, fontSize: 11 }}>Person & background fixed – only garment color changes.</p>
            </div>
          )}
        </div>
      )}
    </>
  );
};
