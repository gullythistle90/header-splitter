export type SameSite = 'Strict' | 'Lax' | 'None';

export interface SetCookie {
  name: string;
  value: string;
  expires?: Date;
  maxAge?: number;
  domain?: string;
  path?: string;
  sameSite?: SameSite;
  secure: boolean;
  httpOnly: boolean;
  partitioned: boolean;
  /** Attributes this parser doesn't know, kept verbatim and in order. */
  extensions: string[];
}

/**
 * Parses a single Set-Cookie header value following the RFC 6265 section 5.2
 * algorithm. Returns null when the name-value pair is unusable (no "=" or an
 * empty name), which is what user agents do: they drop the whole cookie.
 *
 * Unlike parseList and parseParameters this never treats a comma as a
 * separator and does not give double quotes any special meaning. Expires
 * contains an unquoted comma, and cookie values are opaque, so a quote in a
 * value does not protect a following semicolon. A parsed Set-Cookie header
 * is always exactly one cookie; callers with several headers must parse each
 * line on its own.
 *
 * Attribute problems are ignored individually (a bad Max-Age or Expires is
 * skipped, the rest still apply), and when an attribute repeats the last one
 * wins, as in the RFC.
 */
export function parseSetCookie(header: string): SetCookie | null {
  const [pair, ...attributes] = header.split(';');

  const eq = pair.indexOf('=');
  if (eq === -1) {
    return null;
  }
  const name = pair.slice(0, eq).trim();
  if (name.length === 0) {
    return null;
  }

  const cookie: SetCookie = {
    name,
    value: pair.slice(eq + 1).trim(),
    secure: false,
    httpOnly: false,
    partitioned: false,
    extensions: [],
  };

  for (const raw of attributes) {
    const attr = raw.trim();
    if (attr.length === 0) {
      continue;
    }

    const attrEq = attr.indexOf('=');
    const key = (attrEq === -1 ? attr : attr.slice(0, attrEq)).trim().toLowerCase();
    const val = attrEq === -1 ? '' : attr.slice(attrEq + 1).trim();

    switch (key) {
      case 'expires': {
        const time = Date.parse(val);
        if (!Number.isNaN(time)) {
          cookie.expires = new Date(time);
        }
        break;
      }
      case 'max-age':
        // Date.parse-style leniency doesn't apply here: the RFC only accepts
        // an optional minus sign followed by digits.
        if (/^-?[0-9]+$/.test(val)) {
          cookie.maxAge = parseInt(val, 10);
        }
        break;
      case 'domain': {
        const domain = val.replace(/^\./, '').toLowerCase();
        if (domain.length > 0) {
          cookie.domain = domain;
        }
        break;
      }
      case 'path':
        if (val.startsWith('/')) {
          cookie.path = val;
        }
        break;
      case 'samesite': {
        const mode = val.toLowerCase();
        if (mode === 'strict') cookie.sameSite = 'Strict';
        else if (mode === 'lax') cookie.sameSite = 'Lax';
        else if (mode === 'none') cookie.sameSite = 'None';
        break;
      }
      case 'secure':
        cookie.secure = true;
        break;
      case 'httponly':
        cookie.httpOnly = true;
        break;
      case 'partitioned':
        cookie.partitioned = true;
        break;
      default:
        cookie.extensions.push(attr);
    }
  }

  return cookie;
}
