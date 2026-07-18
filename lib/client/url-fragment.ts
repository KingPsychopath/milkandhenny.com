export function consumeLocationFragment(): string {
  const fragment = window.location.hash.slice(1).trim();
  if (fragment) {
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return fragment;
}
