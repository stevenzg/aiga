import type { IframePoolOptions } from '../types.js';

interface PooledIframe {
  el: HTMLIFrameElement;
  inUse: boolean;
  appId: string | null;
  createdAt: number;
  lastUsedAt: number;
}

const DEFAULT_OPTIONS: Required<IframePoolOptions> = {
  initialSize: 3,
  maxSize: 10,
  maxAlive: 5,
};

/**
 * iframe Pool with LRU eviction.
 *
 * Pre-creates hidden iframes at startup so that acquiring a new sandbox
 * context is near-instantaneous (~0 ms) instead of paying the 50-100 ms
 * cost of creating a fresh browsing context on demand.
 */
export class IframePool {
  private pool: PooledIframe[] = [];
  private opts: Required<IframePoolOptions>;
  private hostEl: HTMLElement;
  private disposed = false;

  constructor(options?: IframePoolOptions) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.hostEl = document.createElement('div');
    this.hostEl.setAttribute('data-aiga-pool', '');
    this.hostEl.style.cssText =
      'position:fixed;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;z-index:-1;';
    document.body.appendChild(this.hostEl);
    this.prewarm(this.opts.initialSize);
  }

  /** Pre-create `count` blank iframes in the background. */
  private prewarm(count: number): void {
    for (let i = 0; i < count; i++) {
      if (this.pool.length >= this.opts.maxSize) break;
      this.pool.push(this.createPooledIframe());
    }
  }

  private createPooledIframe(): PooledIframe {
    const el = document.createElement('iframe');
    el.src = 'about:blank';
    el.setAttribute('data-aiga-pooled', '');
    el.style.cssText = 'border:none;width:100%;height:100%;display:block;';
    // Security: restrict capabilities by default; adapters can override.
    el.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    this.hostEl.appendChild(el);

    return {
      el,
      inUse: false,
      appId: null,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };
  }

  /**
   * Acquire an iframe from the pool.
   * If no idle iframe is available and the pool is at capacity, the
   * least-recently-used idle iframe is recycled.
   */
  acquire(appId: string): HTMLIFrameElement {
    if (this.disposed) throw new Error('IframePool has been disposed');

    // Look for an idle (not in-use) iframe.
    let entry = this.pool.find((p) => !p.inUse);

    if (!entry) {
      if (this.pool.length < this.opts.maxSize) {
        entry = this.createPooledIframe();
        this.pool.push(entry);
      } else {
        // LRU eviction: recycle the oldest idle iframe.
        entry = this.evictLRU();
        if (!entry) {
          // All at capacity and in use — force-create (exceeds max temporarily).
          entry = this.createPooledIframe();
          this.pool.push(entry);
        }
      }
    }

    entry.inUse = true;
    entry.appId = appId;
    entry.lastUsedAt = Date.now();

    // Detach from hidden host so the adapter can place it wherever needed.
    if (entry.el.parentElement === this.hostEl) {
      this.hostEl.removeChild(entry.el);
    }

    return entry.el;
  }

  /** Return an iframe to the pool for reuse. */
  release(el: HTMLIFrameElement): void {
    const entry = this.pool.find((p) => p.el === el);
    if (!entry) return;

    entry.inUse = false;
    entry.appId = null;
    entry.lastUsedAt = Date.now();

    // Reset the iframe.
    this.resetIframe(entry);

    // Move it back to the hidden host.
    if (el.parentElement !== this.hostEl) {
      el.remove();
      this.hostEl.appendChild(el);
    }

    // Replenish pool if we're below initial size.
    this.replenish();
  }

  /** Permanently remove an iframe from the pool. */
  remove(el: HTMLIFrameElement): void {
    const idx = this.pool.findIndex((p) => p.el === el);
    if (idx === -1) return;
    this.destroyEntry(this.pool[idx]);
    this.pool.splice(idx, 1);
    this.replenish();
  }

  /** Evict the least-recently-used idle iframe. */
  private evictLRU(): PooledIframe | undefined {
    const idle = this.pool
      .filter((p) => !p.inUse)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    return idle[0];
  }

  /** Replenish pool to initial size during idle time. */
  private replenish(): void {
    const idleCount = this.pool.filter((p) => !p.inUse).length;
    const deficit = this.opts.initialSize - idleCount;
    if (deficit > 0) {
      // Use requestIdleCallback if available, else setTimeout.
      const schedule =
        typeof requestIdleCallback !== 'undefined'
          ? requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 50);
      schedule(() => {
        if (this.disposed) return;
        this.prewarm(deficit);
      });
    }
  }

  /** Reset an iframe to blank state. */
  private resetIframe(entry: PooledIframe): void {
    try {
      entry.el.src = 'about:blank';
      entry.el.removeAttribute('name');
    } catch {
      // Cross-origin access may throw; safe to ignore.
    }
  }

  private destroyEntry(entry: PooledIframe): void {
    try {
      entry.el.src = 'about:blank';
      entry.el.remove();
    } catch {
      // noop
    }
  }

  /** Get pool statistics for debugging / DevTools. */
  stats(): { total: number; inUse: number; idle: number } {
    const inUse = this.pool.filter((p) => p.inUse).length;
    return {
      total: this.pool.length,
      inUse,
      idle: this.pool.length - inUse,
    };
  }

  /** Destroy the entire pool and release all resources. */
  dispose(): void {
    this.disposed = true;
    for (const entry of this.pool) {
      this.destroyEntry(entry);
    }
    this.pool = [];
    this.hostEl.remove();
  }
}
