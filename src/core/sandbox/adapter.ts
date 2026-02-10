import type { AppInstance } from '../types.js';

/**
 * Abstract sandbox adapter interface.
 *
 * Each isolation level (none, light, strict, remote) implements this
 * interface with different browser primitives. This abstraction also
 * enables future ShadowRealm migration without changing the public API.
 */
export interface SandboxAdapter {
  /** Human-readable name of this adapter for debugging. */
  readonly name: string;

  /**
   * Mount the sub-application into the given container element.
   * The container is typically a Shadow DOM host managed by `<aiga-app>`.
   */
  mount(app: AppInstance, container: HTMLElement): Promise<void>;

  /**
   * Unmount the sub-application. If `keepAlive` is true, the adapter
   * should preserve internal state for fast re-mount.
   */
  unmount(app: AppInstance): Promise<void>;

  /**
   * Completely destroy the sandbox and release all resources.
   * Called when the `<aiga-app>` element is removed from the DOM.
   */
  destroy(app: AppInstance): Promise<void>;

  /**
   * Send a message to the sandboxed application.
   * Used by the RPC layer for cross-boundary communication.
   */
  postMessage(app: AppInstance, message: unknown): void;

  /**
   * Register a handler for messages from the sandboxed application.
   * Returns an unsubscribe function.
   */
  onMessage(app: AppInstance, handler: (data: unknown) => void): () => void;
}
