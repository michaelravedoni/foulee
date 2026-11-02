/** Les polices PDF standard ne couvrent que le latin-1 : on remplace le reste proprement. */
const MAP: Record<string, string> = {
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
  '→': '->',
  '≤': '<=',
  '≥': '>=',
  ' ': ' ',
  ' ': ' ',
  'τ': 'tau',
  '✓': 'OK',
  '·': '·',
};

export function pdfText(text: string): string {
  let out = '';
  for (const ch of text) {
    const mapped = MAP[ch];
    if (mapped !== undefined) out += mapped;
    else if (ch.charCodeAt(0) <= 0xff) out += ch;
    else out += '?';
  }
  return out;
}
