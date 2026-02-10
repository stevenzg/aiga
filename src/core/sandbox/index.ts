export type { SandboxAdapter } from './adapter.js';
export { NoneSandbox } from './none.js';
export { LightSandbox } from './light.js';
export { StrictSandbox } from './strict.js';
export { RemoteSandbox } from './remote.js';
export { createScopedProxy } from './proxy-window.js';
export { setupDomBridge, getBridgeScript } from './dom-bridge.js';
