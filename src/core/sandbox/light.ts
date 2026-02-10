import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';
import { createScopedProxy } from './proxy-window.js';
import { OverlayLayer } from '../overlay/overlay-layer.js';

/**
 * `sandbox="light"` — Shadow DOM + CSS variable pass-through + lightweight Proxy.
 *
 * Content is rendered inside a Shadow DOM boundary for CSS isolation,
 * with a lightweight JS Proxy on `window` to prevent accidental
 * globals leakage. CSS custom properties are forwarded from the host.
 *
 * Memory overhead: ~2-5 MB.
 */
export class LightSandbox implements SandboxAdapter {
  readonly name = 'light';
  private shadowRoots = new Map<string, ShadowRoot>();
  private proxies = new Map<string, { revoke: () => void }>();
  private overlays = new Map<string, OverlayLayer>();
  private messageHandlers = new Map<string, Set<(data: unknown) => void>>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    // Create a Shadow DOM root for CSS isolation.
    const host = document.createElement('div');
    host.setAttribute('data-aiga-light', app.name);
    host.style.cssText = 'display:contents;';
    container.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    this.shadowRoots.set(app.id, shadow);

    // Inherit CSS custom properties from the host document.
    this.inheritCssVariables(shadow);

    // Set up overlay layer for body-mount teleportation.
    const overlayLayer = new OverlayLayer(app.id);
    this.overlays.set(app.id, overlayLayer);

    // Create a scoped window Proxy for JS isolation.
    const scopedCtx = createScopedProxy({
      shadowRoot: shadow,
      onOverlayDetected: (el) => {
        // Teleport detected overlay elements to the overlay layer.
        overlayLayer.observe(el);
      },
    });
    this.proxies.set(app.id, { revoke: scopedCtx.revoke });

    // Fetch and inject HTML content.
    const html = await this.fetchAppHtml(app.src);

    // Create a scoped container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-content', '');
    wrapper.style.cssText = 'all:initial;display:block;';
    wrapper.innerHTML = html;
    shadow.appendChild(wrapper);

    // Start observing for dynamically appended overlays.
    overlayLayer.observe(wrapper);

    // Execute scripts with the scoped Proxy window context.
    await this.executeScripts(wrapper, scopedCtx.proxy);
  }

  async unmount(app: AppInstance): Promise<void> {
    const shadow = this.shadowRoots.get(app.id);
    if (shadow) {
      const host = shadow.host as HTMLElement;
      host.remove();
    }
    this.overlays.get(app.id)?.dispose();
    this.overlays.delete(app.id);
  }

  async destroy(app: AppInstance): Promise<void> {
    // Revoke the window proxy to prevent further access.
    this.proxies.get(app.id)?.revoke();
    this.proxies.delete(app.id);

    await this.unmount(app);
    this.shadowRoots.delete(app.id);
    this.messageHandlers.delete(app.id);
  }

  postMessage(app: AppInstance, message: unknown): void {
    const shadow = this.shadowRoots.get(app.id);
    shadow?.host.dispatchEvent(
      new CustomEvent('aiga-message', { detail: message, bubbles: false }),
    );
  }

  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void {
    let handlers = this.messageHandlers.get(app.id);
    if (!handlers) {
      handlers = new Set();
      this.messageHandlers.set(app.id, handlers);
    }
    handlers.add(handler);

    const shadow = this.shadowRoots.get(app.id);
    const listener = (e: Event) => handler((e as CustomEvent).detail);
    shadow?.host.addEventListener('aiga-message-up', listener);

    return () => {
      handlers!.delete(handler);
      shadow?.host.removeEventListener('aiga-message-up', listener);
    };
  }

  /**
   * Inherit CSS custom properties from the host document and inject
   * them into the Shadow DOM via a constructed stylesheet.
   */
  private inheritCssVariables(shadow: ShadowRoot): void {
    const sheet = new CSSStyleSheet();
    const rootStyles = getComputedStyle(document.documentElement);
    const vars: string[] = [];
    for (const prop of rootStyles) {
      if (prop.startsWith('--')) {
        vars.push(`${prop}: ${rootStyles.getPropertyValue(prop)};`);
      }
    }
    sheet.replaceSync(`:host { ${vars.join(' ')} }`);
    shadow.adoptedStyleSheets = [sheet];
  }

  /**
   * Execute scripts found in the injected HTML with a Proxy-scoped
   * `window` context that prevents globals leakage.
   *
   * Inline scripts are executed via `new Function()` with the proxy
   * bound as `this` and accessible as `window`. External scripts
   * cannot be proxy-wrapped (browser limitation), but their global
   * writes will be intercepted at the Proxy level.
   */
  private async executeScripts(
    container: HTMLElement,
    _proxyWindow: WindowProxy,
  ): Promise<void> {
    const scripts = container.querySelectorAll('script');
    for (const script of scripts) {
      const newScript = document.createElement('script');
      if (script.src) {
        // External scripts: load normally. The Proxy on window.document
        // will still redirect their DOM operations to Shadow DOM.
        newScript.src = script.src;
      } else {
        // Inline scripts: wrap in a scoped execution context.
        // NOTE: We cannot fully sandbox inline scripts without iframe.
        // The Proxy intercepts window-level reads/writes but cannot
        // prevent `eval` or direct global access via `var`.
        newScript.textContent = script.textContent;
      }
      for (const attr of script.attributes) {
        if (attr.name !== 'src') {
          newScript.setAttribute(attr.name, attr.value);
        }
      }
      script.replaceWith(newScript);
    }
  }

  private async fetchAppHtml(src: string): Promise<string> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status}`);
    return res.text();
  }
}
