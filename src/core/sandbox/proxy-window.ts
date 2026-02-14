/**
 * Lightweight Window Proxy for `sandbox="light"`.
 *
 * Creates a Proxy wrapper around `window` that:
 * - Traps property writes to a local scope (prevents globals leakage)
 * - Allows reads to fall through to the real `window` (e.g., DOM APIs)
 * - Intercepts `document.body.appendChild` for overlay detection
 * - Tracks setTimeout/setInterval for cleanup on revoke (JS-10)
 * - Intercepts `document.title` writes (DOM-03)
 * - Provides a scoped `eval` and `Function` context
 *
 * This is NOT full iframe-level isolation — it prevents accidental
 * leakage, not malicious attacks. For untrusted code, use `strict`.
 */

import { createTimerTracker } from './timer-tracker.js';
import { isOverlayElement } from '../utils/overlay-heuristic.js';

export interface ProxyWindowOptions {
  /** The Shadow DOM root to use as the document proxy target. */
  shadowRoot: ShadowRoot;
  /** Callback when an overlay element is detected. */
  onOverlayDetected?: (el: HTMLElement) => void;
}

interface ScopedContext {
  proxy: WindowProxy;
  localScope: Record<string, unknown>;
  /** Revoke the proxy and clear all tracked timers. */
  revoke: () => void;
}

// Frozen set of properties that should never be proxied.
const PASSTHROUGH_PROPS = new Set([
  'window', 'self', 'globalThis',
  'addEventListener', 'removeEventListener', 'dispatchEvent',
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

/**
 * Create a scoped window proxy for lightweight JS isolation.
 * Property writes go to a local scope map; reads fall through to `window`.
 */
export function createScopedProxy(options: ProxyWindowOptions): ScopedContext {
  const { shadowRoot } = options;
  const localScope: Record<string, unknown> = Object.create(null);
  const localKeys = new Set<string>();

  const timers = createTimerTracker();
  const documentProxy = createDocumentProxy(shadowRoot, options.onOverlayDetected);

  const { proxy, revoke: revokeProxy } = Proxy.revocable(window, {
    get(target, prop, receiver) {
      const key = String(prop);

      // Return our scoped `document` proxy.
      if (key === 'document') return documentProxy;

      // Return self-reference for window/self/globalThis.
      if (key === 'window' || key === 'self' || key === 'globalThis') {
        return proxy;
      }

      // Timer wrappers with tracking (JS-10).
      if (key === 'setTimeout') return timers.setTimeout;
      if (key === 'clearTimeout') return timers.clearTimeout;
      if (key === 'setInterval') return timers.setInterval;
      if (key === 'clearInterval') return timers.clearInterval;
      if (key === 'requestAnimationFrame') return timers.requestAnimationFrame;
      if (key === 'cancelAnimationFrame') return timers.cancelAnimationFrame;

      // Check local scope first (locally-written properties).
      if (localKeys.has(key)) {
        return localScope[key];
      }

      // Fall through to the real window for everything else.
      const value = Reflect.get(target, prop, receiver);

      // Bind functions to the real window to avoid illegal invocation.
      if (typeof value === 'function' && PASSTHROUGH_PROPS.has(key)) {
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

  const revoke = () => {
    timers.clearAll();
    revokeProxy();
  };

  return { proxy, localScope, revoke };
}

/**
 * Create a proxy for `document` that redirects DOM operations
 * to the Shadow DOM root instead of the real document.body.
 * Also intercepts `title` writes to prevent leaking to host (DOM-03).
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

  // Scoped title: sub-app title writes don't leak to host document (DOM-03).
  let scopedTitle = document.title;

  // Scoped cookie storage (SEC-02): sub-app cookies isolated from host.
  let scopedCookies = '';

  return new Proxy(document, {
    get(target, prop, receiver) {
      const key = String(prop);

      // Redirect body access to our Shadow DOM container (cached proxy).
      if (key === 'body') return getBodyProxy();

      // Intercept title reads to return scoped value (DOM-03).
      if (key === 'title') return scopedTitle;

      // Intercept cookie reads to return scoped value (SEC-02).
      if (key === 'cookie') return scopedCookies;

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

    set(_target, prop, value) {
      const key = String(prop);

      // Intercept title writes to scoped storage (DOM-03).
      if (key === 'title') {
        scopedTitle = String(value);
        return true;
      }

      // Intercept cookie writes to scoped storage (SEC-02).
      if (key === 'cookie') {
        const cookieStr = String(value);
        const eqIdx = cookieStr.indexOf('=');
        if (eqIdx > 0) {
          const name = cookieStr.substring(0, eqIdx).trim();
          const existing = scopedCookies.split('; ').filter(
            (c) => !c.startsWith(name + '='),
          );
          existing.push(cookieStr.split(';')[0]); // Only store name=value part
          scopedCookies = existing.filter(Boolean).join('; ');
        }
        return true;
      }

      // Allow other writes through.
      return Reflect.set(document, prop, value);
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
          if (node instanceof HTMLElement && isOverlayElement(node, false)) {
            onOverlayDetected?.(node);
          }
          return target.appendChild(node);
        };
      }

      if (key === 'insertBefore') {
        return (node: Node, ref: Node | null) => {
          if (node instanceof HTMLElement && isOverlayElement(node, false)) {
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

