import React, { useRef } from 'react';

interface SlotProps {
  label: string;
  preview: string | null;
  active: boolean; // currently being OCR'd
  done: boolean;
  onFile: (file: File) => void;
  onClear: () => void;
}

function PageSlot({ label, preview, active, done, onFile, onClear }: SlotProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const handle = (file: File) => {
    if (file.type.startsWith('image/')) onFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  };

  return (
    <div className="page-slot-wrapper">
      <div className="page-slot-label">
        {label}
        {done && <span className="slot-badge ok">✓</span>}
        {active && <span className="slot-badge loading">…</span>}
        {preview && !active && (
          <button className="slot-clear" onClick={e => { e.stopPropagation(); onClear(); }} title="Remove">×</button>
        )}
      </div>
      <div
        className={`drop-zone page-slot-zone ${dragging ? 'dragging' : ''} ${preview ? 'has-preview' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {preview ? (
          <img src={preview} alt={label} className="preview-img" />
        ) : (
          <div className="drop-hint">
            <span className="drop-icon">📄</span>
            <span>Click or drop</span>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }}
      />
    </div>
  );
}

interface Props {
  pages: (File | null)[];
  previews: (string | null)[];
  pageStatus: ('idle' | 'loading' | 'done' | 'error')[];
  overallProgress: number;
  overallStatus: 'idle' | 'loading' | 'done' | 'error';
  isAI?: boolean;
  onSetPage: (index: number, file: File) => void;
  onClearPage: (index: number) => void;
}

export default function ImageUpload({
  pages,
  previews,
  pageStatus,
  overallProgress,
  overallStatus,
  isAI = false,
  onSetPage,
  onClearPage,
}: Props) {
  return (
    <div className="section">
      <h3 className="section-title">
        Upload Scoresheet
        <span className="section-subtitle">Up to 2 pages</span>
      </h3>

      <div className="page-slots">
        {[0, 1].map(i => (
          <PageSlot
            key={i}
            label={`Page ${i + 1}`}
            preview={previews[i]}
            active={pageStatus[i] === 'loading'}
            done={pageStatus[i] === 'done'}
            onFile={f => onSetPage(i, f)}
            onClear={() => onClearPage(i)}
          />
        ))}
      </div>

      {overallStatus === 'loading' && (
        <div className="ocr-progress">
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${overallProgress}%` }} />
          </div>
          <span className="progress-label">
            {isAI ? '🤖 Scanning with Claude AI' : 'Running OCR'}
            {' '}on {pages.filter(Boolean).length === 2 ? 'both pages' : 'page'}… {overallProgress}%
          </span>
        </div>
      )}
      {overallStatus === 'done' && (
        <div className="ocr-status ok">
          ✓ {isAI ? 'Claude AI scan' : 'OCR'} complete ({pages.filter(Boolean).length} page{pages.filter(Boolean).length > 1 ? 's' : ''}) — review moves below
        </div>
      )}
      {overallStatus === 'error' && (
        <div className="ocr-status err">
          ✗ Scan failed — {isAI ? 'check your API key or try again' : 'try a clearer image'}
        </div>
      )}
    </div>
  );
}
