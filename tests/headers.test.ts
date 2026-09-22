import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseList,
  parseParameters,
  normalizeHeaderName,
  isValidHeaderName,
  decodeExtendedValue,
} from '../src/index';

test('parseList handles the awkward comma cases', () => {
  const cases: Array<[string, string[]]> = [
    ['text/html, application/xhtml+xml;q=0.9', ['text/html', 'application/xhtml+xml;q=0.9']],
    ['"foo, bar", baz', ['"foo, bar"', 'baz']],
    ['"a \\"quoted\\" b", c', ['"a \\"quoted\\" b"', 'c']],
    ['a, , b', ['a', 'b']],
    ['a, b,', ['a', 'b']],
    ['   ', []],
    ['', []],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(parseList(input), expected, `parseList(${JSON.stringify(input)})`);
  }
});

test('parseParameters handles quoting, escaping, and bare flags', () => {
  const cases: Array<[string, ReturnType<typeof parseParameters>]> = [
    ['text/html; charset=utf-8', { value: 'text/html', params: { charset: 'utf-8' } }],
    ['text/html ; charset = utf-8', { value: 'text/html', params: { charset: 'utf-8' } }],
    ['text/html; Charset=UTF-8', { value: 'text/html', params: { charset: 'UTF-8' } }],
    ['attachment; filename="a, b.txt"', { value: 'attachment', params: { filename: 'a, b.txt' } }],
    [
      'text/plain; filename="C:\\\\temp\\\\a.txt"',
      { value: 'text/plain', params: { filename: 'C:\\temp\\a.txt' } },
    ],
    ['multipart/mixed; boundary', { value: 'multipart/mixed', params: { boundary: '' } }],
    ['text/html;;charset=utf-8', { value: 'text/html', params: { charset: 'utf-8' } }],
    ['', { value: '', params: {} }],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(parseParameters(input), expected, `parseParameters(${JSON.stringify(input)})`);
  }
});

test('parseParameters decodes RFC 5987 extended parameters', () => {
  const cases: Array<[string, ReturnType<typeof parseParameters>]> = [
    [
      "attachment; filename*=UTF-8''%e2%82%ac%20rates.txt",
      { value: 'attachment', params: { filename: '€ rates.txt' } },
    ],
    [
      // Extended form must win over the plain fallback, regardless of order.
      "attachment; filename=\"EURO rates.txt\"; filename*=UTF-8''%e2%82%ac%20rates.txt",
      { value: 'attachment', params: { filename: '€ rates.txt' } },
    ],
    [
      "attachment; filename*=UTF-8''%e2%82%ac%20rates.txt; filename=\"EURO rates.txt\"",
      { value: 'attachment', params: { filename: '€ rates.txt' } },
    ],
    [
      "attachment; filename*=ISO-8859-1''%A3%20rates.pdf",
      { value: 'attachment', params: { filename: '£ rates.pdf' } },
    ],
    [
      "attachment; filename*=UTF-8'en'plain.txt",
      { value: 'attachment', params: { filename: 'plain.txt' } },
    ],
  ];

  for (const [input, expected] of cases) {
    assert.deepEqual(parseParameters(input), expected, `parseParameters(${JSON.stringify(input)})`);
  }
});

test('decodeExtendedValue reports charset, language, and value separately', () => {
  assert.deepEqual(decodeExtendedValue("UTF-8'en'plain.txt"), {
    charset: 'UTF-8',
    language: 'en',
    value: 'plain.txt',
  });

  assert.deepEqual(decodeExtendedValue("UTF-8''%e2%82%ac"), {
    charset: 'UTF-8',
    language: null,
    value: '€',
  });

  // Unknown charsets are left percent-encoded rather than guessed at.
  assert.deepEqual(decodeExtendedValue("Shift_JIS''%82%a0"), {
    charset: 'Shift_JIS',
    language: null,
    value: '%82%a0',
  });

  // No charset delimiter at all: hand back the raw text unchanged.
  assert.deepEqual(decodeExtendedValue('plain.txt'), {
    charset: '',
    language: null,
    value: 'plain.txt',
  });
});

test('normalizeHeaderName canonicalizes known irregular headers', () => {
  const cases: Array<[string, string]> = [
    ['content-type', 'Content-Type'],
    ['CONTENT-TYPE', 'Content-Type'],
    ['etag', 'ETag'],
    ['ETAG', 'ETag'],
    ['dnt', 'DNT'],
    ['x-custom-header', 'X-Custom-Header'],
    ['www-authenticate', 'WWW-Authenticate'],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeHeaderName(input), expected, `normalizeHeaderName(${JSON.stringify(input)})`);
  }
});

test('isValidHeaderName rejects malformed field names', () => {
  const cases: Array<[string, boolean]> = [
    ['Content-Type', true],
    ['X-Custom-123', true],
    ['Content Type', false],
    ['Content:Type', false],
    ['', false],
    ['a/b', false],
  ];

  for (const [input, expected] of cases) {
    assert.equal(isValidHeaderName(input), expected, `isValidHeaderName(${JSON.stringify(input)})`);
  }
});

test('normalizeHeaderName throws on invalid names instead of guessing', () => {
  assert.throws(() => normalizeHeaderName('Content Type'));
});
