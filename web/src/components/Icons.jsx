const base = {
  width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};

export const Play = () => <svg {...base}><polygon points="6 4 20 12 6 20 6 4" /></svg>;
export const Stop = () => <svg {...base}><rect x="6" y="6" width="12" height="12" rx="1" /></svg>;
export const Restart = () => (
  <svg {...base}><path d="M3 12a9 9 0 1 0 3-6.7" /><polyline points="3 4 3 10 9 10" /></svg>
);
export const Logs = () => (
  <svg {...base}><path d="M4 6h16M4 12h16M4 18h10" /></svg>
);
export const Chevron = ({ open }) => (
  <svg {...base} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
    <polyline points="9 6 15 12 9 18" />
  </svg>
);
export const Search = () => (
  <svg {...base}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
);
export const Anchor = () => (
  <svg {...base} width="22" height="22">
    <circle cx="12" cy="5" r="2" /><line x1="12" y1="7" x2="12" y2="21" />
    <path d="M5 12H3a9 9 0 0 0 18 0h-2" /><line x1="8" y1="11" x2="16" y2="11" />
  </svg>
);
export const Broom = () => (
  <svg {...base}><path d="M19 3l-7 7" /><path d="M14 8l4 4-6 6c-2 2-6 3-9 3 0-3 1-7 3-9l6-6z" /><path d="M7 15l2 2" /></svg>
);
