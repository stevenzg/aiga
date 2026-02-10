# Aiga

**Next-generation micro-frontend framework with adaptive sandbox architecture and tiered isolation.**

One tag. Any framework. Four isolation levels.

```html
<aiga-app src="https://dashboard.app/" sandbox="strict" keep-alive />
```

## Why Aiga?

Existing micro-frontend frameworks force a single isolation strategy for all sub-apps. Aiga introduces **Adaptive Sandbox Architecture** — 4 tiers so you choose the right trade-off per sub-app:

| Tier | Mechanism | Overhead | Use Case |
|------|-----------|----------|----------|
| `none` | Direct mount | ~0 MB | Same-team trusted modules |
| `light` | Shadow DOM + Proxy | ~2-5 MB | Internal apps needing CSS isolation |
| `strict` | Pooled iframe + Bridge | ~15-20 MB | Cross-team / third-party apps |
| `remote` | Pure iframe (opaque origin) | ~20-30 MB | Fully untrusted content |

## Features

- **`<aiga-app>` Web Component** — Works in React, Vue, Angular, Svelte, or vanilla HTML
- **Pre-warmed iframe Pool** — ~0ms acquisition with LRU eviction (vs. 50-100ms cold start)
- **Typed RPC Channel** — Promise-based postMessage with timeout, origin validation, and type safety
- **Overlay Teleportation** — Modals escape Shadow DOM automatically; iframe sub-apps use full-viewport promotion
- **Built-in Router** — History/hash modes, nested routes, dynamic params, guards, `<aiga-view>`
- **Keep-Alive & Prewarming** — LRU keep-alive preserves state; smart prewarmer predicts next-page loads
- **Security by Default** — Cookie/storage namespacing, `window.top` override, origin-validated messaging, CORS detection
- **Service Worker Cache** — Cross-iframe resource caching with cache-first, network-first, or SWR strategies

## Quick Start

```bash
npm install aiga
```

```ts
import { initAiga } from 'aiga';

const aiga = initAiga({
  defaultSandbox: 'strict',
  pool: { initialSize: 3, maxSize: 10 },
});
```

```html
<!-- Strict isolation with keep-alive -->
<aiga-app src="https://dashboard.app/" sandbox="strict" keep-alive />

<!-- Light isolation for internal apps -->
<aiga-app src="https://settings.internal/" sandbox="light" />

<!-- No isolation for trusted modules -->
<aiga-app src="/modules/header.html" sandbox="none" />
```

## Routing

```ts
import { Router } from 'aiga';

const router = new Router({
  mode: 'history',
  routes: [
    { path: '/dashboard', app: { src: 'https://dashboard.app/', sandbox: 'strict' } },
    { path: '/settings', app: { src: 'https://settings.app/', sandbox: 'light' } },
    { path: '/users/:id', app: { src: 'https://users.app/', sandbox: 'strict' } },
  ],
  notFound: { src: '/404.html' },
});

const view = document.querySelector('aiga-view');
view.router = router;
```

## RPC Communication

```ts
// Host → Sub-app
const result = await rpc.call('getSettings', 'theme');

// Sub-app exposes methods
rpc.expose('getSettings', (key) => settings[key]);

// Reactive props
app.props = { userId: 42, theme: 'dark' };
```

## Comparison

| Feature | qiankun | micro-app | wujie | Module Federation | **Aiga** |
|---------|---------|-----------|-------|-------------------|----------|
| Isolation | Proxy snapshot | Shadow DOM + Proxy | iframe + Proxy | None | **4-tier adaptive** |
| Overlay Handling | Manual | Partial | iframe promotion | N/A | **Auto teleport + promotion** |
| iframe Pool | No | No | No | N/A | **Yes (pre-warmed, LRU)** |
| Typed RPC | No | No | No | Partial | **Full TypeScript** |
| Cookie Isolation | No | No | No | No | **Per-app namespace** |
| Keep-Alive | Limited | Limited | Memory-based | N/A | **LRU with priority** |

## Architecture

```
Host Application
├── <aiga-app> Web Component     ← Unified entry point
├── Sandbox Adapters           ← none / light / strict / remote
├── iframe Pool                ← Pre-warmed + LRU eviction
├── RPC Channel                ← Typed postMessage
├── Overlay Layer              ← Teleportation + iframe promotion
├── Router                     ← History/hash, nested, guards
└── Service Worker             ← Cross-iframe cache
```

## Documentation

```bash
cd docs && npm install && npm run dev
```

Visit `http://localhost:3000` for the full documentation site with interactive demos.

### Docs Include:
- [Why Aiga was built](/docs/motivation) — The 4 trade-offs existing frameworks force
- [Comparison with alternatives](/docs/comparison) — vs. qiankun, micro-app, wujie, Module Federation, single-spa
- [Getting Started](/docs/getting-started) — Install and use in 5 minutes
- [Sandbox Tiers](/docs/sandbox-tiers) — Deep dive into all 4 isolation levels
- [RPC Channel](/docs/rpc) — Typed cross-app communication
- [Router](/docs/router) — Nested routes, guards, hash mode
- [Overlay Handling](/docs/overlay) — Teleportation vs. iframe promotion
- [Test Scenarios](/docs/test-scenarios) — 91 test cases across 12 categories
- [Interactive Demos](/docs/demos) — Try every feature hands-on

## Project Structure

```
src/
├── index.ts                    # Public API + initAiga()
├── aiga-app.ts                 # <aiga-app> Web Component
├── core/
│   ├── aiga.ts                 # Singleton framework instance
│   ├── types.ts                # Core type definitions
│   ├── sandbox/
│   │   ├── adapter.ts          # SandboxAdapter interface
│   │   ├── none.ts             # Direct mount (no isolation)
│   │   ├── light.ts            # Shadow DOM + Proxy
│   │   ├── strict.ts           # Pooled iframe + Bridge
│   │   ├── remote.ts           # Pure iframe
│   │   ├── proxy-window.ts     # Window/document Proxy for light sandbox
│   │   └── dom-bridge.ts       # Bridge script for strict sandbox
│   ├── iframe-pool/
│   │   ├── pool.ts             # iframe pool with LRU
│   │   ├── keep-alive-manager.ts
│   │   └── prewarmer.ts
│   ├── rpc/
│   │   ├── channel.ts          # Typed RPC over postMessage
│   │   ├── proxy.ts            # RPC proxy helpers
│   │   └── types.ts
│   ├── overlay/
│   │   └── overlay-layer.ts    # Overlay detection + teleportation
│   └── router/
│       ├── router.ts           # URL-based router
│       └── router-view.ts      # <aiga-view> component
├── sw/
│   ├── worker.ts               # Service Worker (separate build)
│   └── register.ts             # SW registration helper
docs/                           # Fumadocs documentation site
examples/basic/                 # Example app
```

## Development

```bash
# Install dependencies
npm install

# Build the library
npm run build

# Run the example app
cd examples/basic && npm run dev

# Run the docs site
cd docs && npm install && npm run dev
```

## License

MIT
