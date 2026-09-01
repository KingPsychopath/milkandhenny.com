import { AsyncLocalStorage } from "node:async_hooks";

import * as r2 from "./r2.server";

export type ObjectStorageProvider = {
  deleteObject: typeof r2.deleteObject;
  deleteObjects: typeof r2.deleteObjects;
  downloadBuffer: typeof r2.downloadBuffer;
  downloadToFile: typeof r2.downloadToFile;
  headObject: typeof r2.headObject;
  isConfigured: typeof r2.isConfigured;
  listObjects: typeof r2.listObjects;
  listPrefixes: typeof r2.listPrefixes;
  presignGetUrl: typeof r2.presignGetUrl;
  presignPutUrl: typeof r2.presignPutUrl;
  uploadBuffer: typeof r2.uploadBuffer;
};

export const r2ObjectStorageProvider: ObjectStorageProvider = {
  deleteObject: (...args) => r2.deleteObject(...args),
  deleteObjects: (...args) => r2.deleteObjects(...args),
  downloadBuffer: (...args) => r2.downloadBuffer(...args),
  downloadToFile: (...args) => r2.downloadToFile(...args),
  headObject: (...args) => r2.headObject(...args),
  isConfigured: () => r2.isConfigured(),
  listObjects: (...args) => r2.listObjects(...args),
  listPrefixes: (...args) => r2.listPrefixes(...args),
  presignGetUrl: (...args) => r2.presignGetUrl(...args),
  presignPutUrl: (...args) => r2.presignPutUrl(...args),
  uploadBuffer: (...args) => r2.uploadBuffer(...args),
};

const activeObjectStorageProvider = new AsyncLocalStorage<ObjectStorageProvider>();

export function withObjectStorageProvider<A>(
  provider: ObjectStorageProvider,
  run: () => Promise<A>,
): Promise<A> {
  return activeObjectStorageProvider.run(provider, run);
}

function current(): ObjectStorageProvider {
  return activeObjectStorageProvider.getStore() ?? r2ObjectStorageProvider;
}

export const deleteObject: ObjectStorageProvider["deleteObject"] = (...args) =>
  current().deleteObject(...args);
export const deleteObjects: ObjectStorageProvider["deleteObjects"] = (...args) =>
  current().deleteObjects(...args);
export const downloadBuffer: ObjectStorageProvider["downloadBuffer"] = (...args) =>
  current().downloadBuffer(...args);
export const downloadToFile: ObjectStorageProvider["downloadToFile"] = (...args) =>
  current().downloadToFile(...args);
export const headObject: ObjectStorageProvider["headObject"] = (...args) =>
  current().headObject(...args);
export const isConfigured: ObjectStorageProvider["isConfigured"] = () => current().isConfigured();
export const listObjects: ObjectStorageProvider["listObjects"] = (...args) =>
  current().listObjects(...args);
export const listPrefixes: ObjectStorageProvider["listPrefixes"] = (...args) =>
  current().listPrefixes(...args);
export const presignGetUrl: ObjectStorageProvider["presignGetUrl"] = (...args) =>
  current().presignGetUrl(...args);
export const presignPutUrl: ObjectStorageProvider["presignPutUrl"] = (...args) =>
  current().presignPutUrl(...args);
export const uploadBuffer: ObjectStorageProvider["uploadBuffer"] = (...args) =>
  current().uploadBuffer(...args);
