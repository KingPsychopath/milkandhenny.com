import { env } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import { streamZipFromPublicOrigin, type ZipRequestFile } from "./zip";

export class TransferMediaContainer extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
  envVars = {
    NODE_ENV: "production",
    PORT: "8080",
    KV_REST_API_URL: env.KV_REST_API_URL,
    KV_REST_API_TOKEN: env.KV_REST_API_TOKEN,
    REDIS_URL: env.REDIS_URL,
    UPSTASH_REDIS_URL: env.UPSTASH_REDIS_URL,
    UPSTASH_REDIS_HOST: env.UPSTASH_REDIS_HOST,
    UPSTASH_REDIS_PORT: env.UPSTASH_REDIS_PORT,
    UPSTASH_REDIS_PASSWORD: env.UPSTASH_REDIS_PASSWORD,
    UPSTASH_REDIS_USERNAME: env.UPSTASH_REDIS_USERNAME,
    R2_ACCOUNT_ID: env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY: env.R2_ACCESS_KEY,
    R2_SECRET_KEY: env.R2_SECRET_KEY,
    R2_BUCKET: env.R2_BUCKET,
    MEDIA_PROCESSOR_MODE: env.MEDIA_PROCESSOR_MODE,
    TRANSFER_MEDIA_WORKER_CONCURRENCY: env.TRANSFER_MEDIA_WORKER_CONCURRENCY,
    TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS: env.TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS,
  };
}

interface Env {
  TRANSFER_MEDIA: DurableObjectNamespace<TransferMediaContainer>;
  TRANSFER_MEDIA_WAKE_TOKEN?: string;
  R2_PUBLIC_URL?: string;
}

function isAuthorized(request: Request, env: Env): boolean {
  const expected = env.TRANSFER_MEDIA_WAKE_TOKEN?.trim();
  if (!expected) return true;
  return request.headers.get("authorization") === `Bearer ${expected}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (request.method === "POST" && url.pathname === "/wake") {
      if (!isAuthorized(request, env)) {
        return new Response("unauthorized", { status: 401 });
      }

      const container = env.TRANSFER_MEDIA.getByName("transfer-media-worker");
      const response = await container.fetch("http://container/drain", {
        method: "POST",
      });

      return new Response(response.body, {
        status: response.status,
        headers: response.headers,
      });
    }

    if (request.method === "POST" && url.pathname === "/zip") {
      let body: { filename?: string; files?: ZipRequestFile[] };
      try {
        body = await request.json<{ filename?: string; files?: ZipRequestFile[] }>();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      return streamZipFromPublicOrigin({
        filename: body.filename ?? "download.zip",
        files: Array.isArray(body.files) ? body.files : [],
        publicBaseUrl: env.R2_PUBLIC_URL ?? "",
      });
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
