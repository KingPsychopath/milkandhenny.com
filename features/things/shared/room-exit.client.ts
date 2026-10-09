/** Give the room a short chance to record a departure without making navigation depend on it. */
export async function exitRoom(notify: () => Promise<unknown>, onExit: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve()
        .then(notify)
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 1500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    onExit();
  }
  return true;
}
