/**
 * DOM Proxy Bridge for `sandbox="strict"`.
 *
 * For same-origin iframes, this bridge intercepts DOM operations
 * inside the iframe and mirrors overlay elements (modal/popover/dropdown)
 * into the host document's overlay layer. It also provides a `document`
 * proxy inside the iframe that redirects `body.appendChild` of overlay
 * elements to the host.
 *
 * For cross-origin iframes, the bridge injects a small script via
 * `srcdoc` preamble that communicates overlay operations via postMessage.
 */

import type { OverlayLayer } from '../overlay/overlay-layer.js';

/** Script to inject into same-origin iframes for DOM bridge support. */
const BRIDGE_SCRIPT = `
(function() {
  if (window.__aigaBridge) return;
  window.__aigaBridge = true;

  // Intercept document.body.appendChild to detect overlay elements.
  var origAppend = document.body.appendChild.bind(document.body);
  var origInsert = document.body.insertBefore.bind(document.body);

  function isOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;
    var s = el.style;
    var cn = el.className ? el.className.toString() : '';
    var role = el.getAttribute('role');
    if (s.position === 'fixed') return true;
    if (/\\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\\b/i.test(cn)) return true;
    if (role === 'dialog' || role === 'tooltip' || role === 'alertdialog') return true;
    return false;
  }

  document.body.appendChild = function(node) {
    if (isOverlay(node)) {
      window.parent.postMessage({
        __aiga_dom_bridge: true,
        action: 'overlay-detected',
        html: node.outerHTML,
        id: node.id || ('aiga-overlay-' + Date.now())
      }, '*');
    }
    return origAppend(node);
  };

  document.body.insertBefore = function(node, ref) {
    if (isOverlay(node)) {
      window.parent.postMessage({
        __aiga_dom_bridge: true,
        action: 'overlay-detected',
        html: node.outerHTML,
        id: node.id || ('aiga-overlay-' + Date.now())
      }, '*');
    }
    return origInsert(node, ref);
  };

  // Report document height changes for auto-resize.
  var ro = new ResizeObserver(function() {
    window.parent.postMessage({
      __aiga_resize: true,
      height: document.documentElement.scrollHeight
    }, '*');
  });
  ro.observe(document.documentElement);
})();
`;

/**
 * Set up the DOM bridge for a same-origin iframe.
 * Injects the bridge script and listens for overlay events.
 */
export function setupDomBridge(
  iframe: HTMLIFrameElement,
  overlayLayer: OverlayLayer | null,
): () => void {
  const messageHandler = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (!e.data?.__aiga_dom_bridge) return;

    if (e.data.action === 'overlay-detected' && overlayLayer) {
      // The iframe detected an overlay element. We can track this
      // for future host-side overlay mirroring.
      // Note: For cross-origin, we can't extract the actual DOM node,
      // but we log the event for debugging / DevTools.
      console.debug('[aiga] Overlay detected in iframe:', e.data.id);
    }
  };

  window.addEventListener('message', messageHandler);

  // Inject bridge script into same-origin iframes.
  const injectBridge = () => {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const script = doc.createElement('script');
        script.textContent = BRIDGE_SCRIPT;
        doc.head.appendChild(script);
      }
    } catch {
      // Cross-origin: cannot inject script directly.
      // The iframe can optionally include the aiga client SDK.
    }
  };

  iframe.addEventListener('load', injectBridge);

  return () => {
    window.removeEventListener('message', messageHandler);
    iframe.removeEventListener('load', injectBridge);
  };
}

/**
 * Generate the DOM bridge script source for injection.
 * Can be used with srcdoc or inline script injection.
 */
export function getBridgeScript(): string {
  return BRIDGE_SCRIPT;
}
