/**
 * DOM Proxy Bridge for `sandbox="strict"`.
 *
 * Uses iframe promotion for overlays: when a modal/dialog is detected
 * inside the iframe, the iframe is promoted to full-viewport mode so
 * the overlay renders correctly with full interactivity (OV-01~07).
 *
 * Also provides security overrides:
 * - window.top/parent are overridden to prevent iframe escape (SEC-01/02)
 * - localStorage/sessionStorage are namespaced per app (JS-06)
 * - CSS variables are received from the host via postMessage (CSS-03)
 * - Document height changes are reported for auto-resize
 */

/**
 * Generate a namespaced storage proxy script block.
 * Reused for both localStorage and sessionStorage (JS-06).
 */
function storageProxySnippet(storageName: string): string {
  return `
  try {
    var _real = window.${storageName};
    var proxy = {
      getItem: function(key) { return _real.getItem(storagePrefix + key); },
      setItem: function(key, value) { _real.setItem(storagePrefix + key, value); },
      removeItem: function(key) { _real.removeItem(storagePrefix + key); },
      clear: function() {
        var toRemove = [];
        for (var i = 0; i < _real.length; i++) {
          var k = _real.key(i);
          if (k && k.indexOf(storagePrefix) === 0) toRemove.push(k);
        }
        toRemove.forEach(function(k) { _real.removeItem(k); });
      },
      get length() {
        var count = 0;
        for (var i = 0; i < _real.length; i++) {
          var k = _real.key(i);
          if (k && k.indexOf(storagePrefix) === 0) count++;
        }
        return count;
      },
      key: function(index) {
        var count = 0;
        for (var i = 0; i < _real.length; i++) {
          var k = _real.key(i);
          if (k && k.indexOf(storagePrefix) === 0) {
            if (count === index) return k.slice(storagePrefix.length);
            count++;
          }
        }
        return null;
      }
    };
    Object.defineProperty(window, '${storageName}', {
      get: function() { return proxy; },
      configurable: false
    });
  } catch(e) {}`;
}

/**
 * Generate the bridge script source for injection.
 * The parentOrigin parameter restricts postMessage to the host origin only.
 * The appId is used for localStorage namespacing.
 */
export function getBridgeScript(parentOrigin?: string, appId?: string): string {
  const origin = parentOrigin && parentOrigin !== '*'
    ? JSON.stringify(parentOrigin)
    : 'window.location.origin';

  const storagePrefix = appId ? JSON.stringify(`__aiga_${appId}:`) : '"__aiga_default:"';

  return `
(function() {
  if (window.__aigaBridge) return;
  window.__aigaBridge = true;

  var targetOrigin = ${origin};
  var storagePrefix = ${storagePrefix};

  // Save real parent reference before overriding (SEC-01/02).
  var _realParent = window.parent;

  // Override window.top and window.parent to prevent iframe escape.
  try {
    Object.defineProperty(window, 'parent', {
      get: function() { return window; },
      configurable: false
    });
    Object.defineProperty(window, 'top', {
      get: function() { return window; },
      configurable: false
    });
  } catch(e) {}

  // Namespace localStorage (JS-06).
${storageProxySnippet('localStorage')}

  // Namespace sessionStorage (JS-06).
${storageProxySnippet('sessionStorage')}

  // Namespace document.cookie (SEC-02).
  try {
    var _cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                      Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
    if (_cookieDesc) {
      var _origGet = _cookieDesc.get;
      var _origSet = _cookieDesc.set;
      Object.defineProperty(document, 'cookie', {
        get: function() {
          var all = _origGet.call(document);
          // Filter to only return cookies prefixed with our namespace.
          return all.split('; ').filter(function(c) {
            return c.indexOf(storagePrefix) === 0;
          }).map(function(c) {
            return c.slice(storagePrefix.length);
          }).join('; ');
        },
        set: function(value) {
          // Prefix the cookie name with our namespace.
          var eqIdx = value.indexOf('=');
          if (eqIdx > 0) {
            var name = value.substring(0, eqIdx);
            var rest = value.substring(eqIdx);
            _origSet.call(document, storagePrefix + name + rest);
          } else {
            _origSet.call(document, storagePrefix + value);
          }
        },
        configurable: false
      });
    }
  } catch(e) {}

  // Helper to send messages to host via saved real parent.
  function sendToHost(msg) {
    _realParent.postMessage(msg, targetOrigin);
  }

  // Overlay detection heuristic (OV-13): require strong signals.
  function isOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;
    var cn = el.className ? el.className.toString() : '';
    var role = el.getAttribute('role');
    if (role === 'dialog' || role === 'tooltip' || role === 'alertdialog') return true;
    if (/\\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\\b/i.test(cn)) return true;
    var s = el.style;
    if (s.position === 'fixed') {
      var z = parseInt(s.zIndex, 10);
      if (!isNaN(z) && z > 1000) return true;
    }
    return false;
  }

  // Track active overlay count for iframe promotion.
  var activeOverlays = 0;

  // Intercept body.appendChild/insertBefore for overlay detection.
  var origAppend = document.body.appendChild.bind(document.body);
  var origInsert = document.body.insertBefore.bind(document.body);

  function handleOverlayAdd(node) {
    if (isOverlay(node)) {
      activeOverlays++;
      if (activeOverlays === 1) {
        sendToHost({ __aiga_dom_bridge: true, action: 'overlay-show' });
      }

      // Watch for removal.
      var mo = new MutationObserver(function(mutations) {
        for (var i = 0; i < mutations.length; i++) {
          for (var j = 0; j < mutations[i].removedNodes.length; j++) {
            if (mutations[i].removedNodes[j] === node || !document.body.contains(node)) {
              activeOverlays = Math.max(0, activeOverlays - 1);
              if (activeOverlays === 0) {
                sendToHost({ __aiga_dom_bridge: true, action: 'overlay-hide' });
              }
              mo.disconnect();
              return;
            }
          }
        }
      });
      mo.observe(node.parentNode || document.body, { childList: true, subtree: true });
    }
  }

  document.body.appendChild = function(node) {
    handleOverlayAdd(node);
    return origAppend(node);
  };

  document.body.insertBefore = function(node, ref) {
    handleOverlayAdd(node);
    return origInsert(node, ref);
  };

  // Listen for CSS variable updates from host (CSS-03).
  window.addEventListener('message', function(e) {
    if (e.data && e.data.__aiga_css_vars) {
      var style = document.documentElement.style;
      var vars = e.data.vars;
      for (var key in vars) {
        if (vars.hasOwnProperty(key)) {
          style.setProperty(key, vars[key]);
        }
      }
    }
  });

  // Report document height changes for auto-resize.
  var ro = new ResizeObserver(function() {
    sendToHost({
      __aiga_resize: true,
      height: document.documentElement.scrollHeight
    });
  });
  ro.observe(document.documentElement);
})();
`;
}

/**
 * Options for setting up the DOM bridge.
 */
export interface DomBridgeOptions {
  /** The host origin for secure postMessage targeting. */
  parentOrigin?: string;
  /** App ID for storage namespacing. */
  appId?: string;
  /** Called when overlay is detected and iframe should be promoted. */
  onOverlayShow?: () => void;
  /** Called when all overlays are dismissed and iframe should be demoted. */
  onOverlayHide?: () => void;
}

/**
 * Set up the DOM bridge for a same-origin iframe.
 * Injects the bridge script and handles iframe promotion for overlays.
 *
 * @param iframe - The iframe element to bridge.
 * @param options - Bridge configuration.
 */
export function setupDomBridge(
  iframe: HTMLIFrameElement,
  options: DomBridgeOptions = {},
): () => void {
  const { parentOrigin, appId, onOverlayShow, onOverlayHide } = options;

  const messageHandler = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    // Validate origin for security.
    if (parentOrigin && parentOrigin !== '*' && e.origin !== parentOrigin) return;
    if (!e.data?.__aiga_dom_bridge) return;

    switch (e.data.action) {
      case 'overlay-show':
        onOverlayShow?.();
        break;
      case 'overlay-hide':
        onOverlayHide?.();
        break;
    }
  };

  window.addEventListener('message', messageHandler);

  const bridgeScript = getBridgeScript(parentOrigin, appId);

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
