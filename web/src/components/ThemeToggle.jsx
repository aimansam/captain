import { useState } from 'react';
import { Monitor, Moon, Sun } from './Icons.jsx';

const KEY = 'captain-theme';
const ORDER = ['system', 'light', 'dark'];
const ICONS = { system: Monitor, light: Sun, dark: Moon };

function read() {
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.includes(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch { /* storage unavailable: the choice just won't persist */ }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(read);
  const Icon = ICONS[theme];
  const label = `Theme: ${theme}. Click to switch.`;

  const next = () => {
    const n = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    apply(n);
    setTheme(n);
  };

  return (
    <button className="ghost icon theme-toggle" title={label} aria-label={label} onClick={next}>
      <Icon />
    </button>
  );
}
