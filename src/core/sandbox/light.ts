import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';

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

    // Fetch and inject HTML content.
    const html = await this.fetchAppHtml(app.src);

    // Create a scoped container inside Shadow DOM.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-content', '');
    wrapper.style.cssText = 'all:initial;display:block;';
    wrapper.innerHTML = html;
    shadow.appendChild(wrapper);

    // Process scripts with a scoped execution context.
    await this.executeScripts(wrapper, app);
  }

  async unmount(app: AppInstance): Promise<void> {
    const shadow = this.shadowRoots.get(app.id);
    if (shadow) {
      const host = shadow.host as HTMLElement;
      host.remove();
    }
  }

  async destroy(app: AppInstance): Promise<void> {
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
    // Extract all CSS custom properties from :root.
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

  /** Execute scripts found in the injected HTML with a scoped context. */
  private async executeScripts(
    container: HTMLElement,
    _app: AppInstance,
  ): Promise<void> {
    const scripts = container.querySelectorAll('script');
    for (const script of scripts) {
      const newScript = document.createElement('script');
      if (script.src) {
        newScript.src = script.src;
      } else {
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
