/**
 * Utility helpers ported from
 * `com.xiaomi.infra.galaxy.fds.auth.signature.Utils` and the URL-encoding
 * helper from `Signer.urlEncode`.
 */

/** The components of a URI needed for signing. */
export interface UriParts {
  scheme: string;
  host: string;
  /** Port, or `-1` when not present (matching `java.net.URI.getPort()`). */
  port: number;
  /** Decoded path component, as `java.net.URI.getPath()` returns it. */
  path: string;
  /**
   * Decoded query string without the leading `?` (as
   * `java.net.URI.getQuery()` returns it), or `undefined` when absent.
   */
  query?: string;
}

// scheme://authority path ?query #fragment, kept verbatim (no normalization).
const RAW_URI = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/;

/**
 * Parses a URI string into the components used while signing.
 *
 * Mirrors `java.net.URI`: the path and query are taken verbatim from the
 * input (WHATWG `URL` would resolve `..` segments and re-encode characters)
 * and then percent-decoded as UTF-8, with invalid sequences replaced by
 * U+FFFD.
 */
export function parseUri(uri: string): UriParts {
  const url = new URL(uri);
  const raw = RAW_URI.exec(uri);
  if (raw === null) {
    throw new TypeError(`Invalid URL: ${uri}`);
  }
  return {
    scheme: url.protocol.replace(/:$/, ''),
    host: url.hostname,
    port: url.port === '' ? -1 : Number(url.port),
    path: percentDecode(raw[3]),
    query: raw[4] === undefined ? undefined : percentDecode(raw[4]),
  };
}

const utf8Decoder = new TextDecoder('utf-8');
const utf8Encoder = new TextEncoder();

/**
 * Decodes `%XX` sequences as UTF-8 the way `java.net.URI` does. Unlike
 * `decodeURIComponent` it never throws, and `+` is left untouched.
 */
export function percentDecode(s: string): string {
  if (!s.includes('%')) {
    return s;
  }
  const bytes: number[] = [];
  for (let i = 0; i < s.length;) {
    if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.substring(i + 1, i + 3))) {
      bytes.push(Number.parseInt(s.substring(i + 1, i + 3), 16));
      i += 3;
    } else {
      const cp = s.codePointAt(i)!;
      const ch = String.fromCodePoint(cp);
      bytes.push(...utf8Encoder.encode(ch));
      i += ch.length;
    }
  }
  return utf8Decoder.decode(new Uint8Array(bytes));
}

/**
 * Parses a query string into an ordered list of key/value pairs.
 *
 * Faithfully reproduces `Utils.parseUriParameters`: the string is split on
 * `&`, and for each token the value is everything after the first `=`
 * (so `=` characters inside the value are preserved). A token without `=`
 * yields an empty value.
 */
export function parseUriParameters(query?: string): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  if (query === undefined || query.length === 0) {
    return params;
  }
  for (const param of query.split('&')) {
    const eq = param.indexOf('=');
    if (eq >= 0) {
      params.push([param.substring(0, eq), param.substring(eq + 1)]);
    } else {
      params.push([param, '']);
    }
  }
  return params;
}

const URL_ENCODE_SAFE = /[A-Za-z0-9.\-*_]/;

/**
 * Encodes a value the way `Signer.urlEncode` does: `java.net.URLEncoder`
 * (UTF-8) followed by replacing `+`→`%20`, `*`→`%2A`, `~`→`%7E`, `/`→`%2F`.
 */
export function urlEncode(value?: string): string {
  if (value === undefined) {
    return '';
  }

  // Replicate java.net.URLEncoder.encode(value, "utf-8").
  let encoded = '';
  const bytes = Buffer.from(value, 'utf-8');
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (URL_ENCODE_SAFE.test(ch)) {
      encoded += ch;
    } else if (ch === ' ') {
      encoded += '+';
    } else {
      encoded += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }

  return encoded
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/~/g, '%7E')
    .replace(/\//g, '%2F');
}

// Characters legal in a URI path component per java.net.URI (RFC 2396):
// unreserved (alphanum + mark) plus the path-specific punctuation. Anything
// else is UTF-8 percent-encoded by the URI multi-argument constructor.
const URI_PATH_LEGAL = /[A-Za-z0-9\-_.!~*'():@&=+$,;/]/;

/**
 * Percent-encodes a path the way `java.net.URI`'s multi-argument constructor
 * does: e.g. a space becomes `%20` while `+` is left intact. This affects only
 * how the path is rendered in a URI string; signing uses the decoded path.
 */
export function encodeUriPath(path: string): string {
  let result = '';
  const bytes = Buffer.from(path, 'utf-8');
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (byte < 0x80 && URI_PATH_LEGAL.test(ch)) {
      result += ch;
    } else {
      result += '%' + byte.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return result;
}
