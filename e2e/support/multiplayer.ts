import type { Browser, BrowserContext, BrowserContextOptions, Page } from "@playwright/test";

export interface IsolatedGameSurface {
  context: BrowserContext;
  page: Page;
  role: string;
}

export async function openIsolatedGameSurface({
  baseURL,
  browser,
  contextOptions,
  role,
}: {
  baseURL: string;
  browser: Browser;
  contextOptions?: Omit<BrowserContextOptions, "baseURL">;
  role: string;
}): Promise<IsolatedGameSurface> {
  const context = await browser.newContext({ ...contextOptions, baseURL });
  const page = await context.newPage();
  return { context, page, role };
}

export async function closeGameSurfaces(surfaces: readonly IsolatedGameSurface[]) {
  await Promise.allSettled(surfaces.map(({ context }) => context.close()));
}

export async function waitForAppHydration(page: Page) {
  await page.locator("html[data-app-hydrated]").waitFor({ state: "attached" });
}
