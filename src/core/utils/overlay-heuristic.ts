/**
 * Shared overlay detection heuristic (OV-13).
 *
 * Centralized logic for detecting overlay-like elements (modals, popover,
 * dropdown, etc.). Used by OverlayLayer, proxy-window, and dom-bridge.
 *
 * Requires strong signals — position:fixed alone is NOT enough
 * (it could be a header, nav, or sticky sidebar).
 */

/** Regex pattern for common overlay class names in UI libraries. */
export const OVERLAY_CLASS_PATTERN =
  /\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\b/i;

/** Roles that indicate an overlay element. */
export const OVERLAY_ROLES = new Set(['dialog', 'tooltip', 'alertdialog']);

/**
 * Determine if an element is likely an overlay.
 *
 * @param el - The element to check.
 * @param checkComputed - Whether to also check computed styles (requires element to be connected).
 */
export function isOverlayElement(el: HTMLElement, checkComputed = true): boolean {
  const className = el.className?.toString?.() ?? '';
  const role = el.getAttribute('role');

  // Semantic role is the strongest signal.
  if (role && OVERLAY_ROLES.has(role)) return true;

  // Class name matching for common UI library patterns.
  if (OVERLAY_CLASS_PATTERN.test(className)) return true;

  // Inline position:fixed + high z-index.
  const style = el.style;
  if (style.position === 'fixed') {
    const inlineZ = parseInt(style.zIndex, 10);
    if (!isNaN(inlineZ) && inlineZ > 1000) return true;
  }

  // Check computed styles only for connected elements (avoids forced layout on detached nodes).
  if (checkComputed && el.isConnected) {
    const computed = getComputedStyle(el);
    if (computed.position === 'fixed') {
      const computedZ = parseInt(computed.zIndex, 10);
      if (!isNaN(computedZ) && computedZ > 1000) return true;
    }
  }

  return false;
}

/**
 * Generate the overlay detection function source code for injection into
 * iframe bridge scripts (where imports are not available).
 */
export function getOverlayHeuristicSource(): string {
  return `
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
  }`;
}
