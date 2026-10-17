interface Span {
  start: number;
  text: string;
}

function clean(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function spans(clean: string, size: number, overlap: number, max: number): Span[] {
  if (!clean) return [];
  if (clean.length <= size) return [{ start: 0, text: clean }];

  const out: Span[] = [];
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
    if (piece) out.push({ start, text: piece });
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return out;
}

/** Cuts text into ~1,800-character passages with 200 characters of overlap (max 200 passages). */
export function chunkText(text: string, size = 1800, overlap = 200, max = 200): string[] {
  return spans(clean(text), size, overlap, max).map((s) => s.text);
}

/** Page markers the PDF reader writes at the top of each page: [[page 3]] */
export const PAGE_MARK = /\[\[page (\d{1,4})\]\]/gi;

/**
 * Like chunkText, but also says which page each passage is on.
 * The page is the one the passage starts on (or the first page that starts inside its opening quarter).
 * Text without page markers gets page null. Markers are removed from the passage text.
 */
export function chunkWithPages(
  text: string,
  size = 1800,
  overlap = 200,
  max = 200,
): { text: string; page: number | null }[] {
  const c = clean(text);
  const marks: { at: number; page: number }[] = [];
  for (const m of c.matchAll(PAGE_MARK)) marks.push({ at: m.index ?? 0, page: Number(m[1]) });

  return spans(c, size, overlap, max)
    .map((s) => {
      let page: number | null = null;
      for (const m of marks) {
        if (m.at <= s.start + Math.floor(s.text.length / 4)) page = m.page;
        else break;
      }
      const body = s.text.replace(PAGE_MARK, '').replace(/\n{3,}/g, '\n\n').trim();
      return { text: body, page };
    })
    .filter((p) => p.text.length > 0);
}
