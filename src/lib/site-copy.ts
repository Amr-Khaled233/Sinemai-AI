import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/**
 * Editable site copy.
 *
 * The message files in /messages stay the source of truth and ship with the
 * code; the admin's edits are stored as overrides on top, keyed by the dotted
 * message path ("landing.heroTitle"). Resetting a key removes its override and
 * the original comes back.
 *
 * An edit is checked before it is saved, because a broken message breaks every
 * page that uses it: it has to parse as ICU, and it may only use variables the
 * original already uses — the code that renders it supplies exactly those.
 */

export type Messages = { [key: string]: string | Messages };
/** locale → dotted key → text */
export type CopyOverrides = Record<string, Record<string, string>>;

export const MAX_COPY_LENGTH = 2000;

export function flattenMessages(messages: Messages, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flattenMessages(value, path));
  }
  return out;
}

/** A copy of the messages with the overrides written in. Unknown keys are ignored. */
export function applyOverrides(messages: Messages, overrides: Record<string, string> | undefined): Messages {
  if (!overrides || Object.keys(overrides).length === 0) return messages;
  const copy = structuredClone(messages);
  for (const [path, text] of Object.entries(overrides)) {
    const parts = path.split('.');
    let node: Messages | string | undefined = copy;
    for (const part of parts.slice(0, -1)) {
      node = typeof node === 'object' ? node[part] : undefined;
    }
    const leaf = parts[parts.length - 1];
    // Only an existing string is replaced; a stale override for a key the code
    // no longer has must not invent one.
    if (typeof node === 'object' && typeof node[leaf] === 'string') node[leaf] = text;
  }
  return copy;
}

/** Every variable a message reads, including those inside plural and select branches. */
export function variablesOf(message: string): Set<string> {
  const names = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      if ('value' in element && element.type !== TYPE.literal && typeof element.value === 'string') {
        names.add(element.value);
      }
      if ('options' in element) {
        for (const option of Object.values(element.options)) walk(option.value);
      }
      if ('children' in element) walk(element.children);
    }
  };
  walk(parse(message));
  return names;
}

export type CopyProblem = 'EMPTY' | 'TOO_LONG' | 'SYNTAX' | { unknownVariables: string[] };

/** Why an edit cannot be saved, or null when it is safe. */
export function checkOverride(original: string, candidate: string): CopyProblem | null {
  if (!candidate.trim()) return 'EMPTY';
  if (candidate.length > MAX_COPY_LENGTH) return 'TOO_LONG';

  let used: Set<string>;
  try {
    used = variablesOf(candidate);
  } catch {
    return 'SYNTAX';
  }
  const allowed = variablesOf(original);
  const unknown = [...used].filter((name) => !allowed.has(name));
  return unknown.length ? { unknownVariables: unknown } : null;
}
