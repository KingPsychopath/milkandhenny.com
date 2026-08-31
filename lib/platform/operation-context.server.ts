import { AsyncLocalStorage } from "node:async_hooks";

const operationSignal = new AsyncLocalStorage<AbortSignal>();

/** Makes Effect cancellation visible to lower-level adapters without coupling them to Effect. */
export function withOperationSignal<A>(signal: AbortSignal, run: () => Promise<A>): Promise<A> {
  return operationSignal.run(signal, run);
}

export function currentOperationSignal(): AbortSignal | undefined {
  return operationSignal.getStore();
}
