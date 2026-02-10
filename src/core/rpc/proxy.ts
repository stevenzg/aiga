/**
 * Typed RPC Proxy Helpers — `useMicroApp<T>()` and `useShell<T>()`
 *
 * These factory functions create Proxy objects that wrap an RpcChannel,
 * making cross-iframe communication feel like local function calls with
 * full TypeScript intellisense and compile-time type checking.
 *
 * @example
 * ```ts
 * // Define a contract interface
 * interface DashboardAPI {
 *   getMetrics(range: DateRange): Promise<Metrics[]>;
 *   getVersion(): Promise<string>;
 * }
 *
 * // In the host app:
 * const dashboard = useMicroApp<DashboardAPI>(rpcChannel);
 * const metrics = await dashboard.getMetrics({ start, end });
 * //    ^^^^^^^ Full TypeScript intellisense
 *
 * // In the sub-app:
 * interface ShellAPI {
 *   navigate(path: string): void;
 *   showNotification(msg: string, level: 'info' | 'error'): void;
 * }
 * const shell = useShell<ShellAPI>(rpcChannel);
 * shell.navigate('/settings');
 * ```
 */

import type { RpcChannel } from './channel.js';
import type { Serializable } from './types.js';

/**
 * Extract the async-callable methods from a contract interface.
 * All methods become Promise-returning through RPC serialization.
 */
export type AsyncProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? (...args: A) => Promise<R>
    : T[K] extends (...args: infer A) => infer R
      ? (...args: A) => Promise<R>
      : never;
};

/**
 * Keys that must NOT be proxied to prevent infinite loops and
 * broken serialization. In particular, `then` must return undefined
 * so that `await proxy` resolves to the proxy itself rather than
 * triggering an infinite thenable chain.
 */
const NON_PROXIED_KEYS = new Set<string>([
  'then',        // Prevents thenable infinite loop with `await`
  'catch',       // Promise protocol
  'finally',     // Promise protocol
  'toJSON',      // Prevents issues with JSON.stringify
  'valueOf',     // Prevents issues with type coercion
  'toString',    // Object protocol
  'constructor', // Object protocol
]);

/**
 * Create a typed RPC proxy for communicating with a micro-frontend app.
 *
 * All method calls on the returned proxy are transparently serialized
 * as RPC calls over the channel. The sub-app must expose matching
 * method handlers via `channel.expose()`.
 *
 * @example
 * ```ts
 * const dashboard = useMicroApp<DashboardAPI>(channel);
 * const data = await dashboard.getMetrics({ start, end });
 * ```
 */
export function useMicroApp<T>(channel: RpcChannel): AsyncProxy<T> {
  return createRpcProxy<T>(channel);
}

/**
 * Create a typed RPC proxy for communicating with the shell/host app.
 *
 * Used from within a sub-application to call methods exposed by the
 * host shell. The shell must expose matching method handlers.
 *
 * @example
 * ```ts
 * const shell = useShell<ShellAPI>(channel);
 * shell.navigate('/settings');
 * ```
 */
export function useShell<T>(channel: RpcChannel): AsyncProxy<T> {
  return createRpcProxy<T>(channel);
}

/**
 * Expose a typed API implementation to the remote side.
 *
 * Registers all methods of the implementation object as RPC handlers
 * on the channel, so the remote side can call them via a typed proxy.
 *
 * @example
 * ```ts
 * const shellImpl: ShellAPI = {
 *   navigate(path) { router.push(path); },
 *   showNotification(msg, level) { notify(msg, level); },
 *   getCurrentUser() { return currentUser; },
 * };
 * exposeApi(channel, shellImpl);
 * ```
 */
export function exposeApi<T extends Record<string, (...args: Serializable[]) => unknown>>(
  channel: RpcChannel,
  implementation: T,
): void {
  for (const [method, handler] of Object.entries(implementation)) {
    if (typeof handler === 'function') {
      channel.expose(method, handler as (...args: Serializable[]) => Serializable);
    }
  }
}

/**
 * Create a Proxy that converts property access into RPC calls.
 * `proxy.someMethod(arg1, arg2)` → `channel.call('someMethod', arg1, arg2)`
 */
function createRpcProxy<T>(channel: RpcChannel): AsyncProxy<T> {
  return new Proxy({} as AsyncProxy<T>, {
    get(_target, prop) {
      // Return undefined for symbols and non-proxied keys (prevents thenable loop).
      if (typeof prop === 'symbol') return undefined;
      if (NON_PROXIED_KEYS.has(prop as string)) return undefined;

      const method = prop as string;

      // Return a function that calls the remote method via RPC.
      return (...args: Serializable[]) => {
        return channel.call(method, ...args);
      };
    },
  });
}
