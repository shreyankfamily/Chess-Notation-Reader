import Tesseract from 'tesseract.js';
import type { GameInfo } from '../types';
import { runClaudeOcr } from './claudeOcr';

export interface OcrResult {
  rawText: string;
  gameInfo: Partial<GameInfo>;
  // Keyed by move number so pages can be merged correctly
  movePairs: { num: number; white: string; black: string }[];
  rawMoveTokens: string[]; // flat array: [white1, black1, white2, black2, ...]
}

// ── Image preprocessing (grayscale + contrast boost) ─────────────────────────

async function preprocessImage(file: File): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const stretched = Math.min(255, Math.max(0, ((gray - 80) / 100) * 255));
        d[i] = d[i + 1] = d[i + 2] = stretched;
      }

      ctx.putImageData(imageData, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/png'));
    };

    img.src = url;
  });
}

// ── Raw text → move pairs parser ──────────────────────────────────────────────

export function extractMovePairs(text: string): { num: number; white: string; black: string }[] {
  const pairs: { num: number; white: string; black: string }[] = [];
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const moveLineRe = /^(\d{1,3})[.):\s]+(\S+)(?:\s+(\S+))?/;

  for (const line of lines) {
    const m = line.match(moveLineRe);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    if (num < 1 || num > 300) continue;

    const white = m[2] ?? '';
    const black = m[3] ?? '';

    if (white.length < 2 && !/^[KQRBN]$/.test(white)) continue;
    if (pairs.some(p => p.num === num)) continue;

    pairs.push({ num, white, black });
  }

  pairs.sort((a, b) => a.num - b.num);
  return pairs;
}

function flattenPairs(pairs: { num: number; white: string; black: string }[]): string[] {
  const tokens: string[] = [];
  for (const { white, black } of pairs) {
    tokens.push(white);
    if (black) tokens.push(black);
  }
  return tokens;
}

// ── Merge pairs from multiple pages ──────────────────────────────────────────
// Later pages win when the same move number appears on both (user can re-scan a page).

export function mergeMovePairs(
  pages: { num: number; white: string; black: string }[][]
): { num: number; white: string; black: string }[] {
  const map = new Map<number, { num: number; white: string; black: string }>();
  for (const page of pages) {
    for (const pair of page) {
      map.set(pair.num, pair);
    }
  }
  return [...map.values()].sort((a, b) => a.num - b.num);
}

// ── Game info extraction ──────────────────────────────────────────────────────

export function extractGameInfo(text: string): Partial<GameInfo> {
  const info: Partial<GameInfo> = {};
  const lines = text.split('\n').map(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    if (lower.includes('white') && i + 1 < lines.length) {
      const candidate = lines[i + 1].trim();
      if (candidate.length > 2 && !/^\d+/.test(candidate)) info.white = candidate;
    }
    if (lower.includes('black') && i + 1 < lines.length) {
      const candidate = lines[i + 1].trim();
      if (candidate.length > 2 && !/^\d+/.test(candidate)) info.black = candidate;
    }
  }

  const dateMatch = text.match(/\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (dateMatch) {
    info.date = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
  }

  if (/1-0/.test(text)) info.result = '1-0';
  else if (/0-1/.test(text)) info.result = '0-1';
  else if (/1\/2-1\/2|½-½/.test(text)) info.result = '1/2-1/2';

  return info;
}

// ── Single-file OCR ───────────────────────────────────────────────────────────

export async function runOcr(
  file: File,
  onProgress: (pct: number) => void
): Promise<OcrResult> {
  const preprocessed = await preprocessImage(file);
  onProgress(10);

  const { data } = await Tesseract.recognize(preprocessed, 'eng', {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') {
        onProgress(10 + Math.round(m.progress * 85));
      }
    },
  });

  onProgress(95);
  const rawText: string = data.text;
  const movePairs = extractMovePairs(rawText);
  const rawMoveTokens = flattenPairs(movePairs);
  const gameInfo = extractGameInfo(rawText);

  onProgress(100);
  return { rawText, gameInfo, movePairs, rawMoveTokens };
}

// ── Multi-file OCR (up to 2 pages) ───────────────────────────────────────────
// Uses Claude multimodal if an API key is provided; falls back to Tesseract.

export async function runOcrMulti(
  files: File[],
  onProgress: (pct: number) => void,
  apiKey?: string
): Promise<{ combined: OcrResult; perPage: OcrResult[] }> {
  if (apiKey) {
    return runOcrMultiClaude(files, onProgress, apiKey);
  }
  return runOcrMultiTesseract(files, onProgress);
}

async function runOcrMultiClaude(
  files: File[],
  onProgress: (pct: number) => void,
  apiKey: string
): Promise<{ combined: OcrResult; perPage: OcrResult[] }> {
  const { movePairs, gameInfo, rawText } = await runClaudeOcr(apiKey, files, onProgress);

  const rawMoveTokens = flattenPairs(movePairs);
  const combined: OcrResult = {
    rawText,
    gameInfo,
    movePairs,
    rawMoveTokens,
  };
  // perPage not meaningful for a single Claude call — return combined as one page
  return { combined, perPage: [combined] };
}

async function runOcrMultiTesseract(
  files: File[],
  onProgress: (pct: number) => void
): Promise<{ combined: OcrResult; perPage: OcrResult[] }> {
  const perPage: OcrResult[] = [];
  const step = 100 / files.length;

  for (let i = 0; i < files.length; i++) {
    const result = await runOcr(files[i], (pct) => {
      onProgress(Math.round(i * step + pct * step / 100));
    });
    perPage.push(result);
  }

  const merged = mergeMovePairs(perPage.map(r => r.movePairs));
  const rawMoveTokens = flattenPairs(merged);

  const gameInfo: Partial<GameInfo> = {};
  for (const r of perPage) {
    for (const key of Object.keys(r.gameInfo) as (keyof GameInfo)[]) {
      if (!gameInfo[key] && r.gameInfo[key]) {
        (gameInfo as Record<string, string>)[key] = r.gameInfo[key] as string;
      }
    }
  }

  const combined: OcrResult = {
    rawText: perPage.map((r, i) => `--- Page ${i + 1} ---\n${r.rawText}`).join('\n\n'),
    gameInfo,
    movePairs: merged,
    rawMoveTokens,
  };

  return { combined, perPage };
}
