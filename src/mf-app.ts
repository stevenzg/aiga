import type { AppInstance, AppStatus, SandboxLevel } from './core/types.js';
import type { SandboxAdapter } from './core/sandbox/adapter.js';
import { Aiga } from './core/aiga.js';
import { RpcChannel } from './core/rpc/channel.js';
import { OverlayLayer } from './core/overlay/overlay-layer.js';

let instanceCounter = 0;

/**
 * `<mf-app>` — The unified micro-frontend Web Component.
 *
 * Usage:
 *   <mf-app src="https://app.example.com" />
 *   <mf-app src="https://app.example.com" sandbox="strict" />
 *   <mf-app src="https://app.example.com" sandbox="strict" keep-alive />
 *
 * Works in any framework: React, Vue, Angular, Svelte, or vanilla HTML.
 */
export class MfAppElement extends HTMLElement {
  static readonly tagName = 'mf-app';

  /** Observed attributes for reactive updates. */
  static get observedAttributes(): string[] {
    return ['src', 'sandbox', 'keep-alive', 'name'];
  }

  private app: AppInstance;
  private adapter: SandboxAdapter | null = null;
  private rpc: RpcChannel | null = null;
  private overlay: OverlayLayer | null = null;
  private container: HTMLElement | null = null;
  private shadow: ShadowRoot;
  private mounted = false;

  constructor() {
    super();

    const id = `mf_${++instanceCounter}`;
    this.app = {
      id,
      name: '',
      src: '',
      sandbox: 'strict',
      status: 'idle',
      container: null,
      iframe: null,
      keepAlive: false,
      lastActiveAt: Date.now(),
    };

    // Attach Shadow DOM for encapsulation of the component itself.
    this.shadow = this.attachShadow({ mode: 'open' });
  }

  // --- Public properties (reflect attributes) ---

  get src(): string {
    return this.getAttribute('src') ?? '';
  }
  set src(val: string) {
    this.setAttribute('src', val);
  }

  get sandboxLevel(): SandboxLevel {
    return (this.getAttribute('sandbox') as SandboxLevel) ?? 'strict';
  }
  set sandboxLevel(val: SandboxLevel) {
    this.setAttribute('sandbox', val);
  }

  get keepAlive(): boolean {
    return this.hasAttribute('keep-alive');
  }
  set keepAlive(val: boolean) {
    if (val) this.setAttribute('keep-alive', '');
    else this.removeAttribute('keep-alive');
  }

  get appName(): string {
    return this.getAttribute('name') ?? this.app.id;
  }

  /** Get the RPC channel for type-safe communication with the sub-app. */
  get rpcChannel(): RpcChannel | null {
    return this.rpc;
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.render();
    this.syncAppState();

    if (this.src) {
      this.mount();
    }
  }

  disconnectedCallback(): void {
    this.unmountApp();
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;

    switch (name) {
      case 'src':
        this.syncAppState();
        if (this.isConnected && newValue) {
          this.remount();
        }
        break;
      case 'sandbox':
      case 'keep-alive':
      case 'name':
        this.syncAppState();
        break;
    }
  }

  // --- Internal ---

  /** Render the component's internal Shadow DOM structure. */
  private render(): void {
    const style = new CSSStyleSheet();
    style.replaceSync(`
      :host {
        display: block;
        position: relative;
        width: 100%;
        min-height: 0;
      }
      :host([hidden]) {
        display: none;
      }
      .mf-container {
        width: 100%;
        position: relative;
      }
      .mf-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        color: #888;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.875rem;
      }
      .mf-error {
        padding: 1rem;
        color: #dc2626;
        background: #fef2f2;
        border: 1px solid #fecaca;
        border-radius: 0.5rem;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 0.875rem;
      }
      .mf-spinner {
        width: 1.25rem;
        height: 1.25rem;
        border: 2px solid #e5e7eb;
        border-top-color: #3b82f6;
        border-radius: 50%;
        animation: spin 0.6s linear infinite;
        margin-right: 0.5rem;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    `);
    this.shadow.adoptedStyleSheets = [style];

    this.container = document.createElement('div');
    this.container.className = 'mf-container';
    this.shadow.appendChild(this.container);
  }

  /** Sync the internal app state with the current attributes. */
  private syncAppState(): void {
    this.app.src = this.src;
    this.app.sandbox = this.sandboxLevel;
    this.app.keepAlive = this.keepAlive;
    this.app.name = this.appName;
  }

  /** Mount the sub-application. */
  private async mount(): Promise<void> {
    if (this.mounted || !this.container) return;

    this.setStatus('loading');
    this.showLoading();

    try {
      const aiga = Aiga.getInstance();
      const level = this.sandboxLevel;
      this.adapter = aiga.getAdapter(level);

      this.app.container = this.container;

      // Set up overlay layer for strict/light modes.
      if (level === 'strict' || level === 'light') {
        this.overlay = new OverlayLayer(this.app.id);
        this.overlay.observe(this.container);
      }

      this.setStatus('mounting');
      this.clearContainer();

      await this.adapter.mount(this.app, this.container);

      // Set up RPC channel for iframe-based sandboxes.
      if (level === 'strict' || level === 'remote') {
        this.setupRpc();
      }

      this.mounted = true;
      this.setStatus('mounted');

      this.dispatchEvent(
        new CustomEvent('rpc-ready', {
          detail: { appName: this.appName },
          bubbles: true,
        }),
      );
    } catch (err) {
      this.setStatus('error');
      this.showError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Unmount the sub-application. */
  private async unmountApp(): Promise<void> {
    if (!this.mounted || !this.adapter) return;

    this.setStatus('unmounting');

    try {
      this.rpc?.dispose();
      this.rpc = null;

      this.overlay?.dispose();
      this.overlay = null;

      if (this.keepAlive) {
        await this.adapter.unmount(this.app);
      } else {
        await this.adapter.destroy(this.app);
      }
    } catch (err) {
      console.error('[aiga] Error during unmount:', err);
    }

    this.mounted = false;
    this.setStatus('unmounted');
  }

  /** Remount: unmount then mount with potentially new config. */
  private async remount(): Promise<void> {
    await this.unmountApp();
    await this.mount();
  }

  /** Set up the RPC channel for iframe-based communication. */
  private setupRpc(): void {
    // Find the iframe element.
    const iframe = this.container?.querySelector('iframe') ??
      this.shadow.querySelector('iframe');
    if (iframe?.contentWindow) {
      this.rpc = new RpcChannel(iframe.contentWindow);
    }
  }

  /** Update the app status and dispatch a change event. */
  private setStatus(status: AppStatus): void {
    const prev = this.app.status;
    this.app.status = status;
    this.app.lastActiveAt = Date.now();

    this.dispatchEvent(
      new CustomEvent('status-change', {
        detail: { status, prevStatus: prev },
        bubbles: true,
      }),
    );
  }

  /** Show a loading indicator. */
  private showLoading(): void {
    if (!this.container) return;
    this.clearContainer();
    const loading = document.createElement('div');
    loading.className = 'mf-loading';
    loading.innerHTML = '<div class="mf-spinner"></div>Loading application\u2026';
    this.container.appendChild(loading);
  }

  /** Show an error message. */
  private showError(error: Error): void {
    if (!this.container) return;
    this.clearContainer();
    const el = document.createElement('div');
    el.className = 'mf-error';
    el.textContent = `Failed to load application: ${error.message}`;
    this.container.appendChild(el);

    this.dispatchEvent(
      new CustomEvent('error', {
        detail: { error, phase: this.app.status },
        bubbles: true,
      }),
    );
  }

  private clearContainer(): void {
    if (this.container) {
      this.container.innerHTML = '';
    }
  }
}

/** Register the `<mf-app>` custom element. */
export function registerMfApp(): void {
  if (!customElements.get(MfAppElement.tagName)) {
    customElements.define(MfAppElement.tagName, MfAppElement);
  }
}
