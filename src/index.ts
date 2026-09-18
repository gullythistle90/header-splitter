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

  for (const part of rest) {
    const [rawKey, rawVal] = splitFirstEquals(part);
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    params[key] = rawVal === null ? '' : unquote(rawVal.trim());
  }

  return { value: head, params };
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
