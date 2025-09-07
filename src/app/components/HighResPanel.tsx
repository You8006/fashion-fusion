"use client";
import React from 'react';

export interface HighResPanelProps {
  poseGridB64: string;
  colorGridB64: string;
  source: 'pose' | 'color';
  hiResPoseB64: string;
  hiResIndex: number | null;
  hiResLoading: boolean;
  hiResW: number; hiResH: number;
  compW: number; compH: number; baseW: number; baseH: number;
  onGenerate(index: number, source: 'pose' | 'color'): void;
  onClear(): void;
  download(label: string, b64: string, w: number, h: number): void;
}

export const HighResPanel: React.FC<HighResPanelProps> = ({ poseGridB64, colorGridB64, source, hiResPoseB64, hiResIndex, hiResLoading, hiResW, hiResH, compW, compH, baseW, baseH, onGenerate, onClear, download }) => {
  const gridExists = (src: 'pose' | 'color') => src === 'pose' ? !!poseGridB64 : !!colorGridB64;
  const cellButtons = (src: 'pose' | 'color') => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
      {Array.from({ length: 9 }).map((_, i) => {
        const disabled = hiResLoading;
        const activeLoading = hiResLoading && hiResIndex === i && source === src;
        return (
          <button
            key={i}
            className="btn"
            data-variant="outline"
            style={{ padding: '6px 4px', fontSize: 12, lineHeight: 1.2 }}
            disabled={disabled}
            onClick={() => onGenerate(i, src)}
            aria-label={`Generate high-res for ${src === 'pose' ? 'pose' : 'color'} cell ${i + 1}`}
          >
            {activeLoading ? 'Processing…' : `Cell ${i + 1}`}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
  {/* High-res cell selection UI intentionally hidden per user request */}
      {hiResPoseB64 && (
        <div className="section-block">
          <div className="card-header" style={{ marginBottom: 10 }}>High-Res Result (Cell {hiResIndex !== null ? hiResIndex + 1 : '-'} / {source === 'pose' ? 'Pose' : 'Color'})</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="result-img"
            alt="high-res"
            src={`data:image/png;base64,${hiResPoseB64}`}
            style={{ maxWidth: 'min(620px,96vw)', width: hiResW || (compW || baseW), height: hiResH || (compH || baseH), aspectRatio: `${hiResW || (compW || baseW)}/${hiResH || (compH || baseH)}`, borderRadius: 14, objectFit: 'contain', display: 'block', margin: '0 auto', maxHeight: '60vh' }}
          />
          <div className="result-actions" role="group" aria-label="High-Res Actions">
            <button className="btn" data-variant="outline" onClick={() => download(`pose-cell-${(hiResIndex ?? 0) + 1}-hires`, hiResPoseB64, hiResW, hiResH)}>Download</button>
            <button className="btn" data-variant="outline" onClick={onClear}>Clear</button>
          </div>
        </div>
      )}
    </>
  );
};
