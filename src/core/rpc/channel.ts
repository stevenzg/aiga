import type { RpcMessage, RpcCallMessage, RpcResultMessage, RpcErrorMessage, RpcEventMessage, Serializable, Unsubscribe } from './types.js';

let rpcIdCounter = 0;
function nextId(): string {
  return `rpc_${++rpcIdCounter}_${Date.now().toString(36)}`;
}

/** Derive the origin from a URL for secure postMessage targeting. */
function deriveOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '*';
  }
}

function isRpcMessage(data: unknown): data is RpcMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    '__aiga_rpc' in data &&
    (data as RpcMessage).__aiga_rpc === true
  );
}

/**
 * Type-safe RPC communication channel.
 *
 * Wraps postMessage into a request/response pattern with Promise-based
 * returns, automatic serialization, and compile-time type checking
 * when used with a contract interface.
 */
export class RpcChannel {
  private pending = new Map<
    string,
    { resolve: (v: Serializable) => void; reject: (e: Error) => void }
  >();
  private handlers = new Map<string, (...args: Serializable[]) => Serializable | Promise<Serializable>>();
  private eventListeners = new Map<string, Set<(data: Serializable) => void>>();
  private windowListener: ((e: MessageEvent) => void) | null = null;
  private disposed = false;

  constructor(
    private target: Window | null,
    private targetOrigin: string = '*',
  ) {
    this.windowListener = this.handleMessage.bind(this);
    window.addEventListener('message', this.windowListener);
  }

  /**
   * Create an RPC channel for communicating with an app at the given URL.
   * Automatically derives the target origin for secure postMessage.
   */
  static forApp(target: Window, appSrc: string): RpcChannel {
    return new RpcChannel(target, deriveOrigin(appSrc));
  }

  /** Register a method handler that can be called from the remote side. */
  expose<T extends Serializable>(
    method: string,
    handler: (...args: Serializable[]) => T | Promise<T>,
  ): void {
    this.handlers.set(method, handler);
  }

  /** Call a method on the remote side. Returns a Promise with the result. */
  async call<T extends Serializable>(
    method: string,
    ...args: Serializable[]
  ): Promise<T> {
    if (this.disposed) throw new Error('RpcChannel disposed');
    if (!this.target) throw new Error('No target window');

    const id = nextId();
    const message: RpcCallMessage = {
      __aiga_rpc: true,
      id,
      type: 'call',
      method,
      args,
    };

    return new Promise<T>((resolve, reject) => {
      // Timeout after 30 seconds.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC call "${method}" timed out`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      this.target!.postMessage(message, this.targetOrigin);
    });
  }

  /** Emit an event to the remote side (fire-and-forget). */
  emit(event: string, data: Serializable): void {
    if (!this.target) return;
    const message: RpcEventMessage = {
      __aiga_rpc: true,
      id: nextId(),
      type: 'event',
      event,
      data,
    };
    this.target.postMessage(message, this.targetOrigin);
  }

  /** Listen for events from the remote side. */
  on(event: string, handler: (data: Serializable) => void): Unsubscribe {
    let listeners = this.eventListeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(event, listeners);
    }
    listeners.add(handler);

    return () => {
      listeners!.delete(handler);
      if (listeners!.size === 0) {
        this.eventListeners.delete(event);
      }
    };
  }

  /** Update the target window (e.g., after iframe navigation). */
  setTarget(target: Window | null, origin?: string): void {
    this.target = target;
    if (origin !== undefined) {
      this.targetOrigin = origin;
    }
  }

  private handleMessage(e: MessageEvent): void {
    if (this.disposed) return;
    if (!isRpcMessage(e.data)) return;

    // Strict source validation: only accept messages from our target window.
    // When target is null (channel not yet connected), reject all messages.
    if (!this.target || e.source !== this.target) return;

    // Validate origin if we have a specific targetOrigin.
    if (this.targetOrigin !== '*' && e.origin !== this.targetOrigin) return;

    const msg = e.data;

    switch (msg.type) {
      case 'call':
        this.handleCall(msg);
        break;
      case 'result':
        this.handleResult(msg);
        break;
      case 'error':
        this.handleError(msg);
        break;
      case 'event':
        this.handleEvent(msg);
        break;
    }
  }

  private async handleCall(msg: RpcCallMessage): Promise<void> {
    const handler = this.handlers.get(msg.method);
    if (!handler) {
      this.sendError(msg.id, `Unknown method: ${msg.method}`);
      return;
    }

    try {
      const result = await handler(...msg.args);
      this.sendResult(msg.id, result);
    } catch (err) {
      this.sendError(
        msg.id,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private handleResult(msg: RpcResultMessage): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    pending.resolve(msg.result);
  }

  private handleError(msg: RpcErrorMessage): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    pending.reject(new Error(msg.error));
  }

  private handleEvent(msg: RpcEventMessage): void {
    const listeners = this.eventListeners.get(msg.event);
    if (listeners) {
      for (const listener of listeners) {
        listener(msg.data);
      }
    }
  }

  private sendResult(id: string, result: Serializable): void {
    if (!this.target) return;
    const message: RpcResultMessage = {
      __aiga_rpc: true,
      id,
      type: 'result',
      result: result ?? null,
    };
    this.target.postMessage(message, this.targetOrigin);
  }

  private sendError(id: string, error: string): void {
    if (!this.target) return;
    const message: RpcErrorMessage = {
      __aiga_rpc: true,
      id,
      type: 'error',
      error,
    };
    this.target.postMessage(message, this.targetOrigin);
  }

  /** Dispose the channel and clean up all listeners. */
  dispose(): void {
    this.disposed = true;
    if (this.windowListener) {
      window.removeEventListener('message', this.windowListener);
      this.windowListener = null;
    }
    // Reject all pending calls.
    for (const [, p] of this.pending) {
      p.reject(new Error('RpcChannel disposed'));
    }
    this.pending.clear();
    this.handlers.clear();
    this.eventListeners.clear();
    this.target = null;
  }
}
