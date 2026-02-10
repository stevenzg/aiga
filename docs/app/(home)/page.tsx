import Link from 'next/link';
import {
  Shield,
  Layers,
  Zap,
  Globe,
  MonitorSmartphone,
  ArrowRight,
  Box,
  Radio,
  Route,
  Timer,
} from 'lucide-react';

const sandboxTiers = [
  {
    name: 'none',
    label: 'Direct Mount',
    overhead: '~0 MB',
    desc: 'Zero isolation. For same-team trusted modules that share the host runtime.',
    color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  },
  {
    name: 'light',
    label: 'Shadow DOM + Proxy',
    overhead: '~2-5 MB',
    desc: 'CSS isolation via Shadow DOM, JS leakage prevention via lightweight Proxy.',
    color: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  },
  {
    name: 'strict',
    label: 'Pooled iframe + Bridge',
    overhead: '~15-20 MB',
    desc: 'Full JS isolation in pooled iframes. DOM bridge for overlay & storage namespacing.',
    color: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  },
  {
    name: 'remote',
    label: 'Pure iframe',
    overhead: '~20-30 MB',
    desc: 'Strongest isolation. No bridge, no same-origin access. For untrusted 3rd-party.',
    color: 'bg-red-500/10 text-red-600 border-red-500/20',
  },
];

const features = [
  {
    icon: Shield,
    title: 'Tiered Isolation',
    desc: '4 sandbox levels — choose the right trade-off between isolation, performance, and capability for each sub-app.',
  },
  {
    icon: Zap,
    title: 'Instant Iframe Acquisition',
    desc: 'Pre-warmed iframe pool with LRU eviction delivers ~0ms context creation instead of 50-100ms cold starts.',
  },
  {
    icon: Box,
    title: '<mf-app> Web Component',
    desc: 'One tag works everywhere — React, Vue, Angular, Svelte, or vanilla HTML. No framework lock-in.',
  },
  {
    icon: Radio,
    title: 'Typed RPC Channel',
    desc: 'Promise-based postMessage with auto-serialization, timeout handling, and compile-time type checking.',
  },
  {
    icon: Layers,
    title: 'Overlay Teleportation',
    desc: 'Modals and popovers escape Shadow DOM automatically. Iframe sub-apps use full-viewport promotion.',
  },
  {
    icon: Route,
    title: 'Built-in Router',
    desc: 'URL-based routing with nested routes, dynamic params, guards, and a declarative <mf-router-view>.',
  },
  {
    icon: Timer,
    title: 'Keep-Alive & Prewarming',
    desc: 'LRU keep-alive preserves state across navigations. Smart prewarmer predicts next-page loads.',
  },
  {
    icon: Globe,
    title: 'Service Worker Cache',
    desc: 'Cross-iframe resource caching with configurable strategies: cache-first, network-first, or SWR.',
  },
  {
    icon: MonitorSmartphone,
    title: 'Security by Default',
    desc: 'Cookie/storage namespacing, window.top override, origin-validated postMessage, and CORS detection.',
  },
];

const comparisons = [
  {
    framework: 'qiankun',
    isolation: 'Proxy snapshot',
    overlays: 'Manual',
    typing: 'None',
    weaknesses: 'Snapshot pollution leaks; no iframe pool; manual overlay handling',
  },
  {
    framework: 'micro-app',
    isolation: 'Shadow DOM + Proxy',
    overlays: 'Partial',
    typing: 'None',
    weaknesses: 'No tiered isolation; limited cross-app communication',
  },
  {
    framework: 'wujie',
    isolation: 'iframe + Proxy',
    overlays: 'iframe promotion',
    typing: 'None',
    weaknesses: 'No iframe pool; all iframes are strict; no keep-alive LRU',
  },
  {
    framework: 'Module Federation',
    isolation: 'None (shared runtime)',
    overlays: 'N/A',
    typing: 'Partial',
    weaknesses: 'Requires Webpack/Vite plugin; no runtime isolation; tight coupling',
  },
  {
    framework: 'Aiga',
    isolation: '4-tier adaptive',
    overlays: 'Auto (teleport + promotion)',
    typing: 'Full TypeScript RPC',
    weaknesses: '—',
  },
];

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent" />
        <div className="mx-auto max-w-6xl px-6 py-24 text-center md:py-36">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            Adaptive Sandbox Architecture
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight md:text-6xl lg:text-7xl">
            Micro-Frontends
            <br />
            <span className="bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              Without Compromise
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground md:text-xl">
            Aiga is a next-generation micro-frontend framework with{' '}
            <strong className="text-foreground">4 adaptive sandbox tiers</strong>,
            a pre-warmed iframe pool, typed RPC, and automatic overlay handling
            &mdash; in one{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono">
              &lt;mf-app&gt;
            </code>{' '}
            tag.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90"
            >
              Get Started <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/comparison"
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-6 py-3 text-sm font-semibold transition hover:bg-accent"
            >
              Why Aiga?
            </Link>
          </div>
          {/* Quick code snippet */}
          <div className="mx-auto mt-12 max-w-lg rounded-xl border bg-card p-4 text-left font-mono text-sm shadow-lg">
            <div className="flex items-center gap-2 pb-3 text-xs text-muted-foreground">
              <span className="h-3 w-3 rounded-full bg-red-400" />
              <span className="h-3 w-3 rounded-full bg-yellow-400" />
              <span className="h-3 w-3 rounded-full bg-green-400" />
              <span className="ml-2">index.html</span>
            </div>
            <pre className="overflow-x-auto text-xs leading-relaxed">
              <code>
                <span className="text-muted-foreground">{'<!-- One tag, any framework -->'}</span>
                {'\n'}
                <span className="text-blue-500">{'<'}</span>
                <span className="text-primary font-semibold">{'mf-app'}</span>
                {'\n  '}
                <span className="text-amber-600">src</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-green-600">{'"https://dashboard.app/"'}</span>
                {'\n  '}
                <span className="text-amber-600">sandbox</span>
                <span className="text-muted-foreground">=</span>
                <span className="text-green-600">{'"strict"'}</span>
                {'\n  '}
                <span className="text-amber-600">keep-alive</span>
                {'\n'}
                <span className="text-blue-500">{'/>'}</span>
              </code>
            </pre>
          </div>
        </div>
      </section>

      {/* Sandbox Tiers */}
      <section className="border-b py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
            Adaptive Sandbox Tiers
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            Choose the right isolation level for each sub-app. Trade off between
            security, performance, and capability &mdash; per sub-app, not globally.
          </p>
          <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {sandboxTiers.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl border p-6 ${tier.color} transition hover:shadow-md`}
              >
                <div className="flex items-center justify-between">
                  <code className="text-sm font-bold">{`"${tier.name}"`}</code>
                  <span className="text-xs font-medium opacity-70">{tier.overhead}</span>
                </div>
                <h3 className="mt-2 font-semibold">{tier.label}</h3>
                <p className="mt-2 text-sm opacity-80">{tier.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-b py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
            Everything You Need
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            A complete platform for micro-frontend architecture &mdash; not just an
            isolation layer.
          </p>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border bg-card p-6 transition hover:shadow-md"
              >
                <f.icon className="h-8 w-8 text-primary" />
                <h3 className="mt-4 font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="border-b py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
            How Aiga Compares
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
            A detailed comparison with existing micro-frontend frameworks.
          </p>
          <div className="mt-12 overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-semibold">Framework</th>
                  <th className="px-4 py-3 text-left font-semibold">Isolation</th>
                  <th className="px-4 py-3 text-left font-semibold">Overlays</th>
                  <th className="px-4 py-3 text-left font-semibold">Typed RPC</th>
                  <th className="px-4 py-3 text-left font-semibold">Key Limitation</th>
                </tr>
              </thead>
              <tbody>
                {comparisons.map((c) => (
                  <tr
                    key={c.framework}
                    className={`border-b ${c.framework === 'Aiga' ? 'bg-primary/5 font-medium' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium">{c.framework}</td>
                    <td className="px-4 py-3">{c.isolation}</td>
                    <td className="px-4 py-3">{c.overlays}</td>
                    <td className="px-4 py-3">{c.typing}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.weaknesses}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 text-center">
            <Link
              href="/docs/comparison"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              Read the full comparison <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* Architecture Diagram */}
      <section className="border-b py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
            Architecture Overview
          </h2>
          <div className="mt-12 rounded-xl border bg-card p-8 font-mono text-xs leading-relaxed md:text-sm">
            <pre className="overflow-x-auto">
{`  Host Application
  ================================================
  |  <mf-app src="..." sandbox="strict">        |
  |  +-----------------------------------------+ |
  |  |  Shadow DOM Container                   | |
  |  |  +-----------------------------------+  | |
  |  |  |  Pooled iframe (from Pool)        |  | |
  |  |  |  +-----------------------------+  |  | |
  |  |  |  | Sub-App Content             |  |  | |
  |  |  |  | - Bridge Script injected    |  |  | |
  |  |  |  | - Storage namespaced        |  |  | |
  |  |  |  | - CSS vars synced           |  |  | |
  |  |  |  +-----------------------------+  |  | |
  |  |  +-----------------------------------+  | |
  |  +-----------------------------------------+ |
  |                                              |
  |  +------------------+  +-----------------+   |
  |  | iframe Pool      |  | RPC Channel     |   |
  |  | - Pre-warmed     |  | - Typed calls   |   |
  |  | - LRU eviction   |  | - Events        |   |
  |  | - Keep-alive     |  | - Timeout       |   |
  |  +------------------+  +-----------------+   |
  |                                              |
  |  +------------------+  +-----------------+   |
  |  | Router           |  | Service Worker  |   |
  |  | - History/Hash   |  | - Cross-iframe  |   |
  |  | - Nested routes  |  | - Cache layers  |   |
  |  | - Guards         |  | - SWR strategy  |   |
  |  +------------------+  +-----------------+   |
  ================================================`}
            </pre>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            Ready to Build?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Get started in minutes. One import, one tag, zero configuration required.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-8 py-3 font-semibold text-primary-foreground shadow-lg shadow-primary/25 transition hover:bg-primary/90"
            >
              Read the Docs <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs/demos"
              className="inline-flex items-center gap-2 rounded-lg border bg-card px-8 py-3 font-semibold transition hover:bg-accent"
            >
              Interactive Demos
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
