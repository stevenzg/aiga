'use client';

import { useEffect, useState, useRef, useCallback } from 'react';

type AppStatus = 'idle' | 'loading' | 'mounting' | 'mounted' | 'error';

interface AppState {
  name: string;
  label: string;
  src: string;
  sandbox: string;
  status: AppStatus;
}

const apps: Omit<AppState, 'status'>[] = [
  {
    name: 'rosetta-react',
    label: 'Rosetta React',
    src: 'https://rosetta-react.vercel.app/',
    sandbox: 'strict',
  },
  {
    name: 'rosetta-svelte',
    label: 'Rosetta Svelte',
    src: 'https://rosetta-svelte.vercel.app/',
    sandbox: 'strict',
  },
];

const statusColor: Record<AppStatus, string> = {
  idle: 'bg-zinc-400',
  loading: 'bg-yellow-400 animate-pulse',
  mounting: 'bg-yellow-400 animate-pulse',
  mounted: 'bg-emerald-400',
  error: 'bg-red-400',
};

export function LiveDemo() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({});
  const [poolStats, setPoolStats] = useState('– / –');
  const initialized = useRef(false);
  const aigaRef = useRef<{ pool: { stats: () => { idle: number; total: number } } } | null>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    import('../../dist/aiga.js')
      .then(({ initAiga }) => {
        const aiga = initAiga({
          defaultSandbox: 'strict',
          pool: { initialSize: 3, maxSize: 10 },
        });
        aigaRef.current = aiga;
        setReady(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  // Poll pool stats.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => {
      if (aigaRef.current) {
        const s = aigaRef.current.pool.stats();
        setPoolStats(`${s.idle} / ${s.total}`);
      }
    }, 2000);
    return () => clearInterval(id);
  }, [ready]);

  // Status change listener.
  const handleStatusChange = useCallback((appName: string, status: AppStatus) => {
    setStatuses((prev) => ({ ...prev, [appName]: status }));
  }, []);

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

  return (
    <div className="space-y-6">
      {/* App Grid */}
      <div className="grid gap-4 lg:grid-cols-2">
        {apps.map((app) => (
          <AppCard
            key={app.name}
            app={app}
            status={statuses[app.name] ?? 'idle'}
            onStatusChange={handleStatusChange}
          />
        ))}
      </div>

      {/* Info Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="Sandbox Level" value="strict" detail="Pooled iframe + Shadow DOM" color="text-blue-500" />
        <InfoCard label="iframe Pool" value={poolStats} detail="Idle / Total capacity" color="text-violet-500" />
        <InfoCard label="Frameworks" value="2" detail="React + Svelte coexisting" color="text-emerald-500" />
        <InfoCard label="Pool Acquisition" value="~0ms" detail="Pre-warmed, near-instant" color="text-amber-500" />
      </div>

      {/* Source Code */}
      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium hover:bg-accent/50">
          View Source Code
        </summary>
        <pre className="overflow-x-auto border-t px-5 py-4 font-mono text-xs leading-relaxed">
{`import { initAiga } from 'aiga';

// Initialize Aiga framework
const aiga = initAiga({
  defaultSandbox: 'strict',
  pool: { initialSize: 3, maxSize: 10 },
});

// HTML — that's all you need:
<aiga-app
  name="rosetta-react"
  src="https://rosetta-react.vercel.app/"
  sandbox="strict"
/>
<aiga-app
  name="rosetta-svelte"
  src="https://rosetta-svelte.vercel.app/"
  sandbox="strict"
/>`}
        </pre>
      </details>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function AppCard({
  app,
  status,
  onStatusChange,
}: {
  app: Omit<AppState, 'status'>;
  status: AppStatus;
  onStatusChange: (name: string, status: AppStatus) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const aigaApp = container.querySelector('aiga-app');
    if (!aigaApp) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onStatusChange(app.name, detail.status);
    };
    aigaApp.addEventListener('status-change', handler);
    return () => aigaApp.removeEventListener('status-change', handler);
  }, [app.name, onStatusChange]);

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
      <div ref={ref} style={{ height: '70vh', minHeight: '400px', maxHeight: '800px' }}>
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

function InfoCard({
  label,
  value,
  detail,
  color,
}: {
  label: string;
  value: string;
  detail: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}
