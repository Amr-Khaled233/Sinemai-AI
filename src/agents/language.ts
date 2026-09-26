/**
 * Every piece of agent prose that reaches the producer — equipment rationale,
 * cinematographer match reasons, sourcing notes, reviewer findings, the
 * executive summary — is written in the language the producer is using right
 * now, not the language stored on their account.
 *
 * Structured values (enum members, ids, model names, numbers) always stay as
 * they are: they are data, and the UI translates them itself.
 */

export type SupportedLocale = 'ar' | 'en';

export function normaliseLocale(locale: string | null | undefined): SupportedLocale {
  return locale === 'ar' ? 'ar' : 'en';
}

export function languageName(locale: string) {
  return normaliseLocale(locale) === 'ar' ? 'Arabic' : 'English';
}

export function languageDirective(locale: string) {
  return normaliseLocale(locale) === 'ar'
    ? `OUTPUT LANGUAGE: Write every human-readable string in Modern Standard Arabic, using the cinematography vocabulary Arab crews actually use. Keep equipment brands and model names in their original Latin script (ARRI ALEXA 35, SkyPanel S60-C), keep ids, enum values and numbers exactly as given, and never translate a proper name. Do not mix English sentences into the Arabic text.`
    : `OUTPUT LANGUAGE: Write every human-readable string in English. Keep ids, enum values and numbers exactly as given.`;
}

/** Appends the directive to an agent's system prompt. */
export function withLanguage(systemPrompt: string, locale: string) {
  return `${systemPrompt}\n\n${languageDirective(locale)}`;
}
