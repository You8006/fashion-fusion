"use client";
import React from 'react';

export interface UploadAreaProps {
  personFile: File | null;
  itemFile: File | null;
  personW: number; personH: number; itemW: number; itemH: number;
  onPick(kind: 'person' | 'item', files: FileList | null): void;
  onClear(kind: 'person' | 'item'): void;
}

// Simple preview rendering util
function Thumb({ file, w, h, label }: { file: File; w: number; h: number; label: string }) {
  let rw = w; let rh = h;
  const LONG_MAX = 140; const SHORT_MIN = 90;
  if (rw && rh) {
    let scale = Math.min(1, LONG_MAX / Math.max(rw, rh));
    if (Math.min(rw, rh) * scale < SHORT_MIN) scale = SHORT_MIN / Math.min(rw, rh);
    if (Math.max(rw * scale, rh * scale) > LONG_MAX) {
      const adjust = LONG_MAX / Math.max(rw * scale, rh * scale);
      scale *= adjust;
    }
    rw = Math.round(rw * scale); rh = Math.round(rh * scale);
  } else { rw = 140; rh = 140; }
  return (
    <>
      <strong className="text-secondary" style={{ fontSize: 12 }}>{label}</strong>
      <span className="file-name" title={file.name}>{file.name}</span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
  alt={`${label} preview`}
        className="thumb"
        src={URL.createObjectURL(file)}
        style={{ width: rw, height: rh, objectFit: 'contain', background: 'var(--fx-surface-alt,transparent)', borderRadius: 6, display: 'block', margin: '0 auto', maxWidth: 'min(140px,90vw)', maxHeight: 'min(140px,40vh)', minWidth: '40px', minHeight: '40px' }}
        onLoad={e => URL.revokeObjectURL((e.target as HTMLImageElement).src)}
      />
    </>
  );
}

export const UploadArea: React.FC<UploadAreaProps> = ({ personFile, itemFile, personW, personH, itemW, itemH, onPick, onClear }) => {
  const personInputRef = React.useRef<HTMLInputElement | null>(null);
  const itemInputRef = React.useRef<HTMLInputElement | null>(null);
  const [personDragOver, setPersonDragOver] = React.useState(false);
  const [itemDragOver, setItemDragOver] = React.useState(false);

  const buildDropHandlers = (kind: 'person' | 'item') => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; kind === 'person' ? setPersonDragOver(true) : setItemDragOver(true); },
    onDragLeave: (e: React.DragEvent) => { e.preventDefault(); kind === 'person' ? setPersonDragOver(false) : setItemDragOver(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); kind === 'person' ? setPersonDragOver(false) : setItemDragOver(false); onPick(kind, e.dataTransfer.files); },
    onClick: () => { (kind === 'person' ? personInputRef : itemInputRef).current?.click(); }
  });

  return (
    <div className="upload-grid" aria-label="Image Upload">
      <div className="card fx-glow-ring">
    <div className="card-header">1. Upload Images</div>
        <div className="fx-grid">
          {/* Person */}
      <div {...buildDropHandlers('person')} className={`upload-zone${personFile ? ' has-file' : ''}${personDragOver ? ' drag-over' : ''}`} aria-label="Select person image (click / drag & drop)">
            {personFile ? (
              <div className="upload-inner" style={{ justifyContent: 'center', alignItems: 'center', minHeight: 168 }}>
        <Thumb file={personFile} w={personW} h={personH} label="Person Image" />
                {personW && personH && <span style={{ fontSize: 10, opacity: .7, marginTop: 4 }}>{personW}×{personH}</span>}
        <button type="button" className="btn" data-variant="outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); onClear('person'); }}>Clear</button>
              </div>
            ) : (
              <div className="upload-placeholder">
        <span className="fx-section-title" style={{ marginBottom: 6 }}>Person Image</span>
        <p className="note" style={{ fontSize: 12.5 }}>Click or drag & drop<br />PNG / JPG / WEBP</p>
              </div>
            )}
            <input ref={personInputRef} type="file" accept="image/*" hidden onChange={e => onPick('person', e.target.files)} />
          </div>
          {/* Item */}
      <div {...buildDropHandlers('item')} className={`upload-zone${itemFile ? ' has-file' : ''}${itemDragOver ? ' drag-over' : ''}`} aria-label="Select item image (click / drag & drop)">
            {itemFile ? (
              <div className="upload-inner">
        <Thumb file={itemFile} w={itemW} h={itemH} label="Item Image" />
                {itemW && itemH && <span style={{ fontSize: 10, opacity: .7, marginTop: 4 }}>{itemW}×{itemH}</span>}
        <button type="button" className="btn" data-variant="outline" style={{ fontSize: 12, padding: '4px 10px' }} onClick={e => { e.stopPropagation(); onClear('item'); }}>Clear</button>
              </div>
            ) : (
              <div className="upload-placeholder">
        <span className="fx-section-title" style={{ marginBottom: 6 }}>Item Image</span>
        <p className="note" style={{ fontSize: 12.5 }}>Click or drag & drop<br />PNG / JPG / WEBP</p>
              </div>
            )}
            <input ref={itemInputRef} type="file" accept="image/*" hidden onChange={e => onPick('item', e.target.files)} />
          </div>
        </div>
      </div>
    </div>
  );
};
