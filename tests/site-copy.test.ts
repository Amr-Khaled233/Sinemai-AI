import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IntlMessageFormat } from 'intl-messageformat';
import { applyOverrides, checkOverride, flattenMessages, variablesOf, type Messages } from '../src/lib/site-copy';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

describe('shipped messages', () => {
  // A message that does not parse breaks every page that uses it, and a stray
  // brace in plain prose ("like {count}") is exactly how that happens.
  for (const [locale, messages] of [['en', en], ['ar', ar]] as const) {
    it(`every ${locale} message parses as ICU`, () => {
      const broken: string[] = [];
      for (const [key, text] of Object.entries(flattenMessages(messages as Messages))) {
        try {
          new IntlMessageFormat(text, locale);
        } catch {
          broken.push(key);
        }
      }
      assert.deepEqual(broken, []);
    });
  }

  it('Arabic uses no variable English does not', () => {
    const flatEn = flattenMessages(en as Messages);
    const flatAr = flattenMessages(ar as Messages);
    const mismatched = Object.keys(flatEn).filter((key) => {
      if (!(key in flatAr)) return false;
      const allowed = variablesOf(flatEn[key]);
      return [...variablesOf(flatAr[key])].some((name) => !allowed.has(name));
    });
    assert.deepEqual(mismatched, []);
  });
});

describe('checkOverride', () => {
  const original = '{count, plural, one {# project} other {# projects}} in {city}';

  it('accepts a rewrite that keeps to the same variables', () => {
    assert.equal(checkOverride(original, '{count} projects'), null);
  });

  it('accepts dropping a variable', () => {
    assert.equal(checkOverride(original, 'Projects'), null);
  });

  it('rejects a variable the site does not pass', () => {
    assert.deepEqual(checkOverride(original, 'Hello {name}'), { unknownVariables: ['name'] });
  });

  it('rejects unbalanced braces and empty text', () => {
    assert.equal(checkOverride(original, 'Hello {count'), 'SYNTAX');
    assert.equal(checkOverride(original, '   '), 'EMPTY');
  });

  it('finds variables inside plural branches', () => {
    assert.deepEqual([...variablesOf('{n, plural, one {# of {total}} other {many}}')].sort(), ['n', 'total']);
  });
});

describe('applyOverrides', () => {
  const messages: Messages = { landing: { title: 'Old', body: 'Body' } };

  it('replaces existing keys and leaves the source untouched', () => {
    const result = applyOverrides(messages, { 'landing.title': 'New' });
    assert.equal((result.landing as Messages).title, 'New');
    assert.equal((messages.landing as Messages).title, 'Old');
  });

  it('ignores keys the code no longer has', () => {
    const result = applyOverrides(messages, { 'landing.gone': 'x', 'missing.key': 'y' });
    assert.deepEqual(result, messages);
  });
});
