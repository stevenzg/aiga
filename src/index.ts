/**
 * Aiga — Next-Generation Micro-Frontend Framework
 *
 * Adaptive Sandbox Architecture with Tiered Isolation.
 *
 * @example
 * ```html
 * <script type="module">
 *   import { initAiga } from 'aiga';
 *   initAiga();
 * </script>
 *
 * <mf-app src="https://dashboard.example.com" />
 * <mf-app src="https://widget.example.com" sandbox="strict" />
 * <mf-app src="https://trusted.example.com" sandbox="light" />
 * ```
 */

// Core types
export type {
  SandboxLevel,
  MfAppConfig,
  AppStatus,
  MfAppEvents,
  AppInstance,
  IframePoolOptions,
  SwCacheConfig,
  AigaConfig,
} from './core/types.js';

// Sandbox adapters
export type { SandboxAdapter } from './core/sandbox/adapter.js';
export { NoneSandbox } from './core/sandbox/none.js';
export { LightSandbox } from './core/sandbox/light.js';
export { StrictSandbox } from './core/sandbox/strict.js';
export { RemoteSandbox } from './core/sandbox/remote.js';

// iframe Pool
export { IframePool } from './core/iframe-pool/pool.js';

// Overlay Layer
export { OverlayLayer } from './core/overlay/overlay-layer.js';

// RPC
export { RpcChannel } from './core/rpc/channel.js';
export type { RpcProxy, Serializable, Unsubscribe } from './core/rpc/types.js';

// Service Worker
export { registerServiceWorker, SwController } from './sw/register.js';

// Web Component
export { MfAppElement, registerMfApp } from './mf-app.js';

// Framework singleton
export { Aiga } from './core/aiga.js';

// --- Convenience init function ---

import type { AigaConfig } from './core/types.js';
import { Aiga } from './core/aiga.js';
import { registerMfApp } from './mf-app.js';

/**
 * Initialize the Aiga micro-frontend framework.
 *
 * Call this once at application startup. It:
 * 1. Registers the `<mf-app>` custom element
 * 2. Initializes the iframe pool
 * 3. Optionally registers the Service Worker resource layer
 *
 * @example
 * ```ts
 * import { initAiga } from 'aiga';
 *
 * initAiga({
 *   defaultSandbox: 'strict',
 *   pool: { initialSize: 3, maxSize: 10 },
 *   cache: { enabled: true, swUrl: '/sw.js' },
 * });
 * ```
 */
export function initAiga(config?: AigaConfig): Aiga {
  const aiga = Aiga.getInstance(config);

  // Register the <mf-app> Web Component.
  registerMfApp();

  // Initialize Service Worker if configured.
  if (config?.cache?.enabled) {
    aiga.initServiceWorker().catch((err) => {
      console.warn('[aiga] Service Worker init failed:', err);
    });
  }

  return aiga;
}
