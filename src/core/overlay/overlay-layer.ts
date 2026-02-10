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

/**
 * Heuristics to detect overlay elements (OV-13).
 * Requires strong signals — position:fixed alone is NOT enough
 * (it could be a header, nav, or sticky sidebar).
 */
function isOverlayElement(el: HTMLElement): boolean {
  const className = el.className?.toString?.() ?? '';
  const role = el.getAttribute('role');

  // Semantic role is the strongest signal.
  if (role === 'dialog' || role === 'tooltip' || role === 'alertdialog') {
    return true;
  }

  // Class name matching for common UI library patterns.
  const overlayPatterns =
    /\b(modal|overlay|popup|popover|drawer|dropdown|dialog|tooltip|mask|backdrop)\b/i;
  if (overlayPatterns.test(className)) return true;

  // position:fixed + high z-index: likely an overlay, not a header.
  const style = el.style;
  if (style.position === 'fixed') {
    const inlineZ = parseInt(style.zIndex, 10);
    if (!isNaN(inlineZ) && inlineZ > 1000) return true;
  }

  // Check computed styles only for connected elements.
  if (el.isConnected) {
    const computed = getComputedStyle(el);
    if (computed.position === 'fixed') {
      const computedZ = parseInt(computed.zIndex, 10);
      if (!isNaN(computedZ) && computedZ > 1000) return true;
    }
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
  private cleanupObservers = new Set<MutationObserver>();

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
    // Disconnect any previous observer to prevent leaks.
    if (this.observer) {
      this.observer.disconnect();
    }

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

  /**
   * Add an overlay element from a cross-iframe bridge.
   * Creates a DOM element from HTML and places it in the overlay layer.
   */
  addOverlayFromHtml(html: string, id?: string): HTMLElement | null {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const el = parsed.body.firstElementChild as HTMLElement | null;
    if (!el) return null;
    if (id) el.id = id;
    this.teleport(document.adoptNode(el));
    return el;
  }

  /** Teleport an overlay element to the top-level overlay layer. */
  private teleport(el: HTMLElement): void {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-overlay-item', '');
    wrapper.style.cssText = 'pointer-events:auto;';

    const placeholder = document.createComment(`aiga-overlay-${this.appId}`);
    el.parentNode?.insertBefore(placeholder, el);
    wrapper.appendChild(el);
    this.layerEl.appendChild(wrapper);
    this.teleportedEls.add(el);

    // Watch for removal.
    const cleanupObserver = new MutationObserver(() => {
      if (!wrapper.contains(el)) {
        wrapper.remove();
        placeholder.remove();
        this.teleportedEls.delete(el);
        cleanupObserver.disconnect();
        this.cleanupObservers.delete(cleanupObserver);
      }
    });
    cleanupObserver.observe(wrapper, { childList: true });
    this.cleanupObservers.add(cleanupObserver);
  }

  /** Stop observing and clean up all teleported elements. */
  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;

    // Disconnect all per-element cleanup observers.
    for (const obs of this.cleanupObservers) {
      obs.disconnect();
    }
    this.cleanupObservers.clear();

    this.teleportedEls.clear();
    this.layerEl.remove();
  }
}
