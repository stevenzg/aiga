import type { SandboxAdapter } from './adapter.js';
import type { AppInstance } from '../types.js';

/**
 * `sandbox="none"` — Direct mount with zero isolation.
 *
 * The sub-application is fetched as HTML, and its content is directly
 * injected into the host document flow. No Shadow DOM, no Proxy, no
 * iframe. Suitable only for fully trusted, same-team modules.
 *
 * Memory overhead: ~0 MB above the content itself.
 */
export class NoneSandbox implements SandboxAdapter {
  readonly name = 'none';
  private containers = new Map<string, HTMLElement>();
  private messageHandlers = new Map<string, Set<(data: unknown) => void>>();

  async mount(app: AppInstance, container: HTMLElement): Promise<void> {
    this.containers.set(app.id, container);

    // Fetch the sub-app HTML and inject inline.
    const html = await this.fetchAppHtml(app.src);

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-aiga-none', app.name);
    wrapper.innerHTML = html;
    container.appendChild(wrapper);

    // Execute any inline scripts.
    const scripts = wrapper.querySelectorAll('script');
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

  async unmount(app: AppInstance): Promise<void> {
    const container = this.containers.get(app.id);
    if (container) {
      const wrapper = container.querySelector(`[data-aiga-none="${app.name}"]`);
      wrapper?.remove();
    }
  }

  async destroy(app: AppInstance): Promise<void> {
    await this.unmount(app);
    this.containers.delete(app.id);
    this.messageHandlers.delete(app.id);
  }

  postMessage(app: AppInstance, message: unknown): void {
    // In none-sandbox, we use CustomEvents on the container element.
    const container = this.containers.get(app.id);
    container?.dispatchEvent(
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

    const container = this.containers.get(app.id);
    const listener = (e: Event) => handler((e as CustomEvent).detail);
    container?.addEventListener('aiga-message-up', listener);

    return () => {
      handlers!.delete(handler);
      container?.removeEventListener('aiga-message-up', listener);
    };
  }

  private async fetchAppHtml(src: string): Promise<string> {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`Failed to fetch ${src}: ${res.status}`);
    return res.text();
  }
}
