import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SCOPES, SHELL_SCOPE, pickMessages, type ScopeName } from '../src/i18n/scopes';
import ar from '../messages/ar.json';
import en from '../messages/en.json';

/**
 * Scoping messages per area saves bytes and stops an anonymous reader from
 * pulling the admin strings out of the landing page's HTML — but it turns a
 * forgotten namespace into a missing translation at runtime.
 *
 * So this walks the real import graph of every page, finds the client
 * components it renders, and checks that whatever they ask for is actually
 * served. It also checks the reverse, because a namespace nobody uses is a
 * namespace being leaked for no reason.
 */

const APP = path.join(process.cwd(), 'src', 'app', '[locale]');

function read(file: string) {
  return fs.readFileSync(file, 'utf8');
}

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

/** Resolves an import specifier to a file on disk, or null when it is a package. */
function resolveImport(specifier: string, fromFile: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = path.join(process.cwd(), 'src', specifier.slice(2));
  else if (specifier.startsWith('.')) base = path.resolve(path.dirname(fromFile), specifier);
  else return null;

  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    path.join(base, 'index.tsx'),
    path.join(base, 'index.ts'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importsOf(file: string): string[] {
  const source = read(file);
  const specifiers = [...source.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers.map((specifier) => resolveImport(specifier, file)).filter((f): f is string => f !== null);
}

const isClient = (file: string) => /^['"]use client['"]/m.test(read(file));

function namespacesIn(file: string): string[] {
  return [...read(file).matchAll(/useTranslations\(\s*['"]([A-Za-z0-9_]+)['"]\s*\)/g)].map((m) => m[1]);
}

/** Every namespace requested by a client component reachable from this entry point. */
function clientNamespaces(entry: string): Map<string, string[]> {
  const found = new Map<string, string[]>(); // namespace -> components asking for it
  const seen = new Set<string>();

  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (isClient(file)) {
      for (const namespace of namespacesIn(file)) {
        const users = found.get(namespace) ?? [];
        users.push(path.relative(process.cwd(), file));
        found.set(namespace, users);
      }
    }
    for (const next of importsOf(file)) visit(next);
  };

  visit(entry);
  return found;
}

/** The scope a page is served under, from its position in the route tree. */
function scopeOf(pageFile: string): ScopeName | null {
  const relative = path.relative(APP, pageFile).split(path.sep);
  const segment = relative[0];
  if (segment === '(auth)') return 'auth';
  if (segment in SCOPES) return segment as ScopeName;
  return null; // shell only: the landing page
}

const pages = walk(APP, (file) => path.basename(file) === 'page.tsx');

describe('client message scopes', () => {
  it('finds every page', () => {
    assert.ok(pages.length >= 14, `expected the whole route tree, saw ${pages.length}`);
  });

  for (const page of pages) {
    const label = path.relative(APP, page).replace(/\\/g, '/');

    it(`serves every namespace ${label} asks for`, () => {
      const scope = scopeOf(page);
      const served = new Set<string>([...SHELL_SCOPE, ...(scope ? SCOPES[scope] : [])]);
      const requested = clientNamespaces(page);

      for (const [namespace, users] of requested) {
        assert.ok(
          served.has(namespace),
          `${label} renders ${users.join(', ')} which needs "${namespace}", but its scope (${
            scope ?? 'shell only'
          }) serves ${[...served].join(', ')}`,
        );
      }
    });
  }

  it('serves nothing an area does not use', () => {
    const usedByScope = new Map<ScopeName, Set<string>>();
    for (const page of pages) {
      const scope = scopeOf(page);
      if (!scope) continue;
      const used = usedByScope.get(scope) ?? new Set<string>();
      for (const namespace of clientNamespaces(page).keys()) used.add(namespace);
      usedByScope.set(scope, used);
    }

    for (const [scope, namespaces] of Object.entries(SCOPES) as Array<[ScopeName, readonly string[]]>) {
      const used = usedByScope.get(scope);
      assert.ok(used, `no page maps to the "${scope}" scope`);
      for (const namespace of namespaces) {
        assert.ok(
          used.has(namespace),
          `the "${scope}" scope serves "${namespace}" but no client component under it uses it`,
        );
      }
    }
  });

  it('keeps the landing page down to the shell', () => {
    const landing = path.join(APP, 'page.tsx');
    const requested = [...clientNamespaces(landing).keys()];
    for (const namespace of requested) {
      assert.ok(SHELL_SCOPE.includes(namespace as (typeof SHELL_SCOPE)[number]));
    }
  });

  it('names only namespaces that exist, in both catalogs', () => {
    const all = new Set([...SHELL_SCOPE, ...Object.values(SCOPES).flat()]);
    for (const namespace of all) {
      assert.ok(namespace in ar, `messages/ar.json has no "${namespace}"`);
      assert.ok(namespace in en, `messages/en.json has no "${namespace}"`);
    }
  });
});

describe('pickMessages', () => {
  it('copies out only what was asked for', () => {
    const picked = pickMessages(ar as never, ['nav', 'theme']);
    assert.deepEqual(Object.keys(picked).sort(), ['nav', 'theme']);
  });

  it('skips a namespace the catalog does not have rather than writing undefined', () => {
    const picked = pickMessages(ar as never, ['nav', 'nope']);
    assert.deepEqual(Object.keys(picked), ['nav']);
    assert.ok(!('nope' in picked));
  });

  it('ships a fraction of the catalog to the shell', () => {
    const whole = Buffer.byteLength(JSON.stringify(ar), 'utf8');
    const shell = Buffer.byteLength(JSON.stringify(pickMessages(ar as never, SHELL_SCOPE)), 'utf8');
    assert.ok(shell < whole / 5, `shell is ${shell}B of ${whole}B, expected well under a fifth`);
  });
});
