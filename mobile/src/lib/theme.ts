/** GitHub-dark palette. */
export const colors = {
  bg: '#0d1117',
  card: '#161b22',
  cardAlt: '#1c2128',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  faint: '#6e7681',
  accent: '#f0883e', // orange — brand
  blue: '#58a6ff',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  purple: '#bc8cff',
};

/** Score → colour: ≥85 red (fire), ≥70 yellow, ≥40 blue, else muted. */
export function scoreColor(score: number): string {
  if (score >= 85) return colors.red;
  if (score >= 70) return colors.yellow;
  if (score >= 40) return colors.blue;
  return colors.muted;
}

/** Hex colour + alpha (0-1) → rgba string for tinted backgrounds. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

export const HOT_THRESHOLD = 70;
