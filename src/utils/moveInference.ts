/**
 * Move inference engine.
 *
 * When OCR produces an invalid move token, we enumerate every legal move in the
 * current position and score it on two axes:
 *
 *   1. Forward validation  (80% weight)
 *      After playing the candidate, how many of the subsequent OCR raw tokens
 *      can be validated consecutively?  The more that validate in sequence, the
 *      stronger the evidence that this is the correct move.
 *
 *   2. Text / OCR similarity  (20% weight)
 *      How much does the candidate SAN resemble what OCR actually read, taking
 *      common handwriting confusion pairs into account (S↔5, l/I↔1, Z↔2, …)?
 *
 * The callback parameter `validate` is injected so this module has no import
 * dependency on chessParser.ts (avoiding a circular dependency).
 */

import { Chess } from 'chess.js';

export interface MoveSuggestion {
  san: string;
  /** consecutive subsequent raw tokens that validate after playing this move */
  validatesNext: number;
}

type ValidateFn = (chess: Chess, raw: string) => string | null;

const MAX_LOOKAHEAD = 8;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the top `maxResults` legal moves most likely to be what OCR misread.
 *
 * @param fen          Board position immediately BEFORE the erroneous move
 * @param rawToken     The raw OCR string for this move
 * @param subsequentRaws  Raw OCR strings for the moves that follow
 * @param validate     findValidSan or equivalent (non-mutating)
 * @param maxResults   How many suggestions to return (default 5)
 */
export function inferLikelyMoves(
  fen: string,
  rawToken: string,
  subsequentRaws: string[],
  validate: ValidateFn,
  maxResults = 5
): MoveSuggestion[] {
  const chess = new Chess(fen);
  const legalSans = chess.moves() as string[];
  if (legalSans.length === 0) return [];

  // Only look ahead at non-empty subsequent tokens
  const upcoming = subsequentRaws.filter(r => r.trim()).slice(0, MAX_LOOKAHEAD);

  const scored = legalSans.map(san => {
    const textScore = ocrSimilarity(rawToken, san);
    const validatesNext = forwardValidate(fen, san, upcoming, validate);
    // Combined score — forward wins; text breaks ties
    const combined = validatesNext * 0.8 + textScore * 0.2;
    return { san, validatesNext, combined, textScore };
  });

  // Sort: most consecutive validations first; combined score as tie-break
  scored.sort((a, b) =>
    b.validatesNext - a.validatesNext ||
    b.combined - a.combined ||
    b.textScore - a.textScore
  );

  return scored.slice(0, maxResults).map(({ san, validatesNext }) => ({ san, validatesNext }));
}

// ── Forward validation ────────────────────────────────────────────────────────

/**
 * Play `tryMove`, then greedily advance through `raws` using the OCR validator.
 * Returns the count of consecutive raws that successfully validate.
 */
function forwardValidate(
  fen: string,
  tryMove: string,
  raws: string[],
  validate: ValidateFn
): number {
  const chess = new Chess(fen);
  try {
    chess.move(tryMove);
  } catch {
    return 0;
  }

  let count = 0;
  for (const raw of raws) {
    const san = validate(chess, raw);
    if (san) {
      count++;
      chess.move(san);
    } else {
      break; // stop at first failure — consecutive run is the signal
    }
  }
  return count;
}

// ── OCR / text similarity ─────────────────────────────────────────────────────

/**
 * Score how likely `raw` (post OCR-correction) represents `san`.
 * Returns 0–1.
 */
export function ocrSimilarity(raw: string, san: string): number {
  const r = fixOcr(raw).toUpperCase().replace(/[+#]/g, '');
  const s = san.toUpperCase().replace(/[+#]/g, '');

  if (!r || !s) return 0;
  if (r === s) return 1.0;

  // ── Castling ──
  const isLongCastle = (t: string) => t === 'O-O-O' || t === '0-0-0';
  const isShortCastle = (t: string) => (t === 'O-O' || t === '0-0');
  if (isLongCastle(r) && isLongCastle(s)) return 1.0;
  if (isShortCastle(r) && isShortCastle(s)) return 1.0;
  // Penalise castling vs non-castling confusion
  if ((isLongCastle(r) || isShortCastle(r)) !== (isLongCastle(s) || isShortCastle(s))) return 0.0;

  let score = 0;

  // Piece letter (KQRBN or empty for pawn)
  const rPiece = /^([KQRBN])/.exec(r)?.[1] ?? '';
  const sPiece = /^([KQRBN])/.exec(s)?.[1] ?? '';
  if (rPiece === sPiece) score += 0.25;
  else if (!rPiece && sPiece) score += 0.05;  // OCR dropped piece letter
  else if (rPiece && !sPiece) score += 0.05;  // OCR added spurious piece letter

  // Destination square — last [A-H][1-8] sequence in the string
  const destRe = /([A-H])([1-8])[^A-H1-8]*$/;
  const rDest = destRe.exec(r);
  const sDest = destRe.exec(s);
  if (rDest && sDest) {
    if (rDest[1] === sDest[1]) score += 0.35;  // same destination file
    if (rDest[2] === sDest[2]) score += 0.35;  // same destination rank
  }

  // Capture flag
  const rCap = r.includes('X');
  const sCap = s.includes('X');
  if (rCap === sCap) score += 0.05;

  return Math.min(1, Math.max(0, score));
}

/** Apply the same OCR corrections used by cleanChessToken, for comparison purposes. */
function fixOcr(raw: string): string {
  return raw
    .replace(/S/g, '5')
    .replace(/[lI|]/g, '1')
    .replace(/Z/g, '2')
    .replace(/[×✕]/g, 'x')
    .replace(/–/g, '-')
    .replace(/^0-0-0([+#]?)$/i, 'O-O-O$1')
    .replace(/^0-0([+#]?)$/i, 'O-O$1');
}
