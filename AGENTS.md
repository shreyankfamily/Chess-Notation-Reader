# Chess Scoresheet Notator project guidance

React/TypeScript/Vite app for converting handwritten chess scoresheets into a
validated move list and downloadable PGN.

## Working rules

- Use `npm run dev` for local development and `npm run build` for production
  verification.
- Preserve chess legality validation when changing OCR cleanup, move
  inference, or board-correction behavior.
- The optional Anthropic API integration is an application feature and is
  independent of the locally installed Claude applications. Tesseract remains
  the fallback when no API key is configured.
- API keys are user-provided browser state. Never hard-code, commit, print, or
  otherwise expose them.
- Keep browser persistence backward-compatible when changing the localStorage
  keys used for game details, OCR tokens, moves, or image previews.

## Verification and delivery

- Run `npm run build` after code or configuration changes; this runs TypeScript
  before the Vite build.
- Pushes to `main` deploy through `.github/workflows/deploy.yml`.
- Do not commit generated build output or user-provided scoresheet images.

## Optional local history

If `.agents/memory/MEMORY.md` exists locally, it contains migrated historical
context. Consult only relevant entries and validate dated details against the
current code before acting on them.
