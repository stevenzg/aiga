/** A function that unsubscribes from a listener. */
export type Unsubscribe = () => void;

/** JSON-serializable types that can cross iframe boundaries. */
export type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Serializable[]
  | { [key: string]: Serializable };

/** Internal RPC message envelope sent via postMessage. */
export interface RpcMessage {
  __aiga_rpc: true;
  id: string;
  type: 'call' | 'result' | 'error' | 'event';
  method?: string;
  args?: Serializable[];
  result?: Serializable;
  error?: string;
  event?: string;
  data?: Serializable;
}

/**
 * Extract the RPC-callable methods from a contract interface.
 * Methods that return Promise are treated as async RPC calls.
 * Methods that accept a callback are treated as event subscriptions.
 */
export type RpcProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R
    : never;
};
