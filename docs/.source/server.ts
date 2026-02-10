// @ts-nocheck
import * as __fd_glob_11 from "../content/docs/test-scenarios.mdx?collection=docs"
import * as __fd_glob_10 from "../content/docs/sandbox-tiers.mdx?collection=docs"
import * as __fd_glob_9 from "../content/docs/rpc.mdx?collection=docs"
import * as __fd_glob_8 from "../content/docs/router.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/overlay.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/motivation.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/live-demo.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/getting-started.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/demos.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/comparison.mdx?collection=docs"
import { default as __fd_glob_0 } from "../content/docs/meta.json?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.docs("docs", "content/docs", {"meta.json": __fd_glob_0, }, {"comparison.mdx": __fd_glob_1, "demos.mdx": __fd_glob_2, "getting-started.mdx": __fd_glob_3, "index.mdx": __fd_glob_4, "live-demo.mdx": __fd_glob_5, "motivation.mdx": __fd_glob_6, "overlay.mdx": __fd_glob_7, "router.mdx": __fd_glob_8, "rpc.mdx": __fd_glob_9, "sandbox-tiers.mdx": __fd_glob_10, "test-scenarios.mdx": __fd_glob_11, });