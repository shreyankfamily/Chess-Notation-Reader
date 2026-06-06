import Anthropic from '@anthropic-ai/sdk';
import type { GameInfo } from '../types';

const CHESS_PROMPT = `You are an expert at reading handwritten chess scoresheets. Extract all chess moves visible in the image(s).

VALID CHESS NOTATION:
- Pieces: K (King), Q (Queen), R (Rook), B (Bishop), N (Knight) — pawns have no letter prefix
- Files: lowercase a-h only
- Ranks: digits 1-8 only
- Captures: lowercase x
- Check: +, Checkmate: #
- Castling: O-O (kingside) or O-O-O (queenside) — use capital O, never digit zero
- Promotion: e.g., e8=Q

HANDWRITING CORRECTION RULES — apply every rule to every move:
- Any 'S' or 's' where a rank digit is expected → '5' (no such letter in chess)
- Any 'l' (lowercase L) or 'I' where a rank digit is expected → '1'
- Any 'Z' where a rank digit is expected → '2'
- '0-0', 'o-o' → 'O-O'; '0-0-0', 'o-o-o' → 'O-O-O'
- Uppercase file letters A through H → lowercase (a through h)
- '×', 'X' used as a capture symbol → 'x'
- If a move number is missing or unclear, continue the sequence from context

Return ONLY a raw JSON object — no markdown, no code fences, no explanation:
{"moves":[{"n":1,"w":"e4","b":"e5"},{"n":2,"w":"Nf3","b":"Nc6"}],"white":null,"black":null,"event":null,"date":null,"result":null}

Rules for the JSON:
- "moves": array of all move pairs in game order
- "n": move number (integer)
- "w": White's move in corrected SAN notation
- "b": Black's move (empty string "" if the game ended on White's move)
- "white"/"black": player names from the scoresheet header, or null
- "event": tournament/event name from the header, or null
- "date": date in YYYY-MM-DD format, or null
- "result": "1-0", "0-1", "1/2-1/2", or null
- If a move is truly illegible, make your best guess based on chess context`;

interface ClaudeMove { n: number; w: string; b: string; }
interface ClaudeResponse {
  moves: ClaudeMove[];
  white: string | null;
  black: string | null;
  event: string | null;
  date: string | null;
  result: string | null;
}

async function fileToBase64(file: File): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const commaIdx = result.indexOf(',');
      const data = result.slice(commaIdx + 1);
      const rawType = result.slice(5, commaIdx).split(';')[0];
      const supported = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const mediaType = (supported.includes(rawType) ? rawType : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      resolve({ data, mediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function extractJson(text: string): string {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // Find the first { ... } block
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) return text.slice(start, end + 1);
  return text.trim();
}

export async function runClaudeOcr(
  apiKey: string,
  files: File[],
  onProgress: (pct: number) => void
): Promise<{
  movePairs: { num: number; white: string; black: string }[];
  gameInfo: Partial<GameInfo>;
  rawText: string;
}> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  onProgress(15);

  // Build image blocks from all files
  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const file of files) {
    const { data, mediaType } = await fileToBase64(file);
    imageBlocks.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
  }
  onProgress(25);

  const promptText = files.length > 1
    ? `${CHESS_PROMPT}\n\nNote: The ${files.length} images are sequential pages of the same game. Extract all moves in order.`
    : CHESS_PROMPT;

  const content: Anthropic.ContentBlockParam[] = [
    ...imageBlocks,
    { type: 'text', text: promptText },
  ];

  const response = await client.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  onProgress(88);

  const textBlock = response.content.find(b => b.type === 'text');
  const rawText = textBlock?.type === 'text' ? textBlock.text : '';

  let parsed: ClaudeResponse;
  try {
    parsed = JSON.parse(extractJson(rawText));
  } catch {
    throw new Error(`Failed to parse Claude response as JSON.\n\nClaude said:\n${rawText.slice(0, 500)}`);
  }

  const movePairs = (parsed.moves || []).map(m => ({
    num: m.n,
    white: m.w || '',
    black: m.b || '',
  }));

  const VALID_RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);
  const gameInfo: Partial<GameInfo> = {};
  if (parsed.white) gameInfo.white = parsed.white;
  if (parsed.black) gameInfo.black = parsed.black;
  if (parsed.event) gameInfo.event = parsed.event;
  if (parsed.date) gameInfo.date = parsed.date;
  if (parsed.result && VALID_RESULTS.has(parsed.result)) gameInfo.result = parsed.result;

  onProgress(100);

  return {
    movePairs,
    gameInfo,
    rawText: `Claude AI scan:\n${JSON.stringify(parsed, null, 2)}`,
  };
}
