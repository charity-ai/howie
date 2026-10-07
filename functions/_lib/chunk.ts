/** Cuts text into ~1,800-character passages with 200 characters of overlap (max 200 passages). */
export function chunkText(text: string, size = 1800, overlap = 200, max = 200): string[] {
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const out: string[] = [];
  let start = 0;
  while (start < clean.length && out.length < max) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const floor = start + Math.floor(size * 0.6);
      const window = clean.slice(floor, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = window.lastIndexOf('. ');
      const space = window.lastIndexOf(' ');
      const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : space >= 0 ? space + 1 : -1;
      if (cut > 0) end = floor + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}
