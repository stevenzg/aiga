/**
 * Shared origin derivation utility.
 *
 * Derives the origin from a URL string for secure postMessage targeting.
 * Used by StrictSandbox, RemoteSandbox, and RpcChannel.
 */
export function deriveOrigin(url: string): string {
  try {
    return new URL(url, window.location.href).origin;
  } catch {
    throw new Error(`[aiga] Invalid URL: ${url}`);
  }
}
