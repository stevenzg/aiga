import type { MDXComponents } from 'mdx/types';
import defaultComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import {
  SandboxDemo,
  RpcDemo,
  RouterDemo,
  OverlayDemo,
} from '@/components/demos';
import {
  CrossOriginDemo,
  TextSyncDemo,
  CounterDemo,
  TodosDemo,
} from '@/components/live-demo';

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...defaultComponents,
    Tab,
    Tabs,
    Step,
    Steps,
    SandboxDemo,
    RpcDemo,
    RouterDemo,
    OverlayDemo,
    CrossOriginDemo,
    TextSyncDemo,
    CounterDemo,
    TodosDemo,
    ...components,
  };
}
