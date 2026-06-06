import React, { useState, useCallback, useEffect } from 'react';
import GameInfoForm from './components/GameInfoForm';
import ImageUpload from './components/ImageUpload';
import MoveList from './components/MoveList';
import BoardPanel from './components/BoardPanel';
import ApiKeySettings, { loadApiKey } from './components/ApiKeySettings';
import {
  parseAndValidate,
  revalidateFrom,
  getFenAtPly,
  buildPgn,
  findValidSan,
} from './utils/chessParser';
import { inferLikelyMoves } from './utils/moveInference';
import { runOcrMulti } from './utils/ocrProcessor';
import { Chess } from 'chess.js';
import type { GameInfo, HalfMove, OcrStatus } from './types';

const defaultGameInfo: GameInfo = {
  event: '', site: '', date: '', round: '',
  white: '', whiteElo: '', black: '', blackElo: '',
  timeControl: '', result: '*',
};

const GAME_INFO_KEY  = 'chess_game_info';
const MOVES_KEY      = 'chess_game_moves';
const PREVIEWS_KEY   = 'chess_page_previews';
const OCR_TOKENS_KEY = 'chess_ocr_tokens';

function loadGameInfo(): GameInfo {
  try {
    const stored = localStorage.getItem(GAME_INFO_KEY);
    if (stored) return { ...defaultGameInfo, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return defaultGameInfo;
}

function loadMoves(): HalfMove[] {
  try {
    const stored = localStorage.getItem(MOVES_KEY);
    if (stored) return JSON.parse(stored) as HalfMove[];
  } catch { /* ignore */ }
  return [];
}

function loadStoredPreviews(): (string | null)[] {
  try {
    const stored = localStorage.getItem(PREVIEWS_KEY);
    if (stored) return JSON.parse(stored) as (string | null)[];
  } catch { /* ignore */ }
  return [null, null];
}

// Compress an image file and save its data URL to localStorage at the given index.
function compressAndStorePreviews(file: File, index: number) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1000;
      let w = img.width, h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      try {
        const prev = JSON.parse(localStorage.getItem(PREVIEWS_KEY) || '[null,null]') as (string | null)[];
        prev[index] = dataUrl;
        localStorage.setItem(PREVIEWS_KEY, JSON.stringify(prev));
      } catch { /* quota exceeded — skip */ }
    };
    img.src = e.target!.result as string;
  };
  reader.readAsDataURL(file);
}

function loadOcrTokens(): string[] {
  try {
    const stored = localStorage.getItem(OCR_TOKENS_KEY);
    if (stored) return JSON.parse(stored) as string[];
  } catch { /* ignore */ }
  return [];
}

// Convert a data URL back to a File so it can be passed to the OCR pipeline.
function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, data] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)![1];
  const bytes = atob(data);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export interface CorrectionEntry {
  ply: number;
  color: 'W' | 'B';
  moveNum: number;
  raw: string;        // what OCR originally said
  corrected: string;  // what the user fixed it to
}

function newHalfMove(ply: number, raw: string): HalfMove {
  return { id: `ply-${ply}-${Date.now()}`, ply, raw, san: null, valid: false, unknown: false, errorMsg: '' };
}

export default function App() {
  const [gameInfo, setGameInfo] = useState<GameInfo>(loadGameInfo);
  const [moves, setMoves] = useState<HalfMove[]>(loadMoves);
  const [currentPly, setCurrentPly] = useState<number>(-1);
  const [correctionPly, setCorrectionPly] = useState<number | null>(null);
  const [apiKey, setApiKey] = useState<string>(loadApiKey);

  // Per-page upload state — previews are seeded from localStorage on first load
  const [pages, setPages] = useState<(File | null)[]>([null, null]);
  const [previews, setPreviews] = useState<(string | null)[]>(loadStoredPreviews);
  const [pageStatus, setPageStatus] = useState<OcrStatus[]>(['idle', 'idle']);
  const [overallStatus, setOverallStatus] = useState<OcrStatus>('idle');
  const [overallProgress, setOverallProgress] = useState(0);
  const [rawOcrText, setRawOcrText] = useState('');
  const [showRaw, setShowRaw] = useState(false);
  const [correctionLog, setCorrectionLog] = useState<CorrectionEntry[]>([]);
  const [showCorrectionLog, setShowCorrectionLog] = useState(false);
  const [rescanStatus, setRescanStatus] = useState<OcrStatus>('idle');

  // Persist moves on every change
  useEffect(() => {
    localStorage.setItem(MOVES_KEY, JSON.stringify(moves));
  }, [moves]);


  // ── Game info with persistence ──────────────────────────────────────────────

  const handleGameInfoChange = useCallback((info: GameInfo) => {
    setGameInfo(info);
    localStorage.setItem(GAME_INFO_KEY, JSON.stringify(info));
  }, []);

  // ── Page upload handlers ────────────────────────────────────────────────────

  const setPage = useCallback((index: number, file: File) => {
    const url = URL.createObjectURL(file);
    setPages(prev => { const n = [...prev]; n[index] = file; return n; });
    setPreviews(prev => {
      const n = [...prev];
      if (n[index] && n[index]!.startsWith('blob:')) URL.revokeObjectURL(n[index]!);
      n[index] = url;
      return n;
    });
    setPageStatus(prev => { const n = [...prev]; n[index] = 'idle'; return n; });
    compressAndStorePreviews(file, index);
  }, []);

  const clearPage = useCallback((index: number) => {
    setPreviews(prev => {
      const n = [...prev];
      if (n[index] && n[index]!.startsWith('blob:')) URL.revokeObjectURL(n[index]!);
      n[index] = null;
      return n;
    });
    setPages(prev => { const n = [...prev]; n[index] = null; return n; });
    setPageStatus(prev => { const n = [...prev]; n[index] = 'idle'; return n; });
    setOverallStatus('idle');
    // Clear persisted preview
    try {
      const stored = JSON.parse(localStorage.getItem(PREVIEWS_KEY) || '[null,null]') as (string | null)[];
      stored[index] = null;
      localStorage.setItem(PREVIEWS_KEY, JSON.stringify(stored));
    } catch { /* ignore */ }
  }, []);

  // ── OCR ────────────────────────────────────────────────────────────────────

  const runOcr = useCallback(async () => {
    const filesToProcess = pages.filter((f): f is File => f !== null);
    if (filesToProcess.length === 0) return;

    setOverallStatus('loading');
    setOverallProgress(0);
    setPageStatus(prev => prev.map((s, i) => pages[i] ? 'loading' : s));

    try {
      const { combined } = await runOcrMulti(filesToProcess, (pct) => {
        setOverallProgress(pct);
        const pageIdx = Math.min(Math.floor(pct / (100 / filesToProcess.length)), filesToProcess.length - 1);
        setPageStatus(prev => prev.map((s, i) => {
          if (!pages[i]) return s;
          const fileIdx = pages.slice(0, i + 1).filter(Boolean).length - 1;
          if (fileIdx < pageIdx) return 'done';
          if (fileIdx === pageIdx) return 'loading';
          return s;
        }));
      }, apiKey || undefined);

      setPageStatus(prev => prev.map((s, i) => pages[i] ? 'done' : s));
      setRawOcrText(combined.rawText);
      // Persist raw tokens so we can compare against corrections later
      localStorage.setItem(OCR_TOKENS_KEY, JSON.stringify(combined.rawMoveTokens));

      const parsed = parseAndValidate(combined.rawMoveTokens);
      setMoves(parsed);
      setCurrentPly(-1);
      setCorrectionPly(null);

      const newInfo: GameInfo = {
        ...gameInfo,
        event: gameInfo.event || combined.gameInfo.event || '',
        white: gameInfo.white || combined.gameInfo.white || '',
        black: gameInfo.black || combined.gameInfo.black || '',
        date: gameInfo.date || combined.gameInfo.date || '',
        result: gameInfo.result !== '*' ? gameInfo.result : (combined.gameInfo.result || '*'),
      };
      setGameInfo(newInfo);
      localStorage.setItem(GAME_INFO_KEY, JSON.stringify(newInfo));

      setOverallStatus('done');
    } catch (err) {
      console.error(err);
      setOverallStatus('error');
      setPageStatus(prev => prev.map((s, i) => pages[i] && s === 'loading' ? 'error' : s));
    }
  }, [pages, apiKey, gameInfo]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleNavigate = useCallback((ply: number) => {
    setCurrentPly(Math.max(-1, Math.min(ply, moves.length - 1)));
    setCorrectionPly(null);
  }, [moves.length]);

  const handleSelectPly = useCallback((ply: number) => {
    setCurrentPly(ply);
    setCorrectionPly(null);
  }, []);

  // ← / → arrow keys navigate through moves (skip when typing in an input)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleNavigate(currentPly - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNavigate(currentPly + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentPly, handleNavigate]);

  // ── Editing ────────────────────────────────────────────────────────────────

  const handleEditRaw = useCallback((ply: number, raw: string) => {
    setMoves(prev => {
      const updated = prev.map(m => m.ply === ply ? { ...m, raw } : m);
      return revalidateFrom(updated, updated.map(m => m.raw), ply);
    });
  }, []);

  // ── Correction mode ────────────────────────────────────────────────────────

  const handleStartCorrection = useCallback((ply: number) => {
    setCurrentPly(ply - 1);
    setCorrectionPly(ply);
  }, []);

  const handleCancelCorrection = useCallback(() => setCorrectionPly(null), []);

  const applyCorrection = useCallback((ply: number, san: string) => {
    setMoves(prev => {
      const updated = prev.map(m =>
        m.ply === ply ? { ...m, raw: san, san, valid: true, unknown: false, errorMsg: '' } : m
      );
      return revalidateFrom(updated, updated.map(m => m.raw), ply + 1);
    });
    setCurrentPly(ply);
    setCorrectionPly(null);
  }, []);

  // Board drop handler — works whether correction mode is active or not.
  // If correction mode: apply to correctionPly.
  // Otherwise: apply to currentPly+1 (replace next move from current position).
  const handleBoardMove = useCallback((san: string) => {
    if (correctionPly !== null) {
      applyCorrection(correctionPly, san);
      return;
    }
    const targetPly = currentPly + 1;
    setMoves(prev => {
      if (targetPly < prev.length) {
        // Replace existing move
        const updated = prev.map(m =>
          m.ply === targetPly ? { ...m, raw: san, san, valid: true, unknown: false, errorMsg: '' } : m
        );
        return revalidateFrom(updated, updated.map(m => m.raw), targetPly + 1);
      } else {
        // Append a new move at the end
        const newMove: HalfMove = {
          id: `ply-${targetPly}-${Date.now()}`,
          ply: targetPly, raw: san, san,
          valid: true, unknown: false, errorMsg: '',
        };
        return [...prev, newMove];
      }
    });
    setCurrentPly(targetPly);
  }, [correctionPly, currentPly, applyCorrection]);

  const handleTextCorrection = useCallback((raw: string) => {
    if (correctionPly === null) return;
    const fenBefore = getFenAtPly(moves, correctionPly - 1);
    const chess = new Chess(fenBefore);
    const san = findValidSan(chess, raw);
    if (san) {
      applyCorrection(correctionPly, san);
    } else {
      setMoves(prev => {
        const updated = prev.map(m =>
          m.ply === correctionPly
            ? { ...m, raw, san: null, valid: false, unknown: false, errorMsg: `"${raw}" is not a legal move` }
            : m
        );
        return revalidateFrom(updated, updated.map(m => m.raw), correctionPly + 1);
      });
      setCorrectionPly(null);
    }
  }, [correctionPly, moves, applyCorrection]);

  // ── Swap colors ────────────────────────────────────────────────────────────

  // Swap the raw tokens of every White/Black pair from `fromPly` onwards,
  // then re-validate. Fixes scoresheets where the columns were swapped mid-game.
  const handleSwapColorsFrom = useCallback((fromPly: number) => {
    const startPly = fromPly % 2 === 0 ? fromPly : fromPly - 1;
    setMoves(prev => {
      const updated = [...prev];
      for (let i = startPly; i + 1 < updated.length; i += 2) {
        const tmpRaw = updated[i].raw;
        updated[i]     = { ...updated[i],     raw: updated[i + 1].raw };
        updated[i + 1] = { ...updated[i + 1], raw: tmpRaw };
      }
      return revalidateFrom(updated, updated.map(m => m.raw), startPly);
    });
    setCorrectionPly(null);
  }, []);

  // ── Add / delete moves ──────────────────────────────────────────────────────

  const handleAddMove = useCallback(() => {
    setMoves(prev => [...prev, newHalfMove(prev.length, '')]);
  }, []);

  const handleDeleteMove = useCallback((ply: number) => {
    setMoves(prev => {
      const reindexed = prev.filter(m => m.ply !== ply).map((m, i) => ({ ...m, ply: i }));
      return revalidateFrom(reindexed, reindexed.map(m => m.raw), 0);
    });
    setCurrentPly(p => Math.max(-1, p - 1));
    setCorrectionPly(null);
  }, []);

  // ── Suggestion chips ────────────────────────────────────────────────────────

  // Negative ply is a swap-detection shortcut: ply = -(swapFromPly + 1)
  const handleApplySuggestion = useCallback((ply: number, san: string) => {
    if (ply < 0) {
      handleSwapColorsFrom(-(ply + 1));
    } else {
      applyCorrection(ply, san);
    }
  }, [applyCorrection, handleSwapColorsFrom]);

  const handleSuggestForPly = useCallback((ply: number) => {
    setMoves(prev => {
      const move = prev[ply];
      if (!move || move.valid || move.unknown) return prev;
      const fenBefore = getFenAtPly(prev, ply - 1);
      const chess = new Chess(fenBefore);
      const suggestions = inferLikelyMoves(
        chess.fen(), move.raw,
        prev.slice(ply + 1).map(m => m.raw),
        findValidSan, 5
      );
      return prev.map(m => m.ply === ply ? { ...m, suggestions } : m);
    });
  }, []);

  // ── Rescan for analysis ─────────────────────────────────────────────────────

  // Re-run OCR on stored image previews WITHOUT overwriting corrected moves.
  // Produces a correction log showing where OCR differed from the final SAN.
  const handleRescanAnalysis = useCallback(async () => {
    const storedPreviews = loadStoredPreviews().filter((p): p is string => p !== null);
    if (storedPreviews.length === 0) return;
    setRescanStatus('loading');
    try {
      const files = storedPreviews.map((url, i) => dataUrlToFile(url, `page${i + 1}.jpg`));
      const { combined } = await runOcrMulti(files, () => {}, apiKey || undefined);
      const rawTokens = combined.rawMoveTokens;
      localStorage.setItem(OCR_TOKENS_KEY, JSON.stringify(rawTokens));

      // Build correction log: compare raw OCR tokens to the corrected SANs
      const log: CorrectionEntry[] = rawTokens
        .map((raw, i) => {
          const corrected = moves[i]?.san ?? null;
          if (!corrected) return null;
          const cleanRaw = raw.trim();
          if (!cleanRaw || cleanRaw === corrected) return null;
          return {
            ply: i,
            color: (i % 2 === 0 ? 'W' : 'B') as 'W' | 'B',
            moveNum: Math.floor(i / 2) + 1,
            raw: cleanRaw,
            corrected,
          };
        })
        .filter((e): e is CorrectionEntry => e !== null);

      setCorrectionLog(log);
      setShowCorrectionLog(true);
      setRescanStatus('done');
    } catch (err) {
      console.error(err);
      setRescanStatus('error');
    }
  }, [apiKey, moves]);

  // ── Reset ───────────────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (!window.confirm('Clear all game data and start over?')) return;
    localStorage.removeItem(GAME_INFO_KEY);
    localStorage.removeItem(MOVES_KEY);
    localStorage.removeItem(PREVIEWS_KEY);
    localStorage.removeItem(OCR_TOKENS_KEY);
    setGameInfo(defaultGameInfo);
    setMoves([]);
    setCurrentPly(-1);
    setCorrectionPly(null);
    setPages([null, null]);
    setPreviews([null, null]);
    setPageStatus(['idle', 'idle']);
    setOverallStatus('idle');
    setOverallProgress(0);
    setRawOcrText('');
    setShowRaw(false);
    setCorrectionLog([]);
    setShowCorrectionLog(false);
    setRescanStatus('idle');
  }, []);

  // ── PGN / analysis ──────────────────────────────────────────────────────────

  const handleDownloadPgn = useCallback(() => {
    const pgn = buildPgn(gameInfo, moves);
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(gameInfo.white || 'white').replace(/\s+/g, '_')}_vs_${(gameInfo.black || 'black').replace(/\s+/g, '_')}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gameInfo, moves]);

  const handleOpenChessCom = useCallback(() => {
    const pgn = buildPgn(gameInfo, moves);
    window.open(`https://www.chess.com/analysis?pgn=${encodeURIComponent(pgn)}`, '_blank', 'noopener,noreferrer');
  }, [gameInfo, moves]);

  // ── Derived ─────────────────────────────────────────────────────────────────

  const boardFen = correctionPly !== null
    ? getFenAtPly(moves, correctionPly - 1)
    : getFenAtPly(moves, currentPly);

  const validCount   = moves.filter(m => m.valid).length;
  const invalidCount = moves.filter(m => !m.valid && !m.unknown).length;
  const hasFiles     = pages.some(Boolean);

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">♟</span>
        <h1 className="app-title">Chess Game Notator</h1>
        {moves.length > 0 && (
          <div className="stats-bar">
            <span className="stat valid">{validCount} valid</span>
            <span className="stat invalid">{invalidCount} invalid</span>
          </div>
        )}
        <button className="btn-reset" onClick={handleReset} title="Clear all data and start over">
          Reset
        </button>
      </header>

      <div className="app-body">
        {/* ── Left panel ── */}
        <div className="left-panel">
          <ApiKeySettings apiKey={apiKey} onChange={setApiKey} />
          <GameInfoForm info={gameInfo} onChange={handleGameInfoChange} />

          <ImageUpload
            pages={pages}
            previews={previews}
            pageStatus={pageStatus}
            overallProgress={overallProgress}
            overallStatus={overallStatus}
            isAI={!!apiKey}
            onSetPage={setPage}
            onClearPage={clearPage}
          />

          {hasFiles && overallStatus !== 'loading' && (
            <div className="section scan-section">
              <button className="btn-primary full-width scan-btn" onClick={runOcr}>
                {apiKey ? '🤖' : '🔍'} Scan {pages.filter(Boolean).length === 2 ? 'Both Pages' : 'Page'}
                {apiKey ? ' with Claude AI' : ''}
              </button>
            </div>
          )}

          {rawOcrText && (
            <div className="section raw-ocr-section">
              <button className="btn-ghost" onClick={() => setShowRaw(r => !r)}>
                {showRaw ? '▲' : '▼'} Raw scan text
              </button>
              {showRaw && <pre className="raw-ocr-text">{rawOcrText}</pre>}
            </div>
          )}

          {/* Correction analysis — available when we have stored images + corrected moves */}
          {moves.length > 0 && loadStoredPreviews().some(Boolean) && (
            <div className="section correction-analysis-section">
              <div className="section-title">
                OCR Quality Analysis
              </div>
              <button
                className="btn-secondary full-width btn-sm"
                onClick={handleRescanAnalysis}
                disabled={rescanStatus === 'loading'}
              >
                {rescanStatus === 'loading' ? '⏳ Rescanning…' : '🔬 Rescan to compare vs corrections'}
              </button>
              {rescanStatus === 'done' && correctionLog.length === 0 && (
                <p className="correction-none">OCR matched all corrected moves perfectly.</p>
              )}
              {correctionLog.length > 0 && (
                <>
                  <button
                    className="btn-ghost correction-log-toggle"
                    onClick={() => setShowCorrectionLog(s => !s)}
                  >
                    {showCorrectionLog ? '▲' : '▼'} {correctionLog.length} corrections found
                  </button>
                  {showCorrectionLog && (
                    <table className="correction-log-table">
                      <thead>
                        <tr><th>#</th><th>C</th><th>OCR read</th><th>→ Fixed</th></tr>
                      </thead>
                      <tbody>
                        {correctionLog.map(e => (
                          <tr key={e.ply}>
                            <td className="cl-num">{e.moveNum}</td>
                            <td className={`cl-color ${e.color === 'W' ? 'cl-white' : 'cl-black'}`}>{e.color}</td>
                            <td className="cl-raw">{e.raw}</td>
                            <td className="cl-fixed">{e.corrected}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Right panel: board + moves ── */}
        <div className="right-panel">
          <div className="board-column">
            <BoardPanel
              fen={boardFen}
              moves={moves}
              currentPly={correctionPly !== null ? correctionPly - 1 : currentPly}
              correctionPly={correctionPly}
              onNavigate={handleNavigate}
              onBoardMove={handleBoardMove}
              onCancelCorrection={handleCancelCorrection}
              onTextCorrection={handleTextCorrection}
              onSwapColors={handleSwapColorsFrom}
            />
          </div>

          <div className="moves-column">
            <MoveList
              moves={moves}
              currentPly={currentPly}
              correctionPly={correctionPly}
              onSelectPly={handleSelectPly}
              onEditRaw={handleEditRaw}
              onStartCorrection={handleStartCorrection}
              onApplySuggestion={handleApplySuggestion}
              onSuggestForPly={handleSuggestForPly}
              onAddMove={handleAddMove}
              onDeleteMove={handleDeleteMove}
            />

            {moves.length > 0 && (
              <div className="section moves-actions">
                <button className="btn-primary full-width" onClick={handleDownloadPgn}>
                  ↓ Download PGN
                </button>
                <button className="btn-secondary full-width" onClick={handleOpenChessCom}>
                  ♟ Analyze on Chess.com
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
