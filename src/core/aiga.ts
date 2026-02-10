import type { AigaConfig, SandboxLevel } from './types.js';
import type { SandboxAdapter } from './sandbox/adapter.js';
import { IframePool } from './iframe-pool/pool.js';
import { KeepAliveManager } from './iframe-pool/keep-alive-manager.js';
import { Prewarmer, type RouteConfig } from './iframe-pool/prewarmer.js';
import { NoneSandbox } from './sandbox/none.js';
import { LightSandbox } from './sandbox/light.js';
import { StrictSandbox } from './sandbox/strict.js';
import { RemoteSandbox } from './sandbox/remote.js';
import { registerServiceWorker, type SwController } from '../sw/register.js';

/**
 * Global Aiga framework instance (singleton).
 *
 * Manages the iframe pool, keep-alive state, sandbox adapter registry,
 * smart prewarmer, and Service Worker lifecycle.
 */
export class Aiga {
  private static instance: Aiga | null = null;

  readonly pool: IframePool;
  readonly keepAlive: KeepAliveManager;
  readonly prewarmer: Prewarmer;
  private adapters: Map<SandboxLevel, SandboxAdapter>;
  private swController: SwController | null = null;
  private config: AigaConfig;

  private constructor(config: AigaConfig = {}) {
    this.config = config;
    this.pool = new IframePool(config.pool);
    this.keepAlive = new KeepAliveManager({
      maxAlive: config.pool?.maxAlive,
    });
    this.prewarmer = new Prewarmer(this.pool);

    // Initialize sandbox adapters.
    this.adapters = new Map<SandboxLevel, SandboxAdapter>([
      ['none', new NoneSandbox()],
      ['light', new LightSandbox()],
      ['strict', new StrictSandbox(this.pool)],
      ['remote', new RemoteSandbox()],
    ]);
  }

  static getInstance(config?: AigaConfig): Aiga {
    if (!Aiga.instance) {
      Aiga.instance = new Aiga(config);
    }
    return Aiga.instance;
  }

  /** Get the sandbox adapter for a given isolation level. */
  getAdapter(level: SandboxLevel): SandboxAdapter {
    const adapter = this.adapters.get(level);
    if (!adapter) {
      throw new Error(`Unknown sandbox level: ${level}`);
    }
    return adapter;
  }

  /** Register a custom sandbox adapter (e.g., future ShadowRealm adapter). */
  registerAdapter(level: string, adapter: SandboxAdapter): void {
    this.adapters.set(level as SandboxLevel, adapter);
  }

  /** Configure route-based smart prewarming. */
  setRoutes(routes: RouteConfig[]): void {
    this.prewarmer.setRoutes(routes);
  }

  /** Record a navigation event for predictive prewarming. */
  recordNavigation(path: string): void {
    this.prewarmer.recordNavigation(path);
  }

  /** Initialize the Service Worker layer. */
  async initServiceWorker(): Promise<void> {
    if (this.config.cache?.enabled !== false) {
      this.swController = await registerServiceWorker(this.config.cache);
    }
  }

  /** Get the Service Worker controller for cache operations. */
  getSw(): SwController | null {
    return this.swController;
  }

  /** Default sandbox level from configuration. */
  get defaultSandbox(): SandboxLevel {
    return this.config.defaultSandbox ?? 'strict';
  }

  /** Tear down the entire framework instance. */
  dispose(): void {
    this.pool.dispose();
    this.keepAlive.dispose();
    this.prewarmer.dispose();
    this.swController?.unregister();
    Aiga.instance = null;
  }
}
