export function createRuntimeLifecycle(disposeResource: () => Promise<void>, label: string) {
  let state: "running" | "disposing" | "disposed" = "running";
  let disposal: Promise<void> | null = null;

  return {
    run<A>(start: () => Promise<A>): Promise<A> {
      if (state !== "running") return Promise.reject(new Error(`${label} runtime is ${state}`));
      return start();
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      state = "disposing";
      disposal = disposeResource().finally(() => {
        state = "disposed";
      });
      return disposal;
    },
    state: () => state,
  };
}
