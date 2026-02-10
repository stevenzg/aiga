'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AppStatus = 'idle' | 'loading' | 'mounting' | 'mounted' | 'error';

interface AppDef {
  name: string;
  label: string;
  src: string;
  sandbox: string;
}

interface RelayDef {
  from: string;
  to: string;
}

const statusColor: Record<AppStatus, string> = {
  idle: 'bg-zinc-400',
  loading: 'bg-yellow-400 animate-pulse',
  mounting: 'bg-yellow-400 animate-pulse',
  mounted: 'bg-emerald-400',
  error: 'bg-red-400',
};

/* ------------------------------------------------------------------ */
/*  Shared Aiga initialization hook                                    */
/* ------------------------------------------------------------------ */

let aigaPromise: Promise<unknown> | null = null;

function useAiga() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!aigaPromise) {
      aigaPromise = import('../../dist/aiga.js').then(({ initAiga }) => {
        initAiga({ defaultSandbox: 'strict', pool: { initialSize: 3, maxSize: 10 } });
      });
    }
    aigaPromise
      .then(() => setReady(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return { ready, error };
}

/* ------------------------------------------------------------------ */
/*  AigaShell — wrapper with loading/error states                      */
/* ------------------------------------------------------------------ */

function AigaShell({ children }: { children: React.ReactNode }) {
  const { ready, error } = useAiga();

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-6 text-sm text-red-600">
        Failed to initialize Aiga: {error}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
        <div className="mx-auto mb-3 h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        Initializing Aiga framework...
      </div>
    );
  }

  return <>{children}</>;
}

/* ------------------------------------------------------------------ */
/*  ScenarioPair — two apps side by side with RPC relay                */
/* ------------------------------------------------------------------ */

function ScenarioPair({
  left,
  right,
  relay,
}: {
  left: AppDef;
  right: AppDef;
  relay: RelayDef;
}) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({});

  const onStatus = useCallback((name: string, status: AppStatus) => {
    setStatuses((prev) => ({ ...prev, [name]: status }));
  }, []);

  useEffect(() => {
    const leftEl = leftRef.current?.querySelector('aiga-app') as HTMLElement | null;
    const rightEl = rightRef.current?.querySelector('aiga-app') as HTMLElement | null;
    if (!leftEl || !rightEl) return;

    let leftRpc: { on: (e: string, h: (d: unknown) => void) => () => void } | null = null;
    let rightRpc: { emit: (e: string, d: unknown) => void } | null = null;
    let unsub: (() => void) | null = null;

    function tryRelay() {
      leftRpc = (leftEl as unknown as { rpcChannel: typeof leftRpc }).rpcChannel;
      rightRpc = (rightEl as unknown as { rpcChannel: typeof rightRpc }).rpcChannel;
      if (leftRpc && rightRpc) {
        unsub = leftRpc.on(relay.from, (data) => {
          rightRpc!.emit(relay.to, data as Record<string, never>);
        });
      }
    }

    const onReady = () => tryRelay();
    leftEl.addEventListener('rpc-ready', onReady);
    rightEl.addEventListener('rpc-ready', onReady);
    tryRelay();

    return () => {
      leftEl.removeEventListener('rpc-ready', onReady);
      rightEl.removeEventListener('rpc-ready', onReady);
      unsub?.();
    };
  }, [relay]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AppCard
        containerRef={leftRef}
        app={left}
        status={statuses[left.name] ?? 'idle'}
        onStatusChange={onStatus}
      />
      <AppCard
        containerRef={rightRef}
        app={right}
        status={statuses[right.name] ?? 'idle'}
        onStatusChange={onStatus}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AppCard                                                            */
/* ------------------------------------------------------------------ */

function AppCard({
  containerRef,
  app,
  status,
  onStatusChange,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  app: AppDef;
  status: AppStatus;
  onStatusChange: (name: string, status: AppStatus) => void;
}) {
  useEffect(() => {
    const el = containerRef.current?.querySelector('aiga-app');
    if (!el) return;
    const handler = (e: Event) => {
      onStatusChange(app.name, (e as CustomEvent).detail.status);
    };
    el.addEventListener('status-change', handler);
    return () => el.removeEventListener('status-change', handler);
  }, [app.name, onStatusChange, containerRef]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor[status]}`} />
          <span className="text-sm font-semibold">{app.label}</span>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          {app.sandbox}
        </span>
      </div>
      <div ref={containerRef} style={{ height: '420px' }}>
        {/* @ts-expect-error -- aiga-app is a custom element */}
        <aiga-app
          name={app.name}
          src={app.src}
          sandbox={app.sandbox}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SingleAppCard — standalone app card without RPC relay              */
/* ------------------------------------------------------------------ */

function SingleAppCard({ app }: { app: AppDef }) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<AppStatus>('idle');

  useEffect(() => {
    const el = ref.current?.querySelector('aiga-app');
    if (!el) return;
    const handler = (e: Event) => setStatus((e as CustomEvent).detail.status);
    el.addEventListener('status-change', handler);
    return () => el.removeEventListener('status-change', handler);
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${statusColor[status]}`} />
          <span className="text-sm font-semibold">{app.label}</span>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
          {app.sandbox}
        </span>
      </div>
      <div ref={ref} style={{ height: '420px' }}>
        {/* @ts-expect-error -- aiga-app is a custom element */}
        <aiga-app
          name={app.name}
          src={app.src}
          sandbox={app.sandbox}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Exported demo components — one per page                            */
/* ================================================================== */

/** Cross-origin demo: Rosetta React + Svelte from Vercel */
export function CrossOriginDemo() {
  return (
    <AigaShell>
      <div className="grid gap-4 lg:grid-cols-2">
        <SingleAppCard
          app={{ name: 'rosetta-react', label: 'Rosetta React', src: 'https://rosetta-react.vercel.app/', sandbox: 'strict' }}
        />
        <SingleAppCard
          app={{ name: 'rosetta-svelte', label: 'Rosetta Svelte', src: 'https://rosetta-svelte.vercel.app/', sandbox: 'strict' }}
        />
      </div>
    </AigaShell>
  );
}

/** Text sync demo: React editor → Svelte preview via RPC */
export function TextSyncDemo() {
  return (
    <AigaShell>
      <ScenarioPair
        left={{ name: 'react-editor', label: 'React Editor', src: '/demos/react-editor.html', sandbox: 'strict' }}
        right={{ name: 'svelte-preview', label: 'Svelte Preview', src: '/demos/svelte-preview.html', sandbox: 'strict' }}
        relay={{ from: 'content-change', to: 'content-update' }}
      />
    </AigaShell>
  );
}

/** Counter demo: React buttons → Svelte display via RPC */
export function CounterDemo() {
  return (
    <AigaShell>
      <ScenarioPair
        left={{ name: 'react-counter', label: 'React Counter', src: '/demos/react-counter.html', sandbox: 'strict' }}
        right={{ name: 'svelte-counter', label: 'Svelte Display', src: '/demos/svelte-counter.html', sandbox: 'strict' }}
        relay={{ from: 'count-change', to: 'count-update' }}
      />
    </AigaShell>
  );
}

/** Todo list demo: React todos → Svelte list via RPC */
export function TodosDemo() {
  return (
    <AigaShell>
      <ScenarioPair
        left={{ name: 'react-todos', label: 'React Todos', src: '/demos/react-todos.html', sandbox: 'strict' }}
        right={{ name: 'svelte-todos', label: 'Svelte List', src: '/demos/svelte-todos.html', sandbox: 'strict' }}
        relay={{ from: 'todos-change', to: 'todos-update' }}
      />
    </AigaShell>
  );
}
