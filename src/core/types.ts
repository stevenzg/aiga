/**
 * Sandbox isolation levels for micro-frontend applications.
 *
 * - `none`:   Direct mount, no isolation. For same-team trusted modules.
 * - `light`:  Shadow DOM + CSS variable pass-through + lightweight Proxy.
 * - `strict`: Pooled iframe + Shadow DOM + Proxy bridge + Overlay layer.
 * - `remote`: Pure iframe, no bridge. For fully untrusted third-party pages.
 */
export type SandboxLevel = 'none' | 'light' | 'strict' | 'remote';

/** Configuration for a micro-frontend application instance. */
export interface MfAppConfig {
  /** URL of the sub-application to load. */
  src: string;
  /** Sandbox isolation level. Defaults to `'strict'`. */
  sandbox?: SandboxLevel;
  /** Keep the sub-app alive when unmounted (preserves state). */
  keepAlive?: boolean;
  /** Custom name identifier for this sub-app instance. */
  name?: string;
  /** Props to pass to the sub-app via RPC on mount. */
  props?: Record<string, unknown>;
}

/** Lifecycle states of a micro-frontend application. */
export type AppStatus =
  | 'idle'
  | 'loading'
  | 'mounting'
  | 'mounted'
  | 'unmounting'
  | 'unmounted'
  | 'error';

/** Events emitted during the micro-frontend lifecycle. */
export interface MfAppEvents {
  'status-change': CustomEvent<{ status: AppStatus; prevStatus: AppStatus }>;
  'error': CustomEvent<{ error: Error; phase: string }>;
  'rpc-ready': CustomEvent<{ appName: string }>;
}

/** Internal representation of a managed sub-application. */
export interface AppInstance {
  id: string;
  name: string;
  src: string;
  sandbox: SandboxLevel;
  status: AppStatus;
  container: HTMLElement | null;
  iframe: HTMLIFrameElement | null;
  keepAlive: boolean;
  lastActiveAt: number;
  props: Record<string, unknown>;
}

/** Options for the iframe pool. */
export interface IframePoolOptions {
  /** Initial pool size. Defaults to 3. */
  initialSize?: number;
  /** Maximum pool size. Defaults to 10. */
  maxSize?: number;
  /** Maximum number of alive (keep-alive) iframes. Defaults to 5. */
  maxAlive?: number;
}

/** Configuration for the Service Worker resource layer. */
export interface SwCacheConfig {
  /** Enable/disable the SW layer. Defaults to true. */
  enabled?: boolean;
  /** URL of the service worker script. */
  swUrl?: string;
  /** Cache strategy for sub-app resources. */
  strategy?: 'cache-first' | 'network-first' | 'stale-while-revalidate';
}

/** Global framework configuration. */
export interface AigaConfig {
  /** iframe pool options. */
  pool?: IframePoolOptions;
  /** Service Worker cache configuration. */
  cache?: SwCacheConfig;
  /** Default sandbox level for all sub-apps. Defaults to `'strict'`. */
  defaultSandbox?: SandboxLevel;
  /** Timeout in ms for loading sub-apps. Defaults to 10000. */
  loadTimeout?: number;
  /** Default timeout in ms for RPC calls. Defaults to 10000. */
  rpcTimeout?: number;
}
