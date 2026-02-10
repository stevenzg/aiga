'use client';

import { useState } from 'react';

/* ---------- shared styles ---------- */
const card =
  'rounded-xl border bg-card p-6 shadow-sm';
const codeBlock =
  'rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed overflow-x-auto whitespace-pre';
const btn =
  'rounded-lg px-4 py-2 text-sm font-medium transition cursor-pointer';
const btnPrimary = `${btn} bg-primary text-primary-foreground hover:bg-primary/90`;
const btnOutline = `${btn} border hover:bg-accent`;
const tag =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium';

/* ====================================================================
 * SandboxDemo — interactive tier comparison
 * ==================================================================== */
export function SandboxDemo() {
  const [activeTab, setActiveTab] = useState<string>('none');

  const tiers: Record<
    string,
    { label: string; color: string; features: string[]; code: string; overhead: string }
  > = {
    none: {
      label: 'Direct Mount',
      color: 'text-emerald-600',
      overhead: '~0 MB',
      features: [
        'No isolation — shares host window/document',
        'Fetches HTML, parses via DOMParser (XSS-safe)',
        'Scripts run in host context',
        'Error boundary catches uncaught errors',
        'CORS detection with friendly error messages',
      ],
      code: `<!-- Trusted internal module, no overhead -->
<aiga-app
  src="https://header.internal/"
  sandbox="none"
/>`,
    },
    light: {
      label: 'Shadow DOM + Proxy',
      color: 'text-blue-600',
      overhead: '~2-5 MB',
      features: [
        'Shadow DOM for CSS isolation',
        'Proxy on window traps global writes',
        'Timer tracking (setTimeout/setInterval/rAF) for cleanup',
        'document.title & document.cookie scoped per app',
        'CSS variables synced reactively from host',
        'Overlay detection via MutationObserver',
      ],
      code: `<!-- Internal app with CSS isolation -->
<aiga-app
  src="https://settings.internal/"
  sandbox="light"
  keep-alive
/>`,
    },
    strict: {
      label: 'Pooled iframe + Bridge',
      color: 'text-amber-600',
      overhead: '~15-20 MB',
      features: [
        'Full JS isolation in a pooled iframe (~0ms acquire)',
        'Bridge script: window.top/parent override',
        'localStorage/sessionStorage/cookie namespaced per app',
        'CSS variables synced via postMessage',
        'Overlay detection with iframe promotion (full viewport)',
        'Auto-resize via ResizeObserver + postMessage fallback',
      ],
      code: `<!-- Third-party widget, full isolation -->
<aiga-app
  src="https://dashboard.partner.com/"
  sandbox="strict"
  keep-alive
/>`,
    },
    remote: {
      label: 'Pure iframe',
      color: 'text-red-600',
      overhead: '~20-30 MB',
      features: [
        'Strongest isolation — opaque origin (no same-origin)',
        'No bridge injection, no script access',
        'Communication limited to postMessage + RPC',
        'Lazy loading attribute for deferred load',
        'Auto-resize for same-origin, message-based for cross',
      ],
      code: `<!-- Fully untrusted third-party -->
<aiga-app
  src="https://external-widget.com/"
  sandbox="remote"
/>`,
    },
  };

  const tier = tiers[activeTab];

  return (
    <div className={card}>
      <h3 className="text-lg font-semibold mb-4">Interactive Sandbox Tier Explorer</h3>
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(tiers).map(([key, t]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`${btn} ${
              activeTab === key
                ? 'bg-primary text-primary-foreground'
                : 'border hover:bg-accent'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Features */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <span className={`text-xl font-bold ${tier.color}`}>{tier.label}</span>
            <span className={`${tag} bg-muted`}>{tier.overhead}</span>
          </div>
          <ul className="space-y-2">
            {tier.features.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Code */}
        <div>
          <p className="text-xs text-muted-foreground mb-2">Usage:</p>
          <div className={codeBlock}>{tier.code}</div>
        </div>
      </div>

      {/* Isolation matrix */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Capability</th>
              <th className="py-2 text-center font-medium">none</th>
              <th className="py-2 text-center font-medium">light</th>
              <th className="py-2 text-center font-medium">strict</th>
              <th className="py-2 text-center font-medium">remote</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['CSS Isolation', false, true, true, true],
              ['JS Isolation', false, 'partial', true, true],
              ['Storage Isolation', false, false, true, true],
              ['Cookie Isolation', false, true, true, true],
              ['Overlay Support', false, true, true, false],
              ['iframe Pool', false, false, true, false],
              ['Keep-Alive', true, true, true, true],
              ['RPC Channel', false, false, true, true],
            ].map(([label, ...vals]) => (
              <tr key={label as string} className="border-b">
                <td className="py-1.5 font-medium">{label as string}</td>
                {vals.map((v, i) => (
                  <td key={i} className="py-1.5 text-center">
                    {v === true ? (
                      <span className="text-emerald-600">&#10003;</span>
                    ) : v === false ? (
                      <span className="text-muted-foreground">&#10007;</span>
                    ) : (
                      <span className="text-amber-600">~</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ====================================================================
 * RpcDemo — RPC channel demonstration
 * ==================================================================== */
export function RpcDemo() {
  const [logs, setLogs] = useState<string[]>([]);
  const [method, setMethod] = useState('greet');
  const [arg, setArg] = useState('World');

  const simulate = () => {
    const id = `rpc_${Date.now().toString(36)}`;
    setLogs((prev) => [
      ...prev,
      `>> call("${method}", "${arg}")  [id: ${id}]`,
      `<< postMessage({ __aiga_rpc: true, type: "call", method: "${method}", args: ["${arg}"], id: "${id}" })`,
      `   target: iframe.contentWindow`,
      `   origin: "https://sub-app.example.com"`,
      `>> received result  [id: ${id}]`,
      `<< result: "Hello, ${arg}!" (${Math.floor(Math.random() * 15 + 2)}ms)`,
      '',
    ]);
  };

  const simulateTimeout = () => {
    const id = `rpc_${Date.now().toString(36)}`;
    setLogs((prev) => [
      ...prev,
      `>> call("slowMethod")  [id: ${id}]`,
      `<< postMessage sent...`,
      `   waiting for response...`,
      `!! Error: RPC call "slowMethod" timed out (10000ms)`,
      `   pending map cleaned up for id: ${id}`,
      '',
    ]);
  };

  return (
    <div className={card}>
      <h3 className="text-lg font-semibold mb-4">RPC Channel Simulator</h3>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground mb-3">
            Simulate typed RPC calls between host and sub-app:
          </p>

          <div className="flex gap-2 mb-3">
            <input
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm flex-1"
              placeholder="Method name"
            />
            <input
              value={arg}
              onChange={(e) => setArg(e.target.value)}
              className="rounded-lg border bg-background px-3 py-2 text-sm flex-1"
              placeholder="Argument"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={simulate} className={btnPrimary}>
              Call Method
            </button>
            <button onClick={simulateTimeout} className={btnOutline}>
              Simulate Timeout
            </button>
            <button
              onClick={() => setLogs([])}
              className={`${btn} text-muted-foreground hover:text-foreground`}
            >
              Clear
            </button>
          </div>

          <div className={`${codeBlock} mt-4`}>
            {`// Host code
const rpc = RpcChannel.forApp(
  iframe.contentWindow,
  "https://sub-app.example.com",
  10_000  // timeout
);

const result = await rpc.call("${method}", "${arg}");

// Sub-app code
rpc.expose("${method}", (name) => {
  return \`Hello, \${name}!\`;
});`}
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Message Log:</p>
          <div className="rounded-lg bg-zinc-950 text-zinc-300 p-4 font-mono text-xs h-80 overflow-y-auto">
            {logs.length === 0 ? (
              <span className="text-zinc-600">Click &quot;Call Method&quot; to start...</span>
            ) : (
              logs.map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith('!!')
                      ? 'text-red-400'
                      : line.startsWith('>>')
                        ? 'text-blue-400'
                        : line.startsWith('<<')
                          ? 'text-emerald-400'
                          : 'text-zinc-500'
                  }
                >
                  {line || '\u00A0'}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
 * RouterDemo — interactive route matching
 * ==================================================================== */
export function RouterDemo() {
  const [url, setUrl] = useState('/dashboard');
  const [mode, setMode] = useState<'history' | 'hash'>('history');

  const routes = [
    { path: '/dashboard', app: 'dashboard-app', sandbox: 'strict' },
    { path: '/settings', app: 'settings-app', sandbox: 'light' },
    { path: '/users/:id', app: 'user-profile-app', sandbox: 'strict' },
    { path: '/admin', children: [
      { path: '/users', app: 'admin-users-app', sandbox: 'strict' },
      { path: '/config', app: 'admin-config-app', sandbox: 'light' },
    ]},
  ];

  const matchRoute = (path: string): { matched: string; params: Record<string, string>; sandbox: string } | null => {
    const [pathOnly] = path.split('?');
    const parts = pathOnly.split('/').filter(Boolean);

    for (const r of routes) {
      if ('children' in r && r.children) {
        const parentParts = r.path.split('/').filter(Boolean);
        if (parts.length >= parentParts.length) {
          let match = true;
          for (let i = 0; i < parentParts.length; i++) {
            if (parentParts[i] !== parts[i]) { match = false; break; }
          }
          if (match) {
            const remainder = '/' + parts.slice(parentParts.length).join('/');
            for (const child of r.children) {
              const childParts = child.path.split('/').filter(Boolean);
              const remParts = remainder.split('/').filter(Boolean);
              if (childParts.length === remParts.length) {
                let childMatch = true;
                for (let i = 0; i < childParts.length; i++) {
                  if (childParts[i] !== remParts[i]) { childMatch = false; break; }
                }
                if (childMatch) return { matched: child.app, params: {}, sandbox: child.sandbox };
              }
            }
          }
        }
        continue;
      }
      const routeParts = r.path.split('/').filter(Boolean);
      if (routeParts.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let match = true;
      for (let i = 0; i < routeParts.length; i++) {
        if (routeParts[i].startsWith(':')) {
          params[routeParts[i].slice(1)] = parts[i];
        } else if (routeParts[i] !== parts[i]) {
          match = false; break;
        }
      }
      if (match) return { matched: (r as { app: string }).app, params, sandbox: (r as { sandbox: string }).sandbox };
    }
    return null;
  };

  const result = matchRoute(url);

  return (
    <div className={card}>
      <h3 className="text-lg font-semibold mb-4">Router Playground</h3>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setMode('history')}
              className={mode === 'history' ? btnPrimary : btnOutline}
            >
              History Mode
            </button>
            <button
              onClick={() => setMode('hash')}
              className={mode === 'hash' ? btnPrimary : btnOutline}
            >
              Hash Mode
            </button>
          </div>

          <div className="mb-4">
            <label className="text-sm text-muted-foreground mb-1 block">Enter URL path:</label>
            <div className="flex items-center gap-0 rounded-lg border overflow-hidden">
              <span className="bg-muted px-3 py-2 text-xs text-muted-foreground shrink-0">
                {mode === 'hash' ? 'example.com/#' : 'example.com'}
              </span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="bg-background px-3 py-2 text-sm flex-1 outline-none"
                placeholder="/path"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {['/dashboard', '/settings', '/users/42', '/admin/users', '/admin/config', '/unknown'].map((p) => (
              <button key={p} onClick={() => setUrl(p)} className={`${btn} text-xs border`}>
                {p}
              </button>
            ))}
          </div>

          <div className={`rounded-lg border p-4 ${result ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
            {result ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-emerald-600 font-bold text-sm">Matched!</span>
                  <span className={`${tag} bg-muted`}>{result.sandbox}</span>
                </div>
                <p className="text-sm"><strong>App:</strong> {result.matched}</p>
                {Object.keys(result.params).length > 0 && (
                  <p className="text-sm"><strong>Params:</strong> {JSON.stringify(result.params)}</p>
                )}
              </>
            ) : (
              <div>
                <span className="text-red-600 font-bold text-sm">404 — No match</span>
                <p className="text-xs text-muted-foreground mt-1">
                  Would render the notFound config if provided.
                </p>
              </div>
            )}
          </div>
        </div>

        <div>
          <p className="text-xs text-muted-foreground mb-2">Route Configuration:</p>
          <div className={codeBlock}>
{`const router = new Router({
  mode: '${mode}',
  routes: [
    {
      path: '/dashboard',
      app: { src: '...', sandbox: 'strict' }
    },
    {
      path: '/settings',
      app: { src: '...', sandbox: 'light' }
    },
    {
      path: '/users/:id',
      app: { src: '...', sandbox: 'strict' }
    },
    {
      path: '/admin',
      children: [
        { path: '/users', app: { src: '...' } },
        { path: '/config', app: { src: '...' } },
      ]
    },
  ],
  notFound: { src: '/404.html' },
});`}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ====================================================================
 * OverlayDemo — overlay handling visualization
 * ==================================================================== */
export function OverlayDemo() {
  const [scenario, setScenario] = useState<'light' | 'strict'>('light');
  const [showOverlay, setShowOverlay] = useState(false);

  return (
    <div className={card}>
      <h3 className="text-lg font-semibold mb-4">Overlay Handling Demo</h3>

      <div className="flex gap-2 mb-6">
        <button
          onClick={() => { setScenario('light'); setShowOverlay(false); }}
          className={scenario === 'light' ? btnPrimary : btnOutline}
        >
          Light Sandbox (Teleport)
        </button>
        <button
          onClick={() => { setScenario('strict'); setShowOverlay(false); }}
          className={scenario === 'strict' ? btnPrimary : btnOutline}
        >
          Strict Sandbox (Promotion)
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="text-sm text-muted-foreground mb-4">
            {scenario === 'light'
              ? 'In light mode, overlays are detected via MutationObserver and teleported outside Shadow DOM to an overlay layer at the top of the document.'
              : 'In strict mode, overlays inside the iframe are detected by the bridge script. The iframe is promoted to full-viewport mode for correct rendering.'}
          </p>

          <button
            onClick={() => setShowOverlay(!showOverlay)}
            className={showOverlay ? `${btn} bg-red-500 text-white hover:bg-red-600` : btnPrimary}
          >
            {showOverlay ? 'Dismiss Overlay' : 'Show Overlay'}
          </button>

          <div className="mt-4 text-xs text-muted-foreground">
            <p className="font-medium mb-1">Detection signals (OV-13):</p>
            <ul className="space-y-1 ml-3">
              <li>role=&quot;dialog&quot; / role=&quot;tooltip&quot; / role=&quot;alertdialog&quot;</li>
              <li>Class: modal, overlay, popup, popover, drawer, dialog...</li>
              <li>position:fixed + z-index &gt; 1000</li>
              <li>Attribute changes watched: class, role, style</li>
            </ul>
          </div>
        </div>

        {/* Visual diagram */}
        <div className="relative rounded-lg border bg-muted/30 p-4 min-h-[280px]">
          <p className="text-xs text-muted-foreground mb-2">
            {scenario === 'light' ? 'Shadow DOM Container' : 'Host Document'}
          </p>

          {/* Sub-app area */}
          <div className={`rounded-lg border-2 border-dashed p-3 ${scenario === 'strict' && showOverlay ? 'border-amber-500 bg-amber-500/5' : 'border-muted-foreground/30'} transition-all`}>
            <p className="text-xs font-medium mb-1">
              {scenario === 'light' ? 'Shadow DOM' : 'iframe'}
              {scenario === 'strict' && showOverlay && (
                <span className="ml-2 text-amber-600 font-bold">PROMOTED</span>
              )}
            </p>
            <div className="rounded bg-background border p-2 text-xs">
              Sub-app content: buttons, forms, etc.
            </div>
            {/* Overlay inside sub-app */}
            {showOverlay && scenario === 'strict' && (
              <div className="mt-2 rounded bg-zinc-900 text-white p-3 text-xs border border-zinc-700 shadow-xl">
                <p className="font-bold mb-1">Modal Dialog</p>
                <p className="text-zinc-400">
                  This renders inside the promoted iframe — full viewport, full interactivity.
                </p>
              </div>
            )}
          </div>

          {/* Teleported overlay (light mode) */}
          {showOverlay && scenario === 'light' && (
            <div className="absolute inset-x-4 bottom-4 rounded-lg bg-zinc-900 text-white p-4 text-xs border border-zinc-700 shadow-2xl">
              <p className="font-bold mb-1">Teleported Modal</p>
              <p className="text-zinc-400">
                Moved from Shadow DOM to top-level overlay layer. z-index works correctly across shadow boundaries.
              </p>
              <div className="mt-2 flex items-center gap-1 text-zinc-500">
                <span>&#8593;</span> data-aiga-overlay-item
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
