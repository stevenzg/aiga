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
 * <aiga-app src="https://dashboard.example.com" />
 * <aiga-app src="https://widget.example.com" sandbox="strict" />
 * <aiga-app src="https://trusted.example.com" sandbox="light" />
 * ```
 */

// Core types
export type {
  SandboxLevel,
  AigaAppConfig,
  AppStatus,
  AigaAppEvents,
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

// Sandbox internals (advanced usage)
export { createScopedProxy } from './core/sandbox/proxy-window.js';
export { setupDomBridge, getBridgeScript } from './core/sandbox/dom-bridge.js';
export type { DomBridgeOptions } from './core/sandbox/dom-bridge.js';

// iframe Pool
export { IframePool } from './core/iframe-pool/pool.js';
export { KeepAliveManager } from './core/iframe-pool/keep-alive-manager.js';
export type { KeepAlivePriority, KeepAliveEntry } from './core/iframe-pool/keep-alive-manager.js';
export { Prewarmer } from './core/iframe-pool/prewarmer.js';
export type { RouteConfig, PrewarmerOptions } from './core/iframe-pool/prewarmer.js';

// Overlay Layer
export { OverlayLayer } from './core/overlay/overlay-layer.js';

// RPC
export { RpcChannel } from './core/rpc/channel.js';
export { useMicroApp, useShell, exposeApi } from './core/rpc/proxy.js';
export type { AsyncProxy } from './core/rpc/proxy.js';
export type { RpcProxy, Serializable, Unsubscribe } from './core/rpc/types.js';

// Router
export { Router } from './core/router/router.js';
export type {
  RouteConfig as RouterRouteConfig,
  MatchedRoute,
  NavigationGuard,
  NavigationHook,
  RouterOptions,
  RouterEvents,
} from './core/router/router.js';
export { AigaViewElement, registerAigaView } from './core/router/router-view.js';

// Service Worker
export { registerServiceWorker, SwController } from './sw/register.js';

// Semver utilities (for external use / testing)
export { parseSemver, compareSemver, isCompatible, negotiateVersion, VersionRegistry } from './sw/semver.js';

// Web Component
export { AigaAppElement, registerAigaApp } from './aiga-app.js';

// Framework singleton
export { Aiga } from './core/aiga.js';

// --- Convenience init function ---

import type { AigaConfig } from './core/types.js';
import { Aiga } from './core/aiga.js';
import { registerAigaApp } from './aiga-app.js';
import { registerAigaView } from './core/router/router-view.js';

/**
 * Initialize the Aiga micro-frontend framework.
 *
 * Call this once at application startup. It:
 * 1. Registers the `<aiga-app>` custom element
 * 2. Registers the `<aiga-view>` router outlet
 * 3. Initializes the iframe pool with LRU + keep-alive manager
 * 4. Sets up the smart prewarmer for predictive loading
 * 5. Optionally registers the Service Worker resource layer
 *
 * @example
 * ```ts
 * import { initAiga } from 'aiga';
 *
 * const aiga = initAiga({
 *   defaultSandbox: 'strict',
 *   pool: { initialSize: 3, maxSize: 10, maxAlive: 5 },
 *   cache: { enabled: true, swUrl: '/sw.js' },
 * });
 *
 * // Configure route-based smart prewarming:
 * aiga.setRoutes([
 *   { path: '/dashboard', appSrc: 'https://dashboard.app/', adjacentPaths: ['/settings'] },
 *   { path: '/settings', appSrc: 'https://settings.app/' },
 * ]);
 * ```
 */
export function initAiga(config?: AigaConfig): Aiga {
  const aiga = Aiga.getInstance(config);

  // Register Web Components.
  registerAigaApp();
  registerAigaView();

  // Initialize Service Worker if configured (enabled by default when cache config is present).
  if (config?.cache?.enabled !== false && config?.cache) {
    aiga.initServiceWorker().catch((err) => {
      console.warn('[aiga] Service Worker init failed:', err);
    });
  }

  return aiga;
}
