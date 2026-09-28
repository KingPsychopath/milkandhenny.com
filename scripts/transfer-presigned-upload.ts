import fs from "node:fs";
import path from "node:path";

import type { TransferPresignResult } from "../features/transfers/transfer-operations-service.server";
import type { TransferUploadFileInput } from "../features/transfers/upload-types";

type PresignedFile = Extract<TransferPresignResult, { status: "ready" }>["urls"][number];

export async function putPresignedFile(
  dir: string,
  file: TransferUploadFileInput & { mediaId: string },
  destination: PresignedFile,
): Promise<TransferUploadFileInput & { mediaId: string }> {
  const source = path.join(dir, file.name);
  const put = async (url: string, start?: number, end?: number) => {
    const size = end === undefined ? file.size : end - (start ?? 0) + 1;
    const response = await fetch(url, {
      method: "PUT",
      body: fs.createReadStream(
        source,
        start === undefined ? {} : { start, end },
      ) as unknown as BodyInit,
      headers: {
        "content-length": String(size),
        ...(start === undefined ? { "content-type": destination.contentType } : {}),
      },
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok)
      throw new Error(`Object upload failed for ${file.name}: HTTP ${response.status}`);
    return response;
  };

  if (destination.multipart) {
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (const part of destination.multipart.parts) {
      const start = (part.partNumber - 1) * destination.multipart.partSize;
      const end = Math.min(file.size, start + destination.multipart.partSize) - 1;
      const response = await put(part.url, start, end);
      const etag = response.headers.get("etag");
      if (!etag)
        throw new Error(`Missing multipart ETag for ${file.name}, part ${part.partNumber}`);
      parts.push({ partNumber: part.partNumber, etag });
    }
    return { ...file, multipart: { uploadId: destination.multipart.uploadId, parts } };
  }
  if (!destination.primaryUrl) throw new Error(`Missing upload URL for ${file.name}`);
  await put(destination.primaryUrl);
  return file;
}

export async function uploadPresignedFiles(
  dir: string,
  files: Array<TransferUploadFileInput & { mediaId: string }>,
  urls: PresignedFile[],
  uploadedNames: string[],
  onProgress?: (msg: string) => void,
): Promise<TransferUploadFileInput[]> {
  const uploaded = new Set(uploadedNames);
  const destinations = new Map(urls.map((url) => [url.mediaId, url]));
  const finalized: TransferUploadFileInput[] = [];
  for (const file of files) {
    if (uploaded.has(file.name)) {
      finalized.push(file);
      continue;
    }
    const destination = destinations.get(file.mediaId);
    if (!destination) throw new Error(`Missing signed upload target for ${file.name}`);
    onProgress?.(`Uploading ${file.name}...`);
    finalized.push(await putPresignedFile(dir, file, destination));
    onProgress?.(`Uploaded ${file.name}`);
  }
  return finalized;
}
