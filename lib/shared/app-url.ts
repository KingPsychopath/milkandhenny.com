export type UrlParameters = URLSearchParams | Record<string, string | number | undefined>;

function applyParameters(target: URLSearchParams, parameters: UrlParameters) {
  if (parameters instanceof URLSearchParams) {
    parameters.forEach((value, key) => target.set(key, value));
    return;
  }
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined) target.set(key, String(value));
  }
}

export function appFragment(parameters: UrlParameters): string {
  const fragment = new URLSearchParams();
  applyParameters(fragment, parameters);
  return fragment.toString();
}

export function buildAppUrl(
  origin: string,
  path: string,
  options: { search?: UrlParameters; fragment?: UrlParameters | string } = {},
): string {
  const url = new URL(path, `${origin.replace(/\/$/, "")}/`);
  if (options.search) applyParameters(url.searchParams, options.search);
  if (typeof options.fragment === "string") url.hash = options.fragment;
  else if (options.fragment) url.hash = appFragment(options.fragment);
  return url.toString();
}
