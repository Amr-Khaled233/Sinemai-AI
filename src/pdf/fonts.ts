import { join } from 'node:path';
import { Font } from '@react-pdf/renderer';

/**
 * Arabic PDF support.
 *
 * @react-pdf shapes text through fontkit, which applies the font's OpenType
 * Arabic features — contextual forms and the lam-alef ligature — and emits the
 * glyphs in visual right-to-left order. What it cannot do is invent Arabic
 * glyphs for Helvetica, so an Arabic sheet needs a real Arabic font embedded.
 *
 * IBM Plex Sans Arabic (SIL OFL 1.1) is used because it carries both Arabic and
 * Latin, so "ARRI ALEXA 35" inside an Arabic sentence stays in one typeface.
 */

export const SHEET_FONT = 'PlexSheet';

const FONT_DIR = join(process.cwd(), 'src/pdf/fonts');

let registered = false;

/** Registration is global to the renderer, so it happens once per process. */
export function registerPdfFonts() {
  if (registered) return;
  Font.register({
    family: SHEET_FONT,
    fonts: [
      { src: join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf'), fontWeight: 400 },
      { src: join(FONT_DIR, 'IBMPlexSansArabic-SemiBold.ttf'), fontWeight: 600 },
    ],
  });

  // Arabic has no hyphenation; the default hyphenator would break words
  // mid-script, so it is switched off for the whole document.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

export function fontsFor(locale: string) {
  const isArabic = locale === 'ar';
  // Both languages use the embedded family: IBM Plex Sans Arabic carries Latin
  // too, so an English sheet renders identically everywhere instead of relying
  // on the viewer's copy of Helvetica.
  return {
    isArabic,
    body: SHEET_FONT,
    bold: SHEET_FONT,
    boldWeight: 600 as const,
    direction: (isArabic ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    align: (isArabic ? 'right' : 'left') as 'right' | 'left',
  };
}
