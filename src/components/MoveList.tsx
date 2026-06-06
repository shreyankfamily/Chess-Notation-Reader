import React, { useRef, useEffect, useState } from 'react';
import type { HalfMove, MoveSuggestion } from '../types';

interface Props {
  moves: HalfMove[];
  currentPly: number;
  correctionPly: number | null;
  onSelectPly: (ply: number) => void;
  onEditRaw: (ply: number, raw: string) => void;
  onStartCorrection: (ply: number) => void;
  onApplySuggestion: (ply: number, san: string) => void;
  onSuggestForPly: (ply: number) => void;
  onAddMove: () => void;
  onDeleteMove: (ply: number) => void;
}

function getMoveClass(m: HalfMove, isSelected: boolean, isCorrecting: boolean): string {
  const parts = ['move-cell'];
  if (isSelected) parts.push('selected');
  if (isCorrecting) parts.push('correcting');
  if (m.valid) parts.push('valid');
  else if (m.unknown) parts.push('unknown');
  else parts.push('invalid');
  return parts.join(' ');
}

function SuggestionBar({
  suggestions,
  ply,
  onApply,
  onResuggest,
}: {
  suggestions: MoveSuggestion[];
  ply: number;
  onApply: (ply: number, san: string) => void;
  onResuggest: (ply: number) => void;
}) {
  return (
    <div className="suggestion-bar">
      <span className="suggestion-label">Best guesses:</span>
      {suggestions.map(s => (
        <button
          key={s.san}
          className="suggestion-chip"
          onClick={e => { e.stopPropagation(); onApply(ply, s.san); }}
          title={s.validatesNext > 0
            ? `Validates the next ${s.validatesNext} move${s.validatesNext === 1 ? '' : 's'}`
            : 'No subsequent moves to validate against'}
        >
          {s.san}
          {s.validatesNext > 0 && (
            <span className="chip-score">+{s.validatesNext}</span>
          )}
        </button>
      ))}
      <button
        className="btn-ghost btn-xs resuggest-btn"
        onClick={e => { e.stopPropagation(); onResuggest(ply); }}
        title="Re-run inference"
      >↻</button>
    </div>
  );
}

export default function MoveList({
  moves,
  currentPly,
  correctionPly,
  onSelectPly,
  onEditRaw,
  onStartCorrection,
  onApplySuggestion,
  onSuggestForPly,
  onAddMove,
  onDeleteMove,
}: Props) {
  const [editingPly, setEditingPly] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected move into view — only scroll the container, never the page
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const sel = container.querySelector('.selected') as HTMLElement | null;
    if (!sel) return;
    const cr = container.getBoundingClientRect();
    const sr = sel.getBoundingClientRect();
    if (sr.top < cr.top) {
      container.scrollTop -= (cr.top - sr.top) + 4;
    } else if (sr.bottom > cr.bottom) {
      container.scrollTop += (sr.bottom - cr.bottom) + 4;
    }
  }, [currentPly]);

  const startEdit = (ply: number, raw: string) => {
    setEditingPly(ply);
    setEditText(raw);
  };

  const commitEdit = (ply: number) => {
    onEditRaw(ply, editText);
    setEditingPly(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, ply: number) => {
    if (e.key === 'Enter') commitEdit(ply);
    if (e.key === 'Escape') setEditingPly(null);
  };

  const pairs: { num: number; white: HalfMove; black?: HalfMove }[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ num: Math.floor(i / 2) + 1, white: moves[i], black: moves[i + 1] });
  }

  const renderCell = (m: HalfMove) => {
    const isSelected = currentPly === m.ply;
    const isCorrecting = correctionPly === m.ply;
    const isEditing = editingPly === m.ply;

    return (
      <div
        key={m.ply}
        className={getMoveClass(m, isSelected, isCorrecting)}
        onClick={() => !isEditing && onStartCorrection(m.ply)}
        onDoubleClick={() => startEdit(m.ply, m.raw)}
        title={isCorrecting ? 'Correcting — drag on the board or type below' : 'Click to correct · Double-click to edit text'}
      >
        {isEditing ? (
          <input
            className="move-edit-input"
            value={editText}
            autoFocus
            onChange={e => setEditText(e.target.value)}
            onBlur={() => commitEdit(m.ply)}
            onKeyDown={e => handleKeyDown(e, m.ply)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="move-text">{m.san || m.raw || '?'}</span>
            {!m.valid && !m.unknown && (
              <span className="move-error-icon" title={m.errorMsg}>!</span>
            )}
            {!m.unknown && (
              <button
                className={`fix-btn${m.valid ? ' fix-btn-valid' : ''}`}
                title="Fix on the board"
                onClick={e => { e.stopPropagation(); onStartCorrection(m.ply); }}
              >✎</button>
            )}
          </>
        )}
      </div>
    );
  };

  const renderSuggestionRow = (m: HalfMove) => {
    if (m.valid || m.unknown) return null;
    const moveNum = Math.floor((m.swapFromPly ?? m.ply) / 2) + 1;
    return (
      <tr className="suggestion-row">
        <td colSpan={4}>
          {m.swapSuggested && (
            <div className="swap-detected-banner">
              <span className="swap-detected-icon">⇄</span>
              <span className="swap-detected-msg">
                Columns likely swapped from move {moveNum}
              </span>
              <button
                className="btn-swap btn-swap-inline"
                onClick={e => { e.stopPropagation(); onApplySuggestion(-(m.swapFromPly ?? m.ply) - 1, ''); }}
              >
                Fix automatically
              </button>
            </div>
          )}
          {m.suggestions && m.suggestions.length > 0 && (
            <SuggestionBar
              suggestions={m.suggestions}
              ply={m.ply}
              onApply={onApplySuggestion}
              onResuggest={onSuggestForPly}
            />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="move-list-section">
      <div className="move-list-header">
        <span className="move-list-title">Moves</span>
        <span className="move-count">{moves.length} half-moves</span>
      </div>

      <div className="move-list" ref={listRef}>
        {pairs.length === 0 ? (
          <div className="move-list-empty">No moves yet — scan a scoresheet or add manually.</div>
        ) : (
          <table className="move-table">
            <thead>
              <tr>
                <th>#</th>
                <th>White</th>
                <th>Black</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pairs.map(({ num, white, black }) => (
                <React.Fragment key={num}>
                  <tr className={
                    (currentPly === white.ply || (black && currentPly === black.ply)) ? 'row-active' : ''
                  }>
                    <td className="move-num">{num}</td>
                    <td>{renderCell(white)}</td>
                    <td>{black ? renderCell(black) : <span className="move-cell empty">—</span>}</td>
                    <td>
                      <button
                        className="del-btn"
                        title="Delete this move pair"
                        onClick={() => { onDeleteMove(white.ply); if (black) onDeleteMove(black.ply); }}
                      >×</button>
                    </td>
                  </tr>
                  {renderSuggestionRow(white)}
                  {black && renderSuggestionRow(black)}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="move-list-footer">
        <button className="btn-secondary full-width" onClick={onAddMove}>+ Add Move</button>
      </div>
    </div>
  );
}
