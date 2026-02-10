/**
 * Overlay Layer Proxy
 *
 * Solves the Shadow DOM body-mount problem: UI libraries (antd, Element Plus)
 * append Modal/Popover/Dropdown elements to `document.body`. Inside Shadow DOM,
 * `position: fixed` is relative to the shadow container, not the viewport,
 * and `z-index` doesn't interop across shadow boundaries.
 *
 * The Overlay Layer lives outside Shadow DOM at the top of the document.
 * Overlay elements are detected and teleported here so they render correctly.
 */

/** Heuristics to detect overlay elements. */
function isOverlayElement(el: HTMLElement): boolean {
  const style = el.style;
  const className = el.className?.toString?.() ?? '';
  const role = el.getAttribute('role');

  // Check position: fixed/absolute with high z-index.
  if (style.position === 'fixed') return true;

  // Check common overlay class names.
  const overlayPatterns =
    /\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\b/i;
  if (overlayPatterns.test(className)) return true;

  // Check WAI-ARIA roles.
  if (role === 'dialog' || role === 'tooltip' || role === 'alertdialog') {
    return true;
  }

  // Check computed z-index (only if already in the DOM).
  if (el.isConnected) {
    const computed = getComputedStyle(el);
    const zIndex = parseInt(computed.zIndex, 10);
    if (!isNaN(zIndex) && zIndex > 1000) return true;
  }

  return false;
}

/**
 * Manages a dedicated overlay layer for a micro-frontend app.
 * Intercepts `appendChild` / `insertBefore` on the shadow root or
 * an inner container, and teleports overlay elements to the top-level layer.
 */
export class OverlayLayer {
  private layerEl: HTMLElement;
  private observer: MutationObserver | null = null;
  private teleportedEls = new Set<HTMLElement>();

  constructor(private appId: string) {
    this.layerEl = document.createElement('div');
    this.layerEl.setAttribute('data-aiga-overlay', appId);
    this.layerEl.style.cssText =
      'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;';
    document.body.appendChild(this.layerEl);
  }

  /**
   * Start observing a container (typically the Shadow DOM root or its
   * inner wrapper) for newly appended overlay elements.
   */
  observe(target: Node): void {
    this.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && isOverlayElement(node)) {
            this.teleport(node);
          }
        }
      }
    });

    this.observer.observe(target, { childList: true, subtree: true });
  }

  /** Teleport an overlay element to the top-level overlay layer. */
  private teleport(el: HTMLElement): void {
    // Wrap in a container that restores pointer events.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-overlay-item', '');
    wrapper.style.cssText = 'pointer-events:auto;';

    // Move the element.
    const placeholder = document.createComment(`aiga-overlay-${this.appId}`);
    el.parentNode?.insertBefore(placeholder, el);
    wrapper.appendChild(el);
    this.layerEl.appendChild(wrapper);
    this.teleportedEls.add(el);

    // Watch for removal: if the element is removed from the overlay wrapper,
    // clean up the wrapper too.
    const cleanupObserver = new MutationObserver(() => {
      if (!wrapper.contains(el)) {
        wrapper.remove();
        placeholder.remove();
        this.teleportedEls.delete(el);
        cleanupObserver.disconnect();
      }
    });
    cleanupObserver.observe(wrapper, { childList: true });
  }

  /** Stop observing and clean up all teleported elements. */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.teleportedEls.clear();
    this.layerEl.remove();
  }
}
