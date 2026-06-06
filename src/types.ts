export interface GameInfo {
  event: string;
  site: string;
  date: string;
  round: string;
  white: string;
  whiteElo: string;
  black: string;
  blackElo: string;
  timeControl: string;
  result: string;
}

export interface MoveSuggestion {
  san: string;
  /** consecutive subsequent raw tokens that validate after playing this move */
  validatesNext: number;
}

export interface HalfMove {
  id: string;
  ply: number;        // 0-indexed: 0=white move 1, 1=black move 1, etc.
  raw: string;        // text from OCR or user edit
  san: string | null; // validated SAN; null if invalid
  valid: boolean;
  unknown: boolean;   // true if we couldn't validate because a prior move was invalid
  errorMsg: string;
  suggestions?: MoveSuggestion[]; // inferred candidates when invalid
  swapSuggested?: boolean;        // column-swap pattern detected from this ply
  swapFromPly?: number;           // the even ply where the swap begins
}

export type OcrStatus = 'idle' | 'loading' | 'done' | 'error';
