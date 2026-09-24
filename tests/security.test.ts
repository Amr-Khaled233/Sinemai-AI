import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
