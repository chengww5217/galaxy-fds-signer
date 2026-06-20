import { createHash } from 'node:crypto';

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
  /** Decoded path component, always starting with `/`. */
  path: string;
  /** Raw query string without the leading `?`, or `null` when absent. */
  query: string | null;
}

/**
 * Parses a URI string into the components used while signing.
 *
 * Mirrors how the Java SDK reads `java.net.URI`: `getPath()` returns the
 * decoded path and `getQuery()` the (decoded) query string.
 */
export function parseUri(uri: string): UriParts {
  const url = new URL(uri);
  return {
    scheme: url.protocol.replace(/:$/, ''),
    host: url.hostname,
    port: url.port === '' ? -1 : Number(url.port),
    path: decodeURIComponent(url.pathname),
    query: url.search === '' ? null : url.search.slice(1),
  };
}

/**
 * Parses a query string into an ordered list of key/value pairs.
 *
 * Faithfully reproduces `Utils.parseUriParameters`: the string is split on
 * `&`, and for each token the value is everything after the first `=`
 * (so `=` characters inside the value are preserved). A token without `=`
 * yields an empty value.
 */
export function parseUriParameters(query: string | null): Array<[string, string]> {
  const params: Array<[string, string]> = [];
  if (query == null || query.length === 0) {
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

/**
 * Formats a date as an RFC 822 GMT string, e.g. `Sun, 06 Nov 1994 08:49:37 GMT`.
 *
 * `Date.prototype.toUTCString()` produces exactly the format used by the Java
 * SDK's `SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss z", Locale.US)` with a GMT
 * time zone.
 */
export function getGMTDatetime(date: Date): string {
  return date.toUTCString();
}

const URL_ENCODE_SAFE = /[A-Za-z0-9.\-*_]/;

/**
 * Encodes a value the way `Signer.urlEncode` does: `java.net.URLEncoder`
 * (UTF-8) followed by replacing `+`→`%20`, `*`→`%2A`, `~`→`%7E`, `/`→`%2F`.
 */
export function urlEncode(value: string | null | undefined): string {
  if (value == null) {
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

/**
 * Computes the MD5 of a UTF-8 string and returns it as a hex string.
 *
 * Reproduces `Utils.calcMD5`, which uses `new BigInteger(1, md5Bytes).toString(16)`
 * and therefore drops leading zero nibbles from the hex output.
 */
export function calcMD5(s: string): string {
  const digestHex = createHash('md5').update(s, 'utf-8').digest('hex');
  const trimmed = digestHex.replace(/^0+/, '');
  return trimmed.length === 0 ? '0' : trimmed;
}
