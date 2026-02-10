/**
 * Lightweight Window Proxy for `sandbox="light"`.
 *
 * Creates a Proxy wrapper around `window` that:
 * - Traps property writes to a local scope (prevents globals leakage)
 * - Allows reads to fall through to the real `window` (e.g., DOM APIs)
 * - Intercepts `document.body.appendChild` for overlay detection
 * - Provides a scoped `eval` and `Function` context
 *
 * This is NOT full iframe-level isolation — it prevents accidental
 * leakage, not malicious attacks. For untrusted code, use `strict`.
 */

export interface ProxyWindowOptions {
  /** The Shadow DOM root to use as the document proxy target. */
  shadowRoot: ShadowRoot;
  /** Callback when an overlay element is detected. */
  onOverlayDetected?: (el: HTMLElement) => void;
}

interface ScopedContext {
  proxy: WindowProxy;
  localScope: Record<string, unknown>;
  revoke: () => void;
}

/**
 * Create a scoped window proxy for lightweight JS isolation.
 * Property writes go to a local scope map; reads fall through to `window`.
 */
export function createScopedProxy(options: ProxyWindowOptions): ScopedContext {
  const { shadowRoot } = options;
  const localScope: Record<string, unknown> = Object.create(null);

  // Track what properties have been locally shadowed.
  const localKeys = new Set<string>();

  // Frozen set of properties that should never be proxied.
  const passthrough = new Set([
    'window', 'self', 'globalThis',
    'addEventListener', 'removeEventListener', 'dispatchEvent',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
    'Promise', 'Symbol', 'Proxy', 'Reflect',
    'Map', 'Set', 'WeakMap', 'WeakSet',
    'Array', 'Object', 'String', 'Number', 'Boolean',
    'JSON', 'Math', 'Date', 'RegExp', 'Error',
    'console', 'performance', 'navigator', 'location', 'history',
    'crypto', 'URL', 'URLSearchParams',
    'CustomEvent', 'Event', 'MutationObserver', 'ResizeObserver',
    'IntersectionObserver',
    'HTMLElement', 'Element', 'Node', 'Document',
    'undefined', 'NaN', 'Infinity',
  ]);

  // Create a cached document proxy (stable identity).
  const documentProxy = createDocumentProxy(shadowRoot, options.onOverlayDetected);

  const { proxy, revoke } = Proxy.revocable(window, {
    get(target, prop, receiver) {
      const key = String(prop);

      // Return our scoped `document` proxy.
      if (key === 'document') return documentProxy;

      // Return self-reference for window/self/globalThis.
      if (key === 'window' || key === 'self' || key === 'globalThis') {
        return proxy;
      }

      // Check local scope first (locally-written properties).
      if (localKeys.has(key)) {
        return localScope[key];
      }

      // Fall through to the real window for everything else.
      const value = Reflect.get(target, prop, receiver);

      // Bind functions to the real window to avoid illegal invocation.
      if (typeof value === 'function' && passthrough.has(key)) {
        return value.bind(target);
      }

      return value;
    },

    set(_target, prop, value) {
      const key = String(prop);

      // Intercept writes: store in local scope instead of real window.
      localScope[key] = value;
      localKeys.add(key);
      return true;
    },

    has(target, prop) {
      const key = String(prop);
      return localKeys.has(key) || Reflect.has(target, prop);
    },

    deleteProperty(_target, prop) {
      const key = String(prop);
      if (localKeys.has(key)) {
        delete localScope[key];
        localKeys.delete(key);
        return true;
      }
      // Return true for non-local properties per the spec.
      // Returning false in strict mode would throw a TypeError.
      return true;
    },
  });

  return { proxy, localScope, revoke };
}

/**
 * Create a proxy for `document` that redirects DOM operations
 * to the Shadow DOM root instead of the real document.body.
 */
function createDocumentProxy(
  shadowRoot: ShadowRoot,
  onOverlayDetected?: (el: HTMLElement) => void,
): Document {
  // Get the first child container inside Shadow DOM.
  const getContainer = (): HTMLElement =>
    (shadowRoot.querySelector('[data-aiga-content]') as HTMLElement) ??
    (shadowRoot.firstElementChild as HTMLElement) ??
    shadowRoot.host as HTMLElement;

  // Cache the body proxy for stable identity (prevents === failures).
  let cachedBodyProxy: HTMLElement | null = null;
  let cachedContainer: HTMLElement | null = null;

  const getBodyProxy = (): HTMLElement => {
    const container = getContainer();
    // Only recreate if the underlying container changed.
    if (container !== cachedContainer) {
      cachedContainer = container;
      cachedBodyProxy = createBodyProxy(container, onOverlayDetected);
    }
    return cachedBodyProxy!;
  };

  return new Proxy(document, {
    get(target, prop, receiver) {
      const key = String(prop);

      // Redirect body access to our Shadow DOM container (cached proxy).
      if (key === 'body') {
        return getBodyProxy();
      }

      // Redirect querySelector / querySelectorAll to Shadow DOM scope.
      if (key === 'querySelector') {
        return (selector: string) => shadowRoot.querySelector(selector);
      }
      if (key === 'querySelectorAll') {
        return (selector: string) => shadowRoot.querySelectorAll(selector);
      }
      if (key === 'getElementById') {
        return (id: string) => shadowRoot.getElementById(id);
      }

      // createElement, createTextNode, etc. — use real document.
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/**
 * Proxy for `document.body` that intercepts `appendChild` / `insertBefore`
 * to detect overlay elements (modals, popover, etc.).
 */
function createBodyProxy(
  container: HTMLElement,
  onOverlayDetected?: (el: HTMLElement) => void,
): HTMLElement {
  return new Proxy(container, {
    get(target, prop, receiver) {
      const key = String(prop);

      if (key === 'appendChild') {
        return (node: Node) => {
          if (node instanceof HTMLElement && isLikelyOverlay(node)) {
            onOverlayDetected?.(node);
          }
          return target.appendChild(node);
        };
      }

      if (key === 'insertBefore') {
        return (node: Node, ref: Node | null) => {
          if (node instanceof HTMLElement && isLikelyOverlay(node)) {
            onOverlayDetected?.(node);
          }
          return target.insertBefore(node, ref);
        };
      }

      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

/** Quick heuristic to detect overlay-like elements. */
function isLikelyOverlay(el: HTMLElement): boolean {
  const style = el.style;
  const className = el.className?.toString?.() ?? '';
  const role = el.getAttribute('role');

  if (style.position === 'fixed' || style.position === 'absolute') return true;
  if (/\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\b/i.test(className)) return true;
  if (role === 'dialog' || role === 'tooltip' || role === 'alertdialog') return true;

  return false;
}
