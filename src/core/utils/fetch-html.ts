/**
 * Shared HTML fetching utility for sandbox adapters.
 *
 * Fetches remote HTML content with CORS error detection that
 * does not rely on browser-specific error message strings.
 */

export async function fetchAppHtml(src: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(src, { mode: 'cors' });
  } catch {
    // Network-level failure (CORS block, DNS failure, offline, etc.)
    // Rather than matching error message strings (browser-dependent),
    // any fetch TypeError in cors mode is treated as a CORS / network error.
    throw new Error(
      `[aiga] Network error loading "${src}". ` +
      `If cross-origin, ensure the server sends Access-Control-Allow-Origin headers.`,
    );
  }
  if (!res.ok) {
    throw new Error(`[aiga] Failed to fetch ${src}: HTTP ${res.status}`);
  }
  return res.text();
}
