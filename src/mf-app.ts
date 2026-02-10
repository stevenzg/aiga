import type { AppInstance, AppStatus, SandboxLevel } from './core/types.js';
import type { SandboxAdapter } from './core/sandbox/adapter.js';
import { Aiga } from './core/aiga.js';
import { RpcChannel } from './core/rpc/channel.js';

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
 *
 * Events:
 *   - `status-change` — Fired on every lifecycle transition.
 *   - `error` — Fired when loading or mounting fails.
 *   - `rpc-ready` — Fired when the RPC channel is established.
 *   - `keep-alive-start` — Fired when the app enters keep-alive state.
 *   - `keep-alive-restore` — Fired when a kept-alive app is re-mounted.
 */
export class MfAppElement extends HTMLElement {
  static readonly tagName = 'mf-app';

  static get observedAttributes(): string[] {
    return ['src', 'sandbox', 'keep-alive', 'name'];
  }

  private app: AppInstance;
  private adapter: SandboxAdapter | null = null;
  private rpc: RpcChannel | null = null;
  private container: HTMLElement | null = null;
  private shadow: ShadowRoot;
  private mounted = false;
  private inKeepAlive = false;
  private rendered = false;
  private _props: Record<string, unknown> = {};

  /**
   * Lifecycle serialization lock.
   * Ensures mount/unmount/remount operations don't race each other.
   */
  private lifecycleLock: Promise<void> = Promise.resolve();

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
      props: {},
    };

    this.shadow = this.attachShadow({ mode: 'open' });
  }

  // --- Public properties ---

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

  /** Get the RPC channel for communication with the sub-app. */
  get rpcChannel(): RpcChannel | null {
    return this.rpc;
  }

  /** Whether this app is currently in keep-alive state (unmounted but preserved). */
  get isKeptAlive(): boolean {
    return this.inKeepAlive;
  }

  /** Current lifecycle status. */
  get status(): AppStatus {
    return this.app.status;
  }

  /** Props to pass to the sub-app via RPC (RPC-13). */
  get props(): Record<string, unknown> {
    return this._props;
  }
  set props(val: Record<string, unknown>) {
    this._props = val;
    this.app.props = val;
    // Send updated props to the sub-app if RPC channel is active.
    if (this.rpc) {
      this.rpc.emit('props-update', val as Record<string, never>);
    }
  }

  // --- Lifecycle ---

  connectedCallback(): void {
    this.render();
    this.syncAppState();

    if (this.src) {
      // Capture keepAlive state atomically before queuing in the lifecycle lock,
      // so a concurrent disconnectedCallback can't change it before execution.
      const shouldRestore = this.inKeepAlive;
      const appId = this.app.id;

      this.lifecycleLock = this.lifecycleLock.then(() => {
        if (shouldRestore) {
          const aiga = Aiga.getInstance();
          if (aiga.keepAlive.has(appId)) {
            return this.restoreFromKeepAlive();
          }
        }
        return this.mount();
      });
    }
  }

  disconnectedCallback(): void {
    this.lifecycleLock = this.lifecycleLock.then(() => this.unmountApp());
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
          this.lifecycleLock = this.lifecycleLock.then(() => this.remount());
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

  private render(): void {
    // Prevent duplicate rendering on reconnect.
    if (this.rendered) return;
    this.rendered = true;

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

  private syncAppState(): void {
    this.app.src = this.src;
    this.app.sandbox = this.sandboxLevel;
    this.app.keepAlive = this.keepAlive;
    this.app.name = this.appName;
    this.app.props = this._props;
  }

  private async mount(): Promise<void> {
    if (this.mounted || !this.container) return;

    this.setStatus('loading');
    this.showLoading();

    try {
      const aiga = Aiga.getInstance();
      const level = this.sandboxLevel;
      this.adapter = aiga.getAdapter(level);

      this.app.container = this.container;

      this.setStatus('mounting');
      this.clearContainer();

      // Mount with load timeout (ERR-03).
      const loadTimeout = aiga.loadTimeout;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        this.adapter.mount(this.app, this.container).then((v) => {
          clearTimeout(timeoutId);
          return v;
        }),
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(
            () => reject(new Error(`Application load timed out after ${loadTimeout}ms`)),
            loadTimeout,
          );
        }),
      ]);

      // Set up RPC channel for iframe-based sandboxes with origin-scoped targeting.
      if (level === 'strict' || level === 'remote') {
        this.setupRpc(aiga.rpcTimeout);
      }

      aiga.keepAlive.recordVisit(this.app.id);

      this.mounted = true;
      this.inKeepAlive = false;
      this.setStatus('mounted');

      // Send initial props and signal RPC readiness (only for iframe-based sandboxes).
      if (this.rpc) {
        if (Object.keys(this._props).length > 0) {
          this.rpc.emit('props-update', this._props as Record<string, never>);
        }
        this.dispatchEvent(
          new CustomEvent('rpc-ready', {
            detail: { appName: this.appName },
            bubbles: true,
          }),
        );
      }
    } catch (err) {
      this.setStatus('error');
      this.showError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  /** Unmount the sub-application with keep-alive support. */
  private async unmountApp(): Promise<void> {
    if (!this.mounted || !this.adapter) return;

    this.setStatus('unmounting');

    try {
      this.rpc?.dispose();
      this.rpc = null;

      if (this.keepAlive) {
        await this.adapter.unmount(this.app);
        this.inKeepAlive = true;

        const aiga = Aiga.getInstance();
        aiga.keepAlive.add(
          this.app.id,
          this.app.name,
          this.app.iframe,
        );

        this.dispatchEvent(
          new CustomEvent('keep-alive-start', {
            detail: { appName: this.appName, appId: this.app.id },
            bubbles: true,
          }),
        );
      } else {
        await this.adapter.destroy(this.app);
        this.inKeepAlive = false;
      }
    } catch (err) {
      console.error('[aiga] Error during unmount:', err);
    }

    this.mounted = false;
    this.setStatus('unmounted');
  }

  /** Restore from keep-alive: fast re-mount without full reload. */
  private async restoreFromKeepAlive(): Promise<void> {
    this.setStatus('mounting');

    try {
      const aiga = Aiga.getInstance();
      const level = this.sandboxLevel;
      this.adapter = aiga.getAdapter(level);
      this.app.container = this.container;

      if (this.container) {
        this.clearContainer();
        await this.adapter.mount(this.app, this.container);
      }

      if (level === 'strict' || level === 'remote') {
        this.setupRpc(aiga.rpcTimeout);
      }

      aiga.keepAlive.recordVisit(this.app.id);

      this.mounted = true;
      this.inKeepAlive = false;
      this.setStatus('mounted');

      // Re-send props on restore (RPC-13).
      if (this.rpc && Object.keys(this._props).length > 0) {
        this.rpc.emit('props-update', this._props as Record<string, never>);
      }

      this.dispatchEvent(
        new CustomEvent('keep-alive-restore', {
          detail: { appName: this.appName, appId: this.app.id },
          bubbles: true,
        }),
      );
    } catch (err) {
      this.setStatus('error');
      this.showError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private async remount(): Promise<void> {
    await this.unmountApp();
    await this.mount();
  }

  private setupRpc(timeout?: number): void {
    // Look for iframe in multiple locations:
    // 1. app.iframe — set by sandbox adapters (strict stores iframe behind nested Shadow DOM)
    // 2. container querySelector — works for remote sandbox (iframe is a direct child)
    // 3. shadow querySelector — fallback
    const iframe = this.app.iframe ??
      this.container?.querySelector('iframe') ??
      this.shadow.querySelector('iframe');
    if (iframe?.contentWindow) {
      // Use origin-scoped RPC channel with configurable timeout.
      this.rpc = RpcChannel.forApp(iframe.contentWindow, this.app.src, timeout);
    }
  }

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

  private showLoading(): void {
    if (!this.container) return;
    this.clearContainer();
    const loading = document.createElement('div');
    loading.className = 'mf-loading';
    loading.innerHTML = '<div class="mf-spinner"></div>Loading application\u2026';
    this.container.appendChild(loading);
  }

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
