import { createServer } from "node:http";

const port = Number.parseInt(process.env.TEST_S3_PORT ?? "4568", 10);
const objects = new Map();

function objectKey(requestUrl) {
  const { pathname } = new URL(requestUrl, `http://127.0.0.1:${port}`);
  const parts = pathname.split("/").filter(Boolean);
  return parts.length > 1 ? parts.join("/") : null;
}

const server = createServer(async (request, response) => {
  const key = objectKey(request.url ?? "/");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "*");

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "PUT" && key) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    objects.set(key, {
      body: Buffer.concat(chunks),
      contentType: request.headers["content-type"] ?? "application/octet-stream",
    });
    response.writeHead(200, { ETag: '"test-etag"' });
    response.end();
    return;
  }

  if (request.method === "HEAD") {
    if (!key || objects.has(key)) {
      const object = key ? objects.get(key) : undefined;
      response.writeHead(200, {
        ETag: '"test-etag"',
        ...(object
          ? {
              "Content-Length": String(object.body.byteLength),
              "Content-Type": object.contentType,
            }
          : {}),
      });
    } else response.writeHead(404);
    response.end();
    return;
  }

  if (request.method === "GET" && key && objects.has(key)) {
    const object = objects.get(key);
    response.writeHead(200, { "Content-Type": object.contentType });
    response.end(object.body);
    return;
  }

  response.writeHead(request.url === "/health" ? 200 : 404);
  response.end();
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`test s3 listening on ${port}\n`);
});

function close() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
