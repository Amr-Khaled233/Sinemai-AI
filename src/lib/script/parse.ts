import { ParsedFormat, IntExt, TimeOfDay } from '@prisma/client';

/**
 * Screenplay parsing. Deterministic, no LLM involved: the Script Analyst Agent
 * reasons about scenes, but it never gets to decide *what* the scenes are.
 *
 * Supports Fountain, Final Draft (.fdx), PDF and plain text, in English and
 * Arabic heading conventions (داخلي/خارجي · نهار/ليل).
 */

export type ParsedScene = {
  order: number;
  heading: string;
  slug: string | null;
  bodyExcerpt: string;
  intExt: IntExt | null;
  timeOfDay: TimeOfDay | null;
  pageEighths: number;
};

export type ParsedScript = {
  format: ParsedFormat;
  rawText: string;
  scenes: ParsedScene[];
  pageCount: number;
};

// Scene numbers appear in Western digits and in Arabic-Indic digits (١٢٣ / ۱۲۳),
// so every number class here has to cover all three.
const DIGIT = '[\\d٠-٩۰-۹]';
export const SCENE_NUMBER_PREFIX = new RegExp(`(?:scene|sc\\.?|مشهد)\\s*${DIGIT}{1,3}`, 'i');

// Allows a "Scene 3 —", "SC. 12" or "14." prefix before the slug line, which ad
// briefs, treatments and numbered shooting scripts all use.
const EN_HEADING = new RegExp(
  `^(?:(?:scene|sc\\.?)\\s*${DIGIT}{1,3}\\s*[-–—:.]?\\s*|${DIGIT}{1,3}[.)]\\s+)?` +
    '(INT\\.?\\/EXT\\.?|EXT\\.?\\/INT\\.?|I\\/E\\.?|INT\\.?|EXT\\.?|EST\\.?)(?=[\\s.\\-—:])',
  'i',
);
const AR_HEADING = new RegExp(
  `^(?:\\s*مشهد\\s*${DIGIT}*\\s*[-–—:]?\\s*)?(داخلي\\/خارجي|داخلي|خارجي)`,
);
const FORCED_HEADING = /^\./; // Fountain forces a scene heading with a leading dot

const TIME_PATTERNS: Array<[TimeOfDay, RegExp]> = [
  ['DAWN_DUSK', /\b(DAWN|DUSK|MAGIC HOUR|GOLDEN HOUR|SUNSET|SUNRISE|TWILIGHT)\b|فجر|غروب|شروق|مغرب/i],
  ['NIGHT', /\b(NIGHT|LATE NIGHT|MIDNIGHT|EVENING)\b|ليل|مساء|منتصف الليل/i],
  ['DAY', /\b(DAY|MORNING|AFTERNOON|NOON|CONTINUOUS|LATER)\b|نهار|صباح|ظهر|عصر/i],
];

export function isSceneHeading(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (FORCED_HEADING.test(trimmed) && !/^\.{2,}/.test(trimmed)) return true;
  return EN_HEADING.test(trimmed) || AR_HEADING.test(trimmed);
}

export function readIntExt(heading: string): IntExt | null {
  const h = heading.toUpperCase();
  // A combined INT/EXT scene is scheduled and lit as an exterior.
  if (/INT\.?\/EXT|EXT\.?\/INT|\bI\/E\b/.test(h) || /داخلي\/خارجي/.test(heading)) return IntExt.EXTERIOR;
  // Both tests are unanchored: a heading may carry a scene number or a label
  // ("Scene 3 — EXT. ROOFTOP") before the INT/EXT token.
  if (/\b(?:EXT|EST)\b/.test(h) || /خارجي/.test(heading)) return IntExt.EXTERIOR;
  if (/\bINT\b/.test(h) || /داخلي/.test(heading)) return IntExt.INTERIOR;
  return null;
}

export function readTimeOfDay(heading: string): TimeOfDay | null {
  // Match on the tail of the heading first — "INT. DAY CARE - NIGHT" must read as NIGHT.
  const tail = heading.split(/[-–—]/).pop() ?? heading;
  for (const [value, pattern] of TIME_PATTERNS) if (pattern.test(tail)) return value;
  for (const [value, pattern] of TIME_PATTERNS) if (pattern.test(heading)) return value;
  return null;
}

export function readSlug(heading: string) {
  const withoutPrefix = heading
    .replace(FORCED_HEADING, '')
    .replace(EN_HEADING, '')
    .replace(AR_HEADING, '')
    .replace(/^[\s.\-—:]+/, '');
  const slug = withoutPrefix.split(/[-–—]/)[0]?.trim();
  return slug ? slug.slice(0, 120) : null;
}

/** Industry convention: one script page ≈ 8/8, roughly 55 lines of body text. */
function estimateEighths(body: string) {
  const lines = body.split('\n').filter((l) => l.trim().length > 0).length;
  return Math.max(1, Math.round((lines / 55) * 8));
}

export function segmentScenes(text: string): ParsedScene[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const scenes: ParsedScene[] = [];
  let current: { heading: string; body: string[] } | null = null;

  const flush = () => {
    if (!current) return;
    const body = current.body.join('\n').trim();
    const heading = current.heading.replace(FORCED_HEADING, '').trim();
    scenes.push({
      order: scenes.length + 1,
      heading,
      slug: readSlug(heading),
      bodyExcerpt: body.slice(0, 2500),
      intExt: readIntExt(heading),
      timeOfDay: readTimeOfDay(heading),
      pageEighths: estimateEighths(body),
    });
    current = null;
  };

  for (const line of lines) {
    if (isSceneHeading(line)) {
      flush();
      current = { heading: line.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  flush();

  // No recognisable slug lines: treat paragraph blocks as scenes so pasted
  // ad briefs and treatments still break down into shootable units.
  if (scenes.length === 0) {
    const blocks = text
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter((b) => b.length > 40);

    // When most blocks carry an explicit scene marker, the ones that do not are
    // title pages, briefs and production notes — not shootable units.
    const marked = blocks.filter((block) => {
      const firstLine = block.split('\n')[0];
      return (
        /\b(?:INT|EXT|EST|I\/E)\b/i.test(firstLine) ||
        /داخلي|خارجي/.test(firstLine) ||
        SCENE_NUMBER_PREFIX.test(firstLine)
      );
    });
    const usable = marked.length >= 2 ? marked : blocks;

    return usable.slice(0, 120).map((block, index) => {
      const firstLine = block.split('\n')[0].slice(0, 110);
      return {
        order: index + 1,
        heading: firstLine,
        slug: readSlug(firstLine),
        bodyExcerpt: block.slice(0, 2500),
        intExt: readIntExt(block),
        timeOfDay: readTimeOfDay(block),
        pageEighths: estimateEighths(block),
      };
    });
  }

  return scenes;
}

// ------------------------------------------------------------------ formats

export function detectFormat(fileName: string | null, mimeType?: string | null): ParsedFormat {
  const name = (fileName ?? '').toLowerCase();
  if (name.endsWith('.fdx') || mimeType?.includes('xml')) return ParsedFormat.FDX;
  if (name.endsWith('.fountain')) return ParsedFormat.FOUNTAIN;
  if (name.endsWith('.pdf') || mimeType === 'application/pdf') return ParsedFormat.PDF;
  if (name.endsWith('.txt') || name.endsWith('.md')) return ParsedFormat.TXT;
  return ParsedFormat.TXT;
}

/** Strips Fountain boneyard/notes/title page so they cannot pollute scene bodies. */
export function fountainToPlainText(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // boneyard
    .replace(/\[\[[\s\S]*?\]\]/g, '') // notes
    .replace(/^(Title|Credit|Author|Authors|Source|Draft date|Contact|Copyright):.*$/gim, '')
    .replace(/^\s*(?:>\s*)?([A-Z ]+)\s*<\s*$/gm, '$1') // centered text
    .replace(/^#{1,6}\s+/gm, '') // section headers
    .replace(/^=\s.*$/gm, '') // synopses
    .replace(/\*{1,3}|_/g, '')
    .trim();
}

/** Final Draft XML: paragraphs carry an explicit Type attribute, so headings are exact. */
export function fdxToPlainText(xml: string) {
  const paragraphs = [...xml.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)];
  const out: string[] = [];

  for (const [, attrs, inner] of paragraphs) {
    const type = /Type="([^"]+)"/.exec(attrs)?.[1] ?? '';
    const text = [...inner.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)]
      .map((m) => decodeXmlEntities(m[1]))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;

    if (type === 'Scene Heading') out.push('', text.toUpperCase(), '');
    else if (type === 'Character') out.push('', text.toUpperCase());
    else if (type === 'Transition') out.push('', text);
    else out.push(text);
  }

  if (out.length === 0) {
    // Not a recognisable FDX body — fall back to stripping every tag.
    return decodeXmlEntities(xml.replace(/<[^>]+>/g, '\n')).replace(/\n{3,}/g, '\n\n').trim();
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** PDF text extraction via unpdf (pdf.js build with no headless browser). */
export async function pdfToPlainText(buffer: ArrayBuffer) {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n') : text;
  return { text: normalisePdfText(merged), pageCount: totalPages };
}

/**
 * Screenplay PDFs come out of extraction with headings glued onto the action
 * that follows and with page furniture inline; both break scene segmentation.
 */
function normalisePdfText(text: string) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\d{1,3}\s*\.?\s*$/gm, '') // bare page numbers
    .replace(/\(CONTINUED\)|CONTINUED:|\(MORE\)/gi, '')
    .replace(/([a-z"'.,!?])\s+((?:INT|EXT|EST|I\/E)[.\s/])/g, '$1\n\n$2')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ------------------------------------------------------------------ entry point

export async function parseScriptSource(input: {
  format: ParsedFormat;
  text?: string;
  buffer?: ArrayBuffer;
}): Promise<ParsedScript> {
  let rawText = input.text ?? '';
  let pageCount = 0;

  switch (input.format) {
    case ParsedFormat.PDF: {
      if (!input.buffer) throw new Error('PDF parsing requires a file buffer');
      const result = await pdfToPlainText(input.buffer);
      rawText = result.text;
      pageCount = result.pageCount;
      break;
    }
    case ParsedFormat.FDX:
      rawText = fdxToPlainText(rawText);
      break;
    case ParsedFormat.FOUNTAIN:
      rawText = fountainToPlainText(rawText);
      break;
    default:
      rawText = rawText.replace(/\r\n?/g, '\n').trim();
  }

  if (!rawText.trim()) throw new Error('EMPTY_SCRIPT');

  const scenes = segmentScenes(rawText);
  if (scenes.length === 0) throw new Error('NO_SCENES_FOUND');

  const eighths = scenes.reduce((sum, s) => sum + s.pageEighths, 0);
  return {
    format: input.format,
    rawText,
    scenes,
    pageCount: pageCount || Math.max(1, Math.round(eighths / 8)),
  };
}
