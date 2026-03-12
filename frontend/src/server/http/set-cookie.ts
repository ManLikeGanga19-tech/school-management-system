type CookieCapableHeaders = Headers & {
  getSetCookie?: () => string[];
};

function splitCombinedSetCookieHeader(value: string): string[] {
  const out: string[] = [];
  let token = "";
  let inExpires = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const ahead = value.slice(index).toLowerCase();

    if (!inExpires && ahead.startsWith("expires=")) {
      inExpires = true;
    }

    if (char === "," && !inExpires) {
      if (token.trim()) out.push(token.trim());
      token = "";
      continue;
    }

    if (inExpires && char === ";") {
      inExpires = false;
    }

    token += char;
  }

  if (token.trim()) out.push(token.trim());
  return out;
}

export function getSetCookieHeaders(headers: Headers): string[] {
  const cookieHeaders = (headers as CookieCapableHeaders).getSetCookie?.();
  if (Array.isArray(cookieHeaders) && cookieHeaders.length > 0) {
    return cookieHeaders.filter((value) => value && value.trim());
  }

  const raw = headers.get("set-cookie");
  if (!raw) return [];
  return splitCombinedSetCookieHeader(raw);
}

export function extractCookieValue(headers: Headers, cookieName: string): string | null {
  const prefix = `${cookieName}=`;
  for (const row of getSetCookieHeaders(headers)) {
    const segment = row.split(";")[0]?.trim() || "";
    if (!segment.startsWith(prefix)) continue;
    return segment.slice(prefix.length) || null;
  }
  return null;
}
