/**
 * Keep-Alive Manager with Priority-Based LRU Eviction.
 *
 * Tracks sub-applications that are in keep-alive state (unmounted but
 * preserving internal state for fast re-mount). Enforces `maxAlive`
 * limits and uses priority + LRU to decide which apps to evict.
 *
 * Priority levels:
 *  - `high`:   Frequently visited or user-pinned apps — evicted last
 *  - `normal`: Standard apps — default priority
 *  - `low`:    Rarely visited apps — evicted first
 */

export type KeepAlivePriority = 'high' | 'normal' | 'low';

export interface KeepAliveEntry {
  appId: string;
  name: string;
  priority: KeepAlivePriority;
  iframe: HTMLIFrameElement | null;
  lastActiveAt: number;
  visitCount: number;
  keepAliveSince: number;
}

export interface KeepAliveManagerOptions {
  /** Maximum number of apps to keep alive simultaneously. Defaults to 5. */
  maxAlive?: number;
  /**
   * Auto-promote threshold: after this many visits, an app is
   * automatically promoted to `high` priority. Defaults to 3.
   */
  autoPromoteAfter?: number;
  /**
   * Callback invoked when an entry is evicted. Use this to clean up
   * the evicted iframe (e.g., navigate to about:blank and remove).
   */
  onEvict?: (entry: KeepAliveEntry) => void;
}

const PRIORITY_WEIGHT: Record<KeepAlivePriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
};

export class KeepAliveManager {
  private entries = new Map<string, KeepAliveEntry>();
  private maxAlive: number;
  private autoPromoteAfter: number;
  private onEvict: ((entry: KeepAliveEntry) => void) | null;

  constructor(options?: KeepAliveManagerOptions) {
    this.maxAlive = options?.maxAlive ?? 5;
    this.autoPromoteAfter = options?.autoPromoteAfter ?? 3;
    this.onEvict = options?.onEvict ?? null;
  }

  /**
   * Register an app as keep-alive. If the max limit is reached,
   * the lowest-priority, least-recently-used entry is evicted.
   *
   * @returns The evicted app ID, or `null` if no eviction was needed.
   */
  add(
    appId: string,
    name: string,
    iframe: HTMLIFrameElement | null,
    priority: KeepAlivePriority = 'normal',
  ): string | null {
    // If already tracked, update.
    const existing = this.entries.get(appId);
    if (existing) {
      existing.lastActiveAt = Date.now();
      existing.visitCount++;
      existing.keepAliveSince = Date.now();
      existing.iframe = iframe;
      this.maybePromote(existing);
      return null;
    }

    let evictedId: string | null = null;

    // Enforce maxAlive limit.
    if (this.entries.size >= this.maxAlive) {
      evictedId = this.evictOne();
    }

    this.entries.set(appId, {
      appId,
      name,
      priority,
      iframe,
      lastActiveAt: Date.now(),
      visitCount: 1,
      keepAliveSince: Date.now(),
    });

    return evictedId;
  }

  /** Record a visit (mount) for an app, increasing its visit count. */
  recordVisit(appId: string): void {
    const entry = this.entries.get(appId);
    if (entry) {
      entry.lastActiveAt = Date.now();
      entry.visitCount++;
      this.maybePromote(entry);
    }
  }

  /** Remove an app from keep-alive tracking. */
  remove(appId: string): KeepAliveEntry | undefined {
    const entry = this.entries.get(appId);
    this.entries.delete(appId);
    return entry;
  }

  /** Check if an app is in keep-alive state. */
  has(appId: string): boolean {
    return this.entries.has(appId);
  }

  /** Get the keep-alive entry for an app. */
  get(appId: string): KeepAliveEntry | undefined {
    return this.entries.get(appId);
  }

  /** Manually set the priority for an app. */
  setPriority(appId: string, priority: KeepAlivePriority): void {
    const entry = this.entries.get(appId);
    if (entry) {
      entry.priority = priority;
    }
  }

  /** Get all keep-alive entries, sorted by priority (highest first). */
  list(): KeepAliveEntry[] {
    return [...this.entries.values()].sort(
      (a, b) => PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority],
    );
  }

  /** Number of apps currently in keep-alive state. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Evict the lowest-priority, least-recently-used entry.
   * Calls the onEvict callback to clean up the evicted iframe.
   * @returns The evicted app ID, or `null` if empty.
   */
  private evictOne(): string | null {
    if (this.entries.size === 0) return null;

    // Sort by priority (ascending), then by lastActiveAt (ascending = oldest first).
    const sorted = [...this.entries.values()].sort((a, b) => {
      const pDiff = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.lastActiveAt - b.lastActiveAt;
    });

    const victim = sorted[0];
    this.entries.delete(victim.appId);

    // Clean up the evicted iframe via callback.
    if (this.onEvict) {
      try {
        this.onEvict(victim);
      } catch (err) {
        console.error('[aiga] Error in keep-alive eviction callback:', err);
      }
    } else {
      // Default cleanup: destroy the iframe if present.
      this.destroyIframe(victim.iframe);
    }

    return victim.appId;
  }

  /** Auto-promote apps that have been visited enough times. */
  private maybePromote(entry: KeepAliveEntry): void {
    if (
      entry.priority === 'normal' &&
      entry.visitCount >= this.autoPromoteAfter
    ) {
      entry.priority = 'high';
    }
  }

  /** Destroy an iframe element (navigate to blank, remove from DOM). */
  private destroyIframe(iframe: HTMLIFrameElement | null): void {
    if (!iframe) return;
    try {
      iframe.src = 'about:blank';
      iframe.remove();
    } catch {
      // noop — iframe may already be detached.
    }
  }

  /** Dispose all entries and clean up their iframes. */
  dispose(): void {
    for (const entry of this.entries.values()) {
      this.destroyIframe(entry.iframe);
    }
    this.entries.clear();
  }
}
