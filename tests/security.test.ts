import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inquiryEmail } from '../src/lib/email';
import {
  escapeHtml,
  escapeHtmlMultiline,
  isAllowedUpload,
  isSafeHttpUrl,
} from '../src/lib/security';

describe('email escaping', () => {
  it('neutralises a script tag', () => {
    assert.equal(
      escapeHtml('<script>fetch("//evil")</script>'),
      '&lt;script&gt;fetch(&quot;//evil&quot;)&lt;/script&gt;',
    );
  });

  it('neutralises an attribute break-out', () => {
    assert.equal(escapeHtml('"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('escapes the ampersand first so entities are not double-decoded', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  it('keeps line breaks as <br> while still escaping tags', () => {
    assert.equal(escapeHtmlMultiline('<b>x</b>\ny'), '&lt;b&gt;x&lt;/b&gt;<br>y');
    assert.equal(escapeHtmlMultiline('a\r\nb'), 'a<br>b');
  });
});

describe('href scheme validation', () => {
  // z.string().url() accepts all of these, which is why the check exists.
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    '  javascript:alert(1)  ',
    'data:text/html;base64,PHN2Zy8+',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'not a url',
    '',
  ]) {
    it(`rejects ${JSON.stringify(url)}`, () => assert.equal(isSafeHttpUrl(url), false));
  }

  for (const url of ['https://vimeo.com/123', 'http://example.com', 'https://www.imdb.com/name/nm1']) {
    it(`allows ${url}`, () => assert.equal(isSafeHttpUrl(url), true));
  }
});

describe('upload gate', () => {
  const cases: Array<[Parameters<typeof isAllowedUpload>[0], string, string, boolean]> = [
    // Blobs are served from a public origin and opened directly by browsers.
    ['image', 'x.svg', 'image/svg+xml', false],
    ['image', 'x.html', 'text/html', false],
    ['image', 'payload.php.png', 'text/html', false],
    ['image', 'photo.PNG', 'image/png', true],
    ['image', 'photo.jpeg', 'image/jpeg', true],
    ['script', 'evil.html', 'text/html', false],
    ['script', 'notes.exe', 'application/octet-stream', false],
    ['script', 'script.fountain', 'application/octet-stream', true],
    ['script', 'draft.pdf', 'application/pdf', true],
    ['script', 'draft.fdx', '', true],
  ];

  for (const [kind, name, type, expected] of cases) {
    it(`${kind}: ${name} (${type || 'no type'}) -> ${expected ? 'allowed' : 'blocked'}`, () => {
      assert.equal(isAllowedUpload(kind, name, type), expected);
    });
  }
});

describe('outbound email', () => {
  it('escapes user-supplied fields so mail HTML cannot be injected', () => {
    const html = inquiryEmail({
      recipientName: 'Najd',
      producerName: '<a href="https://evil.example">Approve now</a>',
      subject: '"><img src=x onerror=alert(1)>',
      message: 'hi',
      contactEmail: 'a@b.test',
    });
    assert.ok(!html.includes('<a href="https://evil.example"'), 'an injected anchor survived');
    assert.ok(!html.includes('<img'), 'an injected image tag survived');
    assert.match(html, /&lt;a href=&quot;https:\/\/evil\.example&quot;&gt;/);
  });

  it('builds no mail HTML outside the email module', () => {
    // Every template lives in one place, where escaping is the default.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && full !== path.join(process.cwd(), 'src', 'lib', 'email.ts')) {
          const source = fs.readFileSync(full, 'utf8');
          // A template literal assigned to `html:` is mail markup built by hand.
          if (/html:\s*`/.test(source)) offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));
    assert.deepEqual(offenders, [], `mail HTML built outside src/lib/email.ts: ${offenders.join(', ')}`);
  });
});
