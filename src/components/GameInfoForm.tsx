import React from 'react';
import type { GameInfo } from '../types';

interface Props {
  info: GameInfo;
  onChange: (info: GameInfo) => void;
}

const fields: { key: keyof GameInfo; label: string; placeholder?: string }[] = [
  { key: 'event', label: 'Event', placeholder: 'e.g. Irving Swiss' },
  { key: 'site', label: 'Site', placeholder: 'e.g. Irving, TX' },
  { key: 'date', label: 'Date', placeholder: 'YYYY-MM-DD' },
  { key: 'round', label: 'Round', placeholder: '1' },
  { key: 'white', label: 'White', placeholder: 'Player name' },
  { key: 'whiteElo', label: 'White ELO', placeholder: '1500' },
  { key: 'black', label: 'Black', placeholder: 'Player name' },
  { key: 'blackElo', label: 'Black ELO', placeholder: '1500' },
  { key: 'timeControl', label: 'Time Control', placeholder: '90+30' },
];

const resultOptions = ['*', '1-0', '0-1', '1/2-1/2'];

export default function GameInfoForm({ info, onChange }: Props) {
  const set = (key: keyof GameInfo, value: string) =>
    onChange({ ...info, [key]: value });

  return (
    <div className="section">
      <h3 className="section-title">Game Info</h3>
      <div className="form-grid">
        {fields.map(({ key, label, placeholder }) => (
          <label key={key} className="form-row">
            <span className="form-label">{label}</span>
            <input
              className="form-input"
              value={info[key]}
              placeholder={placeholder}
              onChange={e => set(key, e.target.value)}
            />
          </label>
        ))}
        <label className="form-row">
          <span className="form-label">Result</span>
          <select
            className="form-input"
            value={info.result}
            onChange={e => set('result', e.target.value)}
          >
            {resultOptions.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
