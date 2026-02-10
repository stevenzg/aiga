// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"comparison.mdx": () => import("../content/docs/comparison.mdx?collection=docs"), "demo-counter.mdx": () => import("../content/docs/demo-counter.mdx?collection=docs"), "demo-text-sync.mdx": () => import("../content/docs/demo-text-sync.mdx?collection=docs"), "demo-todos.mdx": () => import("../content/docs/demo-todos.mdx?collection=docs"), "demos.mdx": () => import("../content/docs/demos.mdx?collection=docs"), "getting-started.mdx": () => import("../content/docs/getting-started.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "live-demo.mdx": () => import("../content/docs/live-demo.mdx?collection=docs"), "motivation.mdx": () => import("../content/docs/motivation.mdx?collection=docs"), "overlay.mdx": () => import("../content/docs/overlay.mdx?collection=docs"), "router.mdx": () => import("../content/docs/router.mdx?collection=docs"), "rpc.mdx": () => import("../content/docs/rpc.mdx?collection=docs"), "sandbox-tiers.mdx": () => import("../content/docs/sandbox-tiers.mdx?collection=docs"), "test-scenarios.mdx": () => import("../content/docs/test-scenarios.mdx?collection=docs"), }),
};
export default browserCollections;