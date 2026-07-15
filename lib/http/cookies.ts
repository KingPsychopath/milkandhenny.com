export interface CookieOptions {
  httpOnly?: boolean;
  maxAge?: number;
  path?: string;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
}

export function getCookie(request: Request, name: string): string {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return "";

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return "";
}

export function setCookie(
  response: Response,
  name: string,
  value: string,
  options: CookieOptions = {},
): void {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.httpOnly) segments.push("HttpOnly");
  if (options.secure) segments.push("Secure");
  if (options.sameSite) {
    const sameSite = options.sameSite[0].toUpperCase() + options.sameSite.slice(1);
    segments.push(`SameSite=${sameSite}`);
  }
  response.headers.append("Set-Cookie", segments.join("; "));
}
