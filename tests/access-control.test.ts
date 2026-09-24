import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { exportFileName } from '../src/lib/sheet-export';

/**
 * A static audit of the authorisation surface, run on every push.
 *
 * Reviewing this by hand found real holes before; the point of doing it in a
 * test is that the next server action or route handler cannot quietly skip a
 * guard. It reads the source rather than executing it, so it needs no database
 * and no session — the trade-off being that it checks that a guard is called,
 * not that the guard is correct. The guards themselves are covered elsewhere.
 */

const ROOT = process.cwd();
const ACTIONS_DIR = path.join(ROOT, 'src', 'app', 'actions');
const API_DIR = path.join(ROOT, 'src', 'app', 'api');

const read = (file: string) => fs.readFileSync(file, 'utf8');

function walk(dir: string, match: (file: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

/** Splits a module into its exported async functions. */
function exportedFunctions(source: string): Array<{ name: string; body: string }> {
  return source
    .split(/\nexport async function /)
    .slice(1)
    .map((part) => ({
      name: part.slice(0, part.indexOf('(')),
      body: part.split(/\nexport /)[0],
    }));
}

const GUARD =
  /require(?:Session|Roles|Admin|Producer|VendorProfile|DopProfile|OwnedProject|User|Role)\s*\(|participantFor\s*\(/;

describe('server actions', () => {
  const files = fs
    .readdirSync(ACTIONS_DIR)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => path.join(ACTIONS_DIR, file))
    .filter((file) => /^'use server'/m.test(read(file)));

  it('finds the action modules', () => {
    assert.ok(files.length >= 5, `expected the action layer, saw ${files.length} modules`);
  });

  for (const file of files) {
    const source = read(file);
    const functions = exportedFunctions(source);
    const label = path.basename(file);

    for (const fn of functions) {
      it(`${label}: ${fn.name} checks who is calling`, () => {
        if (GUARD.test(fn.body)) return;

        // A thin `…Form(formData)` wrapper is allowed, as long as what it
        // delegates to is itself guarded — that is how the form actions that
        // must return void reach a guarded implementation.
        const delegate = fn.body.match(/await\s+([A-Za-z0-9_]+)\s*\(/)?.[1];
        const target = delegate ? functions.find((candidate) => candidate.name === delegate) : undefined;

        assert.ok(
          target && GUARD.test(target.body),
          `${label}: ${fn.name} calls no guard${
            delegate ? ` and delegates to ${delegate}, which does not either` : ''
          }`,
        );
      });
    }
  }
});

describe('route handlers', () => {
  /**
   * Routes that are meant to be reachable without a session, and what stands in
   * for one. Anything not listed has to authenticate a user.
   */
  const PUBLIC: Record<string, RegExp> = {
    'api/register/route.ts': /consumeRateLimit/,
    'api/auth/forgot/route.ts': /consumeRateLimit/,
    'api/auth/reset/route.ts': /consumeRateLimit/,
    // NextAuth's own handler, which authenticates by definition.
    'api/auth/[...nextauth]/route.ts': /NextAuth\(authOptions\)/,
    // Cron jobs present a shared secret instead of a session.
    'api/cron/availability-cleanup/route.ts': /isAuthorizedJob/,
    'api/cron/reembed-dops/route.ts': /isAuthorizedJob/,
    // Exports accept a share token in place of a session.
    'api/projects/[id]/pdf/route.ts': /authoriseExport/,
    'api/projects/[id]/xlsx/route.ts': /authoriseExport/,
  };

  const routes = walk(API_DIR, (file) => path.basename(file) === 'route.ts');

  it('finds the route handlers', () => {
    assert.ok(routes.length >= 8, `expected the api surface, saw ${routes.length} routes`);
  });

  for (const route of routes) {
    const relative = path.relative(path.join(ROOT, 'src', 'app'), route).replace(/\\/g, '/');
    const source = read(route);

    it(`${relative} authenticates its caller`, () => {
      const exemption = PUBLIC[relative];
      if (exemption) {
        assert.match(source, exemption, `${relative} is listed as public but no longer checks anything`);
        return;
      }
      assert.match(
        source,
        /auth\(\)|requireSession|requireRole|authoriseExport/,
        `${relative} has no authentication check and is not a documented public route`,
      );
    });
  }

  it('throttles both exports, not just one', () => {
    for (const format of ['pdf', 'xlsx']) {
      const source = read(path.join(API_DIR, 'projects', '[id]', format, 'route.ts'));
      assert.match(source, /throttleExport/, `the ${format} export is not rate limited`);
    }
  });

  it('never compares a share token with a plain equality check', () => {
    const gate = read(path.join(ROOT, 'src', 'lib', 'sheet-export.ts'));
    assert.match(gate, /constantTimeEqual/);
    assert.ok(
      !/link\.token === |=== link\.token/.test(gate),
      'share tokens are secrets and must not be compared with ===',
    );
    // And no route may compare one itself, having been given a helper.
    for (const route of walk(API_DIR, (file) => path.basename(file) === 'route.ts')) {
      assert.ok(!/link\.token ===/.test(read(route)), `${route} compares a token directly`);
    }
  });
});

describe('export file names', () => {
  it('cannot break out of the content-disposition header', () => {
    const name = exportFileName('Night "Delivery"\r\nX-Injected: 1', 'pdf');
    assert.ok(!name.includes('"'));
    assert.ok(!/[\r\n]/.test(name));
    assert.match(name, /^sinemai-.*\.pdf$/);
  });

  it('keeps an Arabic project name readable', () => {
    assert.equal(exportFileName('توصيل ليلي', 'xlsx'), 'sinemai-توصيل-ليلي.xlsx');
  });

  it('caps the length so a long name cannot bloat the header', () => {
    const name = exportFileName('x'.repeat(500), 'pdf');
    assert.ok(name.length <= 80, `header value is ${name.length} characters`);
  });

  it('strips a path traversal attempt', () => {
    const name = exportFileName('../../etc/passwd', 'xlsx');
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('..'));
  });
});
