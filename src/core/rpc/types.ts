/** A function that unsubscribes from a listener. */
export type Unsubscribe = () => void;

/** JSON-serializable types that can cross iframe boundaries. */
export type Serializable =
  | string
  | number
  | boolean
  | null
  | Serializable[]
  | { [key: string]: Serializable };

// ─── Discriminated Union for RPC Messages ────────────────────────

/** Base fields shared by all RPC message types. */
interface RpcMessageBase {
  __aiga_rpc: true;
  id: string;
}

/** A remote method call from one side to the other. */
export interface RpcCallMessage extends RpcMessageBase {
  type: 'call';
  method: string;
  args: Serializable[];
}

/** A successful result response. */
export interface RpcResultMessage extends RpcMessageBase {
  type: 'result';
  result: Serializable;
}

/** An error response. */
export interface RpcErrorMessage extends RpcMessageBase {
  type: 'error';
  error: string;
}

/** A fire-and-forget event notification. */
export interface RpcEventMessage extends RpcMessageBase {
  type: 'event';
  event: string;
  data: Serializable;
}

/**
 * Internal RPC message envelope sent via postMessage.
 * Discriminated union on `type` for exhaustive switch handling.
 */
export type RpcMessage =
  | RpcCallMessage
  | RpcResultMessage
  | RpcErrorMessage
  | RpcEventMessage;

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
