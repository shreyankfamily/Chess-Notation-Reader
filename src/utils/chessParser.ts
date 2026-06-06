import { Chess } from 'chess.js';
import type { HalfMove, MoveSuggestion } from '../types';
import { inferLikelyMoves } from './moveInference';

// ── OCR text cleanup ──────────────────────────────────────────────────────────

export function cleanChessToken(raw: string): string {
  let s = raw.trim();
  if (!s) return s;

  // Castling: normalise 0-0 / o-o variants to O-O
  s = s.replace(/^0-0-0$/i, 'O-O-O');
  s = s.replace(/^0-0$/i, 'O-O');
  s = s.replace(/^o-o-o$/i, 'O-O-O');
  s = s.replace(/^o-o$/i, 'O-O');
  s = s.replace(/^OO$/i, 'O-O');
  s = s.replace(/^OOO$/i, 'O-O-O');

  // Unicode → ASCII
  s = s.replace(/[×✕]/g, 'x');
  s = s.replace(/–/g, '-');
  s = s.replace(/\+\+/g, '+');

  // 'S' has no meaning in chess notation; it always represents the digit 5
  s = s.replace(/S/g, '5');

  // Lowercase files A-H → a-h when followed by a rank digit or rank-position OCR error
  s = s.replace(/([A-H])([1-8])/g, (_m, file: string, rank: string) => file.toLowerCase() + rank);

  // Rank-position confusions after a file letter: l/I/| → 1, Z → 2
  s = s.replace(/([a-h])[lI|]([^a-z]|$)/g, (_m, f: string, after: string) => f + '1' + after);
  s = s.replace(/([a-h])Z([^a-z]|$)/g, (_m, f: string, after: string) => f + '2' + after);

  // Piece letters should be uppercase: fix common OCR lowercase piece names at the start
  // e.g. "nf3" → "Nf3", "bf4" → "Bf4" — but "a4", "b4" are pawn moves (file letter)
  const piecePattern = /^([kqrbn])([a-h1-8x])/i;
  const pieceMatch = s.match(piecePattern);
  if (pieceMatch) {
    const upper = pieceMatch[1].toUpperCase();
    // Only uppercase if it's actually a piece letter (not a pawn file a-h)
    if ('KQRN'.includes(upper)) { // 'B' excluded — 'b' is also the b-file (b4, b5, etc.)
      s = upper + s.slice(1);
    }
  }

  return s;
}

// ── Move validation helpers ───────────────────────────────────────────────────

// Both try-functions undo after checking so they don't advance the caller's game state.
function tryMoveSan(chess: Chess, san: string): string | null {
  try {
    const m = chess.move(san);
    chess.undo();
    return m.san;
  } catch {
    return null;
  }
}

function tryMoveFromTo(chess: Chess, from: string, to: string): string | null {
  try {
    const m = chess.move({ from, to, promotion: 'q' });
    chess.undo();
    return m.san;
  } catch {
    return null;
  }
}

// Generate plausible alternatives when OCR produces a wrong token
function alternatives(raw: string): string[] {
  const alts: string[] = [];
  const s = cleanChessToken(raw);
  alts.push(s);

  // Without check/mate symbol
  alts.push(s.replace(/[+#]$/, ''));
  alts.push(s.replace(/\+$/, '#'));
  alts.push(s.replace(/#$/, '+'));

  // Castling variants
  if (/^[Oo0]{2,3}/.test(s)) {
    alts.push('O-O', 'O-O-O');
  }

  // Common rank substitutions: 0↔O, l/I↔1, S↔5, Z↔2
  const swapped = s
    .replace(/0/g, 'O')
    .replace(/[lI]/g, '1')
    .replace(/S/g, '5')
    .replace(/([a-h])Z/g, '$12');
  alts.push(swapped);
  alts.push(swapped.replace(/[+#]$/, ''));

  // If starts with lowercase that could be a piece letter
  if (s.length > 1 && /^[a-h]/.test(s)) {
    // Try treating first char as uppercase piece
    const upper = s[0].toUpperCase();
    if ('KQRBN'.includes(upper)) alts.push(upper + s.slice(1));
  }

  return [...new Set(alts.filter(Boolean))];
}

export function findValidSan(chess: Chess, raw: string): string | null {
  for (const candidate of alternatives(raw)) {
    const result = tryMoveSan(chess, candidate);
    if (result !== null) return result;
  }
  return null;
}

// Returns all legal destination squares from a given square in a FEN position.
export function getLegalDestinations(fen: string, from: string): string[] {
  try {
    const chess = new Chess(fen);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (chess.moves({ square: from as any, verbose: true }) as any[]).map((m: any) => m.to as string);
  } catch {
    return [];
  }
}

// ── Core validation ───────────────────────────────────────────────────────────

export function buildFens(moves: HalfMove[]): string[] {
  const chess = new Chess();
  const fens: string[] = [chess.fen()];
  for (const m of moves) {
    if (!m.san) break;
    try {
      chess.move(m.san);
      fens.push(chess.fen());
    } catch {
      break;
    }
  }
  return fens;
}

export function getFenAtPly(moves: HalfMove[], ply: number): string {
  // ply = -1 → starting position; ply = 0 → after white move 1; etc.
  const fens = buildFens(moves);
  const idx = Math.min(Math.max(ply + 1, 0), fens.length - 1);
  return fens[idx];
}

/**
 * Re-validates all half-moves starting from `startPly`.
 * Needs `existingMoves` (with correct SANs) for plies 0..startPly-1.
 */
export function revalidateFrom(
  existingMoves: HalfMove[],
  rawTokens: string[], // raw text for plies startPly..end
  startPly: number
): HalfMove[] {
  // Replay chess game up to startPly
  const chess = new Chess();
  for (let i = 0; i < startPly; i++) {
    const m = existingMoves[i];
    if (!m || !m.san) break;
    try { chess.move(m.san); } catch { break; }
  }

  const updated: HalfMove[] = [...existingMoves];
  let blocked = false;

  for (let i = startPly; i < updated.length; i++) {
    const raw = updated[i].raw;
    if (blocked) {
      updated[i] = {
        ...updated[i],
        san: null,
        valid: false,
        unknown: true,
        errorMsg: 'Cannot validate — previous move is invalid',
      };
      continue;
    }

    if (!raw.trim()) {
      // Empty slot
      updated[i] = { ...updated[i], san: null, valid: false, unknown: false, errorMsg: 'Empty' };
      blocked = true;
      continue;
    }

    const san = findValidSan(chess, raw);
    if (san) {
      updated[i] = { ...updated[i], san, valid: true, unknown: false, errorMsg: '', suggestions: undefined };
      chess.move(san);
    } else {
      const suggestions = inferLikelyMoves(
        chess.fen(),
        raw,
        updated.slice(i + 1).map(m => m.raw),
        findValidSan,
        5
      );
      const swapPly = i % 2 === 0 ? i : i - 1;
      const allRaws = updated.map(m => m.raw);
      const swapPairs = detectColumnSwap(chess.fen(), allRaws, swapPly, findValidSan);
      const swapSuggested = swapPairs >= 2;
      updated[i] = { ...updated[i], san: null, valid: false, unknown: false,
        errorMsg: `"${raw}" is not a legal move`, suggestions,
        ...(swapSuggested ? { swapSuggested: true, swapFromPly: swapPly } : { swapSuggested: false }) };
      blocked = true;
    }
  }

  return updated;
}

/**
 * Check whether swapping every White/Black pair of raw tokens starting at
 * `swapPly` (must be even) would allow more consecutive moves to validate.
 * Returns the number of consecutive pairs that validate with the swap.
 */
function detectColumnSwap(
  fenBeforeSwap: string,
  rawTokens: string[],
  swapPly: number,
  validate: (chess: Chess, raw: string) => string | null,
  minPairs = 2
): number {
  if (swapPly % 2 !== 0) return 0;
  const chess = new Chess(fenBeforeSwap);
  let pairs = 0;
  for (let i = swapPly; i + 1 < rawTokens.length; i += 2) {
    // With the swap: rawTokens[i+1] is played at ply i (white), rawTokens[i] at ply i+1 (black)
    const whiteSan = validate(chess, rawTokens[i + 1]);
    if (!whiteSan) break;
    chess.move(whiteSan);
    const blackSan = validate(chess, rawTokens[i]);
    if (!blackSan) break;
    chess.move(blackSan);
    pairs++;
    if (pairs >= minPairs) return pairs; // early exit once confident
  }
  return pairs;
}

/**
 * Parse a flat array of raw move tokens and validate them from scratch.
 * When a move is invalid, runs inference to generate ranked suggestions.
 */
export function parseAndValidate(rawTokens: string[], withInference = true): HalfMove[] {
  const chess = new Chess();
  const moves: HalfMove[] = [];
  let blocked = false;

  for (let i = 0; i < rawTokens.length; i++) {
    const raw = rawTokens[i].trim();
    const ply = i;
    const id = `ply-${ply}`;

    if (blocked || !raw) {
      moves.push({
        id, ply, raw, san: null, valid: false,
        unknown: blocked,
        errorMsg: blocked ? 'Cannot validate — previous move is invalid' : 'Empty',
      });
      if (!raw) blocked = true;
      continue;
    }

    const san = findValidSan(chess, raw);
    if (san) {
      moves.push({ id, ply, raw, san, valid: true, unknown: false, errorMsg: '' });
      chess.move(san);
    } else {
      // Run inference: try all legal moves and score by forward validation + text similarity
      const suggestions: MoveSuggestion[] = withInference
        ? inferLikelyMoves(chess.fen(), raw, rawTokens.slice(i + 1), findValidSan, 5)
        : [];

      // Detect column swap: check if swapping this pair (and all subsequent pairs)
      // from the nearest even ply would allow consecutive moves to validate.
      const swapPly = ply % 2 === 0 ? ply : ply - 1;
      const fenForSwap = swapPly === ply ? chess.fen() : (() => {
        // Roll back one move to get the fen at swapPly
        const tmp = new Chess();
        for (let k = 0; k < swapPly; k++) {
          if (moves[k]?.san) try { tmp.move(moves[k].san!); } catch { break; }
        }
        return tmp.fen();
      })();
      const swapPairs = detectColumnSwap(fenForSwap, rawTokens, swapPly, findValidSan);
      const swapSuggested = swapPairs >= 2;

      moves.push({ id, ply, raw, san: null, valid: false, unknown: false,
        errorMsg: `"${raw}" is not a legal move`, suggestions,
        ...(swapSuggested ? { swapSuggested: true, swapFromPly: swapPly } : {}) });
      blocked = true;
    }
  }

  return moves;
}

// ── PGN builder ───────────────────────────────────────────────────────────────

import type { GameInfo } from '../types';

export function buildPgn(info: GameInfo, moves: HalfMove[]): string {
  const formatDate = (d: string) => {
    if (!d) return '????.??.??';
    // Accept YYYY-MM-DD or similar
    return d.replace(/-/g, '.');
  };

  const headers = [
    `[Event "${info.event || '?'}"]`,
    `[Site "${info.site || '?'}"]`,
    `[Date "${formatDate(info.date)}"]`,
    `[Round "${info.round || '?'}"]`,
    `[White "${info.white || '?'}"]`,
    `[Black "${info.black || '?'}"]`,
    `[Result "${info.result || '*'}"]`,
  ];
  if (info.whiteElo) headers.push(`[WhiteElo "${info.whiteElo}"]`);
  if (info.blackElo) headers.push(`[BlackElo "${info.blackElo}"]`);
  if (info.timeControl) headers.push(`[TimeControl "${info.timeControl}"]`);

  const moveParts: string[] = [];
  for (let i = 0; i < moves.length; i += 2) {
    const num = Math.floor(i / 2) + 1;
    const white = moves[i]?.san ?? `{${moves[i]?.raw || '?'}}`;
    const black = moves[i + 1]?.san ?? (moves[i + 1] ? `{${moves[i + 1].raw || '?'}}` : '');
    moveParts.push(`${num}. ${white}${black ? ' ' + black : ''}`);
  }

  return headers.join('\n') + '\n\n' + moveParts.join(' ') + ' ' + (info.result || '*');
}

// ── Make a move from board drag (correction mode) ─────────────────────────────

export function makeBoardMove(fenBefore: string, from: string, to: string): { san: string; fenAfter: string } | null {
  try {
    const chess = new Chess(fenBefore);
    const m = chess.move({ from, to, promotion: 'q' });
    if (!m) return null;
    return { san: m.san, fenAfter: chess.fen() };
  } catch {
    return null;
  }
}
