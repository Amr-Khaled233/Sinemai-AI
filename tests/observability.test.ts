import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fingerprint, redact, reportError } from '../src/lib/observability';

/** Captures what the reporter writes, so the log line itself can be asserted. */
function captureLog(run: () => void) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => lines.push(String(args[0]));
  try {
    run();
  } finally {
    console.error = original;
  }
  return lines;
}

describe('redaction', () => {
  // Everything below has passed through this code path in real payloads.
  const secrets: Array<[string, string]> = [
    ['OpenAI key', 'failed with sk-proj-AbCdEf123456789xyz'],
    ['database URL', 'connect ECONNREFUSED postgresql://user:hunter2@db.neon.tech/main'],
    ['bearer token', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc'],
    ['blob token', 'vercel_blob_rw_AbC123_xyzXYZ'],
    ['resend key', 're_AbCdEf123456'],
  ];

  for (const [label, input] of secrets) {
    it(`removes a ${label}`, () => {
      const output = redact(input);
      assert.ok(output.includes('[redacted]'), `nothing redacted in: ${output}`);
      assert.ok(!/hunter2|sk-proj-AbCdEf|eyJhbGciOi|vercel_blob_rw_AbC|re_AbCdEf/.test(output), output);
    });
  }

  it('leaves ordinary messages intact', () => {
    assert.equal(redact('Scene 4 has no lighting package'), 'Scene 4 has no lighting package');
  });
});

describe('fingerprinting', () => {
  it('groups the same failure across different ids', () => {
    const a = fingerprint('saveScript', 'Project 6f2a91bc not found');
    const b = fingerprint('saveScript', 'Project 0e77ffaa not found');
    assert.equal(a, b);
  });

  it('separates different failures', () => {
    const a = fingerprint('saveScript', 'Project not found');
    const b = fingerprint('saveScript', 'Script too large');
    assert.notEqual(a, b);
  });

  it('separates the same message raised in different places', () => {
    assert.notEqual(fingerprint('saveScript', 'timeout'), fingerprint('analyze', 'timeout'));
  });
});

describe('reportError', () => {
  it('returns a reference the user can quote', () => {
    const lines = captureLog(() => {
      const report = reportError(new Error('boom'), { scope: 'test' });
      assert.match(report.reference, /^[0-9a-f]{8}$/);
    });
    assert.equal(lines.length, 1);
  });

  it('writes one JSON object per failure', () => {
    const lines = captureLog(() => reportError(new Error('boom'), { scope: 'test', userId: 'u1' }));
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(parsed.event, 'app.error');
    assert.equal(parsed.scope, 'test');
    assert.equal(parsed.userId, 'u1');
    assert.equal(parsed.level, 'error');
  });

  it('keeps secrets out of the log line', () => {
    const lines = captureLog(() =>
      reportError(new Error('connect postgresql://user:hunter2@host/db failed'), {
        scope: 'test',
        extra: { apiKey: 'sk-proj-should-not-appear', note: 'sk-proj-also-not-this' },
      }),
    );
    assert.ok(!lines[0].includes('hunter2'), lines[0]);
    assert.ok(!lines[0].includes('should-not-appear'), lines[0]);
    assert.ok(!lines[0].includes('also-not-this'), lines[0]);
  });

  it('never throws, even on a value that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const lines = captureLog(() => {
      const report = reportError(new Error('boom'), { scope: 'test', extra: { circular } });
      assert.ok(report.reference);
    });
    assert.equal(lines.length, 1);
  });

  it('accepts a thrown value that is not an Error', () => {
    captureLog(() => {
      const report = reportError('plain string failure', { scope: 'test' });
      assert.equal(report.message, 'plain string failure');
      assert.equal(report.stack, undefined);
    });
  });
});

describe('webhook forwarding', () => {
  it('posts to ERROR_WEBHOOK_URL when one is configured', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.ERROR_WEBHOOK_URL;
    process.env.ERROR_WEBHOOK_URL = 'https://collector.example/hook';
    globalThis.fetch = mock.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response('ok');
    }) as typeof fetch;

    try {
      captureLog(() => reportError(new Error('boom'), { scope: 'test' }));
      // The post is fire-and-forget, so let the microtask queue drain.
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.deepEqual(calls, ['https://collector.example/hook']);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.ERROR_WEBHOOK_URL;
      else process.env.ERROR_WEBHOOK_URL = originalUrl;
    }
  });
});

describe('error hygiene', () => {
  it('passes an allow-listed code straight through', async () => {
    const { publicError } = await import('../src/lib/errors');
    assert.equal(publicError(new Error('NOT_FOUND'), 'test'), 'NOT_FOUND');
  });

  it('hides anything else behind a generic code, and reports it', async () => {
    const { publicError } = await import('../src/lib/errors');
    const lines = captureLog(() => {
      const noisy = new Error('Invalid `prisma.user.findUnique()` invocation: postgresql://u:p@h/db');
      assert.equal(publicError(noisy, 'test'), 'UNEXPECTED_ERROR');
    });
    assert.equal(lines.length, 1);
    // The connection string must not survive into the log.
    assert.ok(!lines[0].includes('u:p@h'), lines[0]);
  });
});

const SAFE_CODES = new Set(
  [...fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'errors.ts'), 'utf8').matchAll(/^  '([A-Z_]+)',$/gm)].map(
    (match) => match[1],
  ),
);

describe('error codes the user is meant to see', () => {
  /**
   * The actions layer talks to the browser only through `publicError`, so a code
   * it throws that is not allow-listed reaches the UI as UNEXPECTED_ERROR — and
   * gets reported as a fault. `PACKAGE_EMPTY` did exactly that: the editor
   * checked for it, the user got a generic failure, and every emptied package
   * landed in error monitoring.
   */
  const actionCodes = () => {
    const dir = path.join(process.cwd(), 'src', 'app', 'actions');
    const codes = new Set<string>();
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.ts')) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      for (const match of source.matchAll(/throw new Error\('([A-Z_]+)'\)/g)) codes.add(match[1]);
    }
    return codes;
  };

  it('allow-lists every code the actions layer throws', async () => {
    const { publicError } = await import('../src/lib/errors');
    for (const code of actionCodes()) {
      assert.equal(
        publicError(new Error(code), 'test'),
        code,
        `${code} is thrown by a server action but is not allow-listed, so the user sees UNEXPECTED_ERROR`,
      );
    }
  });

  it('allow-lists every code a component branches on', () => {
    const handled = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.tsx')) {
          const source = fs.readFileSync(full, 'utf8');
          for (const match of source.matchAll(/error === '([A-Z_]+)'/g)) handled.add(match[1]);
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));

    // UNAUTHORIZED and EMAIL_TAKEN come from route handlers, which return their
    // own JSON; the rest must survive publicError.
    assert.ok(handled.size > 0, 'found no error branches at all, so this test proves nothing');
    for (const code of handled) {
      assert.ok(
        SAFE_CODES.has(code),
        `a component branches on "${code}" but it is not an allow-listed code`,
      );
    }
  });
});
