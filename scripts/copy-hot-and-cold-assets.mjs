import { cp, mkdir, rm } from "node:fs/promises";

const source = new URL("../runtime-assets/hot-and-cold/", import.meta.url);
const destination = new URL("../.output/server/assets/hot-and-cold/", import.meta.url);

await rm(destination, { force: true, recursive: true });
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
