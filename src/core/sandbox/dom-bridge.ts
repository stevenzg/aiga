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

/**
 * Generate the bridge script source for injection.
 * The parentOrigin parameter restricts postMessage to the host origin only.
 */
export function getBridgeScript(parentOrigin?: string): string {
  const origin = parentOrigin && parentOrigin !== '*'
    ? JSON.stringify(parentOrigin)
    : 'window.location.origin';

  return `
(function() {
  if (window.__aigaBridge) return;
  window.__aigaBridge = true;

  var targetOrigin = ${origin};

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
      }, targetOrigin);
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
      }, targetOrigin);
    }
    return origInsert(node, ref);
  };

  // Report document height changes for auto-resize.
  var ro = new ResizeObserver(function() {
    window.parent.postMessage({
      __aiga_resize: true,
      height: document.documentElement.scrollHeight
    }, targetOrigin);
  });
  ro.observe(document.documentElement);
})();
`;
}

/**
 * Set up the DOM bridge for a same-origin iframe.
 * Injects the bridge script and listens for overlay events.
 *
 * @param iframe - The iframe element to bridge.
 * @param overlayLayer - The overlay layer for teleporting overlay elements.
 * @param parentOrigin - The host origin for secure postMessage targeting.
 */
export function setupDomBridge(
  iframe: HTMLIFrameElement,
  overlayLayer: OverlayLayer | null,
  parentOrigin?: string,
): () => void {
  const messageHandler = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (!e.data?.__aiga_dom_bridge) return;

    if (e.data.action === 'overlay-detected' && overlayLayer) {
      console.debug('[aiga] Overlay detected in iframe:', e.data.id);
      overlayLayer.addOverlayFromHtml(e.data.html, e.data.id);
    }
  };

  window.addEventListener('message', messageHandler);

  const bridgeScript = getBridgeScript(parentOrigin);

  // Inject bridge script into same-origin iframes.
  const injectBridge = () => {
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        const script = doc.createElement('script');
        script.textContent = bridgeScript;
        doc.head.appendChild(script);
      }
    } catch {
      // Cross-origin: cannot inject script directly.
    }
  };

  iframe.addEventListener('load', injectBridge);

  return () => {
    window.removeEventListener('message', messageHandler);
    iframe.removeEventListener('load', injectBridge);
  };
}
