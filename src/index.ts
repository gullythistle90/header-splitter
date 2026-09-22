/**
 * Splits a header field value on a separator character, but only where that
 * separator sits outside of a quoted string. Quoted-string escaping
 * (backslash before the next char) is honored so a separator or quote inside
 * an escape sequence never ends the quoted section early.
 */
function splitTopLevel(value: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < value.length; i++) {
    const ch = value[i];

    if (inQuotes) {
      current += ch;
      if (ch === '\\' && i + 1 < value.length) {
        current += value[++i];
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      current += ch;
      continue;
    }

    if (ch === separator) {
      parts.push(current);
      current = '';
      continue;
    }

    current += ch;
  }

  parts.push(current);
  return parts;
}

/**
 * Parses a comma-separated header value (Accept, Cache-Control, Vary, ...)
 * into its list elements. Elements are trimmed, and empty elements produced
 * by stray or trailing commas are dropped, per the HTTP list grammar (RFC
 * 7230 section 7) where "," OWS "," is legal and means nothing.
 *
 * This must not be used on Set-Cookie: a Set-Cookie value can contain an
 * unquoted comma inside its Expires attribute (e.g. "Expires=Wed, 21 Oct
 * 2026 07:28:00 GMT"), and splitting on every comma would cut that date in
 * half. Set-Cookie is defined as a single value per header line, never a
 * comma list, specifically because of this.
 */
export function parseList(value: string): string[] {
  return splitTopLevel(value, ',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function unquote(raw: string): string {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') {
    return raw;
  }

  let out = '';
  for (let i = 1; i < raw.length - 1; i++) {
    if (raw[i] === '\\' && i + 1 < raw.length - 1) {
      out += raw[++i];
      continue;
    }
    out += raw[i];
  }
  return out;
}

function splitFirstEquals(part: string): [string, string | null] {
  let inQuotes = false;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (inQuotes) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === '=') {
      return [part.slice(0, i), part.slice(i + 1)];
    }
  }
  return [part, null];
}

export interface ParsedHeaderValue {
  value: string;
  params: Record<string, string>;
}

/**
 * Parses a semicolon-parameterized header value such as Content-Type or
 * Content-Disposition into its main value plus a map of parameters.
 * Parameter names are case-folded to lowercase (they are case-insensitive
 * per RFC 7231), quoted-string parameter values are unescaped, and a bare
 * parameter with no "=" (allowed by several header grammars) is recorded
 * with an empty string value.
 */
export function parseParameters(value: string): ParsedHeaderValue {
  const parts = splitTopLevel(value, ';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const [head = '', ...rest] = parts;
  const params: Record<string, string> = {};
  const extended: Array<[string, string]> = [];

  for (const part of rest) {
    const [rawKey, rawVal] = splitFirstEquals(part);
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }

    // An RFC 5987 extended parameter ("filename*=UTF-8''%e2%82%ac.txt") is
    // marked by a trailing "*" on the name and needs its own decoding, not
    // the quoted-string unescaping used for ordinary parameter values.
    if (key.length > 1 && key.endsWith('*') && rawVal !== null) {
      extended.push([key.slice(0, -1), rawVal.trim()]);
      continue;
    }

    params[key] = rawVal === null ? '' : unquote(rawVal.trim());
  }

  // Apply extended values last so they win over a plain same-named
  // parameter regardless of which order the two appeared in, matching the
  // RFC 6266 guidance that filename* should be preferred over filename.
  for (const [baseKey, rawVal] of extended) {
    params[baseKey] = decodeExtendedValue(rawVal).value;
  }

  return { value: head, params };
}

export interface ExtendedValue {
  charset: string;
  language: string | null;
  value: string;
}

function percentDecodeToBytes(raw: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '%' && /^[0-9A-Fa-f]{2}$/.test(raw.slice(i + 1, i + 3))) {
      bytes.push(parseInt(raw.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    bytes.push(ch.charCodeAt(0));
  }
  return bytes;
}

/**
 * Decodes the value side of an RFC 5987 extended parameter, e.g. the part
 * after "=" in `filename*=UTF-8''%e2%82%ac%20rates.txt`: charset, an
 * optional language tag, and percent-encoded octets, each separated by a
 * single quote.
 *
 * Only the two charsets the RFC actually registers are decoded: UTF-8 is
 * decoded as UTF-8 bytes, and ISO-8859-1 is decoded byte-for-byte since its
 * first 256 code points line up exactly with Unicode's. Anything else comes
 * back with its percent-encoding untouched, since guessing at an unknown
 * encoding would silently corrupt the value rather than fail loudly.
 */
export function decodeExtendedValue(raw: string): ExtendedValue {
  const firstQuote = raw.indexOf("'");
  const secondQuote = firstQuote === -1 ? -1 : raw.indexOf("'", firstQuote + 1);

  if (firstQuote === -1 || secondQuote === -1) {
    return { charset: '', language: null, value: raw };
  }

  const charset = raw.slice(0, firstQuote);
  const language = raw.slice(firstQuote + 1, secondQuote) || null;
  const encoded = raw.slice(secondQuote + 1);

  switch (charset.toLowerCase()) {
    case 'utf-8':
      return { charset, language, value: new TextDecoder().decode(Uint8Array.from(percentDecodeToBytes(encoded))) };
    case 'iso-8859-1':
      return {
        charset,
        language,
        value: percentDecodeToBytes(encoded)
          .map((byte) => String.fromCharCode(byte))
          .join(''),
      };
    default:
      return { charset, language, value: encoded };
  }
}

const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Checks whether a string is a valid HTTP header field name (RFC 7230 token). */
export function isValidHeaderName(name: string): boolean {
  return TOKEN_PATTERN.test(name);
}

// Headers whose conventional casing isn't just "capitalize after each hyphen".
const IRREGULAR_CASING: Record<string, string> = {
  te: 'TE',
  dnt: 'DNT',
  etag: 'ETag',
  p3p: 'P3P',
  'www-authenticate': 'WWW-Authenticate',
  'x-xss-protection': 'X-XSS-Protection',
  'x-ua-compatible': 'X-UA-Compatible',
  'x-webkit-csp': 'X-WebKit-CSP',
};

/**
 * Returns the conventional display casing for a header name (header names
 * themselves are case-insensitive on the wire, per RFC 7230 section 3.2).
 * Throws if the name isn't a valid token, since there is no sane casing to
 * apply to something that couldn't appear as a header name in the first
 * place.
 */
export function normalizeHeaderName(name: string): string {
  if (!isValidHeaderName(name)) {
    throw new Error(`invalid header name: ${JSON.stringify(name)}`);
  }

  const lower = name.toLowerCase();
  const irregular = IRREGULAR_CASING[lower];
  if (irregular) {
    return irregular;
  }

  return lower
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('-');
}
