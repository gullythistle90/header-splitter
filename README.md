# header-splitter

HTTP header values look like simple comma- or semicolon-separated text until
you actually try to parse them. A few real headers break the naive
`value.split(',')` approach:

- `Content-Disposition: attachment; filename="report, final.pdf"` — the
  filename contains a comma, so splitting on every comma cuts the value in
  half.
- `Set-Cookie: session=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT` — the
  Expires date contains an unquoted comma. This is why Set-Cookie is defined
  as one value per header line rather than a comma list, and callers must
  never comma-split it.
- `Content-Type: text/plain; filename="C:\\temp\\a.txt"` — quoted parameter
  values use backslash escaping, so the raw text between the quotes isn't
  the literal value.
- Header names are case-insensitive on the wire (`content-type` ==
  `Content-Type` == `CONTENT-TYPE`), but a few have conventional casing that
  doesn't follow "capitalize after each hyphen" (`ETag`, `DNT`,
  `WWW-Authenticate`).

This library handles the splitting, unescaping, and casing correctly, and
ships a thin CLI on top for poking at header values from a terminal.

## Library usage

```ts
import { parseList, parseParameters, normalizeHeaderName } from 'header-splitter';

parseList('text/html, application/xhtml+xml;q=0.9');
// ['text/html', 'application/xhtml+xml;q=0.9']

parseList('"foo, bar", baz');
// ['"foo, bar"', 'baz']  -- comma inside the quoted string is not a separator

parseParameters('attachment; filename="report, final.pdf"');
// { value: 'attachment', params: { filename: 'report, final.pdf' } }

normalizeHeaderName('etag');
// 'ETag'

normalizeHeaderName('x-request-id');
// 'X-Request-Id'

parseParameters("attachment; filename*=UTF-8''%e2%82%ac%20rates.txt");
// { value: 'attachment', params: { filename: '€ rates.txt' } }
```

`parseParameters` understands RFC 5987 extended parameters (`name*=charset'lang'value`),
such as `Content-Disposition`'s `filename*`. It percent-decodes the value and stores
the result under the parameter name without the trailing `*`, overriding a plain
same-named parameter if both are present — servers send both so that older clients
fall back to the plain ASCII `filename`. Only the two charsets the RFC registers,
UTF-8 and ISO-8859-1, are decoded; anything else is left percent-encoded rather than
guessed at. Use `decodeExtendedValue` directly if you need the charset or language
tag rather than just the decoded value.

### Set-Cookie

`parseSetCookie` parses one Set-Cookie header line using the RFC 6265 rules. It
never splits on commas and treats quotes in the cookie value as literal, so the
`Expires` date survives intact:

```ts
parseSetCookie('session=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Secure; SameSite=Lax');
// { name: 'session', value: 'abc', expires: Date(2026-10-21T07:28:00Z),
//   sameSite: 'Lax', secure: true, httpOnly: false, partitioned: false,
//   extensions: [] }
```

It returns `null` when there is no `name=value` pair. Invalid attribute values
(a non-numeric `Max-Age`, an unparseable `Expires`) are skipped individually.
Unknown attributes are kept in `extensions`. If a response has several
Set-Cookie headers, parse each one separately.

## CLI usage

```
$ node dist/src/cli.js list "text/html, application/xhtml+xml;q=0.9"
["text/html","application/xhtml+xml;q=0.9"]

$ node dist/src/cli.js params "attachment; filename=\"report, final.pdf\""
{"value":"attachment","params":{"filename":"report, final.pdf"}}

$ node dist/src/cli.js name "www-authenticate"
WWW-Authenticate
```

## Building and testing

There are no runtime dependencies. Compile with `tsc` and run the test suite
with Node's built-in test runner:

```
npm run build
npm test
```

The test suite in `tests/headers.test.ts` is table-driven: each test is a
list of `[input, expected]` pairs covering the awkward cases above (quoted
commas, escaped quotes, bare parameter flags, empty list elements, irregular
header casing) rather than one assertion per case written out by hand.

## Known limitations

`parseList` and `parseParameters` cover the common RFC 7230/7231 list and
parameter grammars, but not the newer Structured Field Values syntax (RFC
8941) used by some newer headers. `parseList` and `parseParameters` must not
be used on Set-Cookie, per the comma caveat above; use `parseSetCookie`.
`parseSetCookie` does not apply cookie-domain or public-suffix checks, and
`Expires` is read with `Date.parse` rather than the RFC 6265 date algorithm,
so oddly formatted dates may be accepted or rejected differently than in a
browser.
