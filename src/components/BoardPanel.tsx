import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { HalfMove } from '../types';
import { makeBoardMove, getLegalDestinations } from '../utils/chessParser';

interface Props {
  fen: string;
  moves: HalfMove[];
  currentPly: number;
  correctionPly: number | null;
  onNavigate: (ply: number) => void;
  onBoardMove: (san: string) => void;
  onCancelCorrection: () => void;
  onTextCorrection: (san: string) => void;
  onSwapColors: (fromPly: number) => void;
}

export default function BoardPanel({
  fen,
  moves,
  currentPly,
  correctionPly,
  onNavigate,
  onBoardMove,
  onCancelCorrection,
  onTextCorrection,
  onSwapColors,
}: Props) {
  const [textInput, setTextInput]         = useState('');
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  const isCorrecting = correctionPly !== null;
  const totalPlies   = moves.length;
  const correctionMove = correctionPly !== null ? moves[correctionPly] : null;

  // Clear text input + square selection when fen or correction ply changes
  useEffect(() => {
    setSelectedSquare(null);
    if (correctionMove) {
      setTextInput(correctionMove.raw || '');
    } else {
      setTextInput('');
    }
  }, [correctionPly, fen]);

  // ── Click-to-move ─────────────────────────────────────────────────────────

  const legalDots = useMemo(() => {
    if (!selectedSquare) return {};
    const dests = getLegalDestinations(fen, selectedSquare);
    const styles: Record<string, React.CSSProperties> = {
      [selectedSquare]: { backgroundColor: 'rgba(255,255,0,0.38)' },
    };
    for (const sq of dests) {
      styles[sq] = {
        background: 'radial-gradient(circle, rgba(0,0,0,0.18) 30%, transparent 31%)',
      };
    }
    return styles;
  }, [selectedSquare, fen]);

  const handleSquareClick = useCallback((square: string) => {
    if (selectedSquare) {
      // Attempt a move from the selected square to the clicked square
      const result = makeBoardMove(fen, selectedSquare, square);
      if (result) {
        setTextInput(result.san);
        onBoardMove(result.san);
        setSelectedSquare(null);
        return;
      }
    }
    // Toggle selection: clicking the same square deselects, any other selects
    setSelectedSquare(prev => (prev === square ? null : square));
  }, [selectedSquare, fen, onBoardMove]);

  // ── Drag-to-move ─────────────────────────────────────────────────────────

  const handlePieceDrop = useCallback(
    (source: string, target: string): boolean => {
      const result = makeBoardMove(fen, source, target);
      if (!result) return false;
      setTextInput(result.san);
      onBoardMove(result.san);
      setSelectedSquare(null);
      return true;
    },
    [fen, onBoardMove]
  );

  // ── Text correction ───────────────────────────────────────────────────────

  const applyTextCorrection = () => {
    const trimmed = textInput.trim();
    if (trimmed) {
      onTextCorrection(trimmed);
      setTextInput('');
    }
  };

  const moveLabel = (ply: number) => {
    const num   = Math.floor(ply / 2) + 1;
    const color = ply % 2 === 0 ? 'White' : 'Black';
    return `Move ${num} (${color})`;
  };

  const swapMoveNum = correctionPly !== null
    ? Math.floor((correctionPly % 2 === 0 ? correctionPly : correctionPly - 1) / 2) + 1
    : null;

  return (
    <div className="board-panel">
      <div className="board-wrapper">
        <Chessboard
          position={fen}
          onPieceDrop={handlePieceDrop}
          onSquareClick={handleSquareClick}
          arePiecesDraggable={true}
          boardWidth={560}
          customSquareStyles={legalDots}
          customBoardStyle={{
            borderRadius: '6px',
            boxShadow: isCorrecting
              ? '0 0 0 3px var(--color-warn)'
              : '0 4px 20px rgba(0,0,0,0.4)',
          }}
          customDarkSquareStyle={{ backgroundColor: '#5a7d9a' }}
          customLightSquareStyle={{ backgroundColor: '#d4e5f0' }}
        />
      </div>

      {/* Navigation bar */}
      <div className="nav-bar">
        <button className="nav-btn" onClick={() => onNavigate(-1)}             disabled={currentPly === -1}           title="Start (←←)">|◀</button>
        <button className="nav-btn" onClick={() => onNavigate(currentPly - 1)} disabled={currentPly === -1}           title="Previous (←)">◀</button>

        <span className="nav-label">
          {currentPly === -1 ? 'Start' : moveLabel(currentPly)}
          {totalPlies > 0 && ` · ${currentPly + 1} / ${totalPlies}`}
        </span>

        <button className="nav-btn" onClick={() => onNavigate(currentPly + 1)} disabled={currentPly >= totalPlies - 1} title="Next (→)">▶</button>
        <button
          className="nav-btn"
          onClick={() => {
            let last = -1;
            for (let i = 0; i < moves.length; i++) {
              if (moves[i].san) last = i; else break;
            }
            onNavigate(last);
          }}
          title="End (→→)"
        >▶|</button>
      </div>

      {/* Correction panel */}
      {isCorrecting && correctionMove && (
        <div className="correction-panel">
          <div className="correction-header">
            <span className="correction-title">Correcting {moveLabel(correctionPly!)}</span>
            <button className="btn-ghost" onClick={onCancelCorrection}>✕ Cancel</button>
          </div>

          <div className="correction-original">
            <span className="label">OCR read:</span>
            <code className={correctionMove.valid ? 'valid' : 'invalid'}>
              {correctionMove.raw || '(empty)'}
            </code>
            {correctionMove.errorMsg && (
              <span className="error-msg">{correctionMove.errorMsg}</span>
            )}
          </div>

          <div className="correction-hint">
            Click a piece then its destination, drag it, or type the move:
          </div>

          <div className="correction-input-row">
            <input
              className="form-input correction-text-input"
              placeholder="e.g. Nf3, O-O, exd5"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyTextCorrection()}
              autoFocus
            />
            <button className="btn-primary" onClick={applyTextCorrection}>Apply</button>
          </div>

          <div className="swap-colors-row">
            <span className="swap-label">Columns swapped from here?</span>
            <button
              className="btn-swap"
              onClick={() => onSwapColors(correctionPly!)}
              title={`Swap White/Black columns from move ${swapMoveNum} onwards`}
            >
              ⇄ Swap W↔B from move {swapMoveNum}
            </button>
          </div>
        </div>
      )}

      {!isCorrecting && (
        <div className="board-hint">
          Click a move to correct it · Click piece then square, or drag · ← → to navigate
        </div>
      )}
    </div>
  );
}
