import React, { useState } from 'react';

const STORAGE_KEY = 'anthropic_api_key';

export function loadApiKey(): string {
  return localStorage.getItem(STORAGE_KEY) || '';
}

interface Props {
  apiKey: string;
  onChange: (key: string) => void;
}

export default function ApiKeySettings({ apiKey, onChange }: Props) {
  const [expanded, setExpanded] = useState(!apiKey);
  const [draft, setDraft] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    const trimmed = draft.trim();
    localStorage.setItem(STORAGE_KEY, trimmed);
    onChange(trimmed);
    setDraft('');
    setExpanded(false);
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    onChange('');
    setDraft('');
    setExpanded(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setDraft(''); setExpanded(false); }
  };

  return (
    <div className="section api-key-section">
      <div className="api-key-header" onClick={() => setExpanded(e => !e)}>
        <span className="api-key-icon">{apiKey ? '🔑' : '🔒'}</span>
        <span className="api-key-label">
          {apiKey ? 'Claude AI (key configured)' : 'Claude AI — add API key to scan'}
        </span>
        <span className={`api-key-status ${apiKey ? 'ok' : 'warn'}`}>
          {apiKey ? '✓' : '!'}
        </span>
        <span className="api-key-toggle">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="api-key-body">
          {apiKey ? (
            <div className="api-key-configured">
              <span className="api-key-masked">
                {showKey ? apiKey : `sk-ant-...${apiKey.slice(-6)}`}
              </span>
              <button className="btn-ghost btn-xs" onClick={() => setShowKey(v => !v)}>
                {showKey ? 'hide' : 'show'}
              </button>
              <button className="btn-ghost btn-xs danger" onClick={handleClear}>clear</button>
            </div>
          ) : null}

          <div className="api-key-input-row">
            <input
              className="api-key-input"
              type={showKey ? 'text' : 'password'}
              placeholder="sk-ant-api03-..."
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <button
              className="btn-primary btn-sm"
              onClick={handleSave}
              disabled={!draft.trim()}
            >
              Save
            </button>
          </div>
          <p className="api-key-hint">
            Key stored in browser localStorage only. Without a key, Tesseract OCR is used as fallback.
          </p>
        </div>
      )}
    </div>
  );
}
