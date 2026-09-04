import { createServer } from "node:http";
import Redis from "ioredis";

// Local Upstash-compatible transport for browser fixtures. Redis executes the real
// commands, transactions and Lua scripts; no game/auth semantics are emulated.
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://127.0.0.1:56379");
if (!["127.0.0.1", "localhost", "::1"].includes(redisUrl.hostname)) {
  throw new Error("The browser Redis bridge requires a loopback test database");
}
const redis = new Redis(redisUrl.href);
const encode = (value) =>
  Array.isArray(value)
    ? value.map(encode)
    : typeof value === "string"
      ? Buffer.from(value).toString("base64")
      : value;
const server = createServer(async (request, response) => {
  if (request.url === "/health") {
    try {
      await redis.ping();
      response.end("ok");
    } catch {
      response.writeHead(503);
      response.end();
    }
    return;
  }
  if (request.headers.authorization !== "Bearer local-browser-test") {
    response.writeHead(401);
    response.end();
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const serialize = (value) =>
      request.headers["upstash-encoding"] === "base64" ? encode(value) : value;
    let result;
    if (request.url === "/multi-exec" || request.url === "/pipeline") {
      const pipeline = request.url === "/multi-exec" ? redis.multi() : redis.pipeline();
      for (const [command, ...args] of body) pipeline.call(command, ...args);
      result = (await pipeline.exec()).map(([error, value]) =>
        error ? { error: error.message } : { result: serialize(value) },
      );
    } else {
      const [command, ...args] = body;
      result = { result: serialize(await redis.call(command, ...args)) };
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ error: error instanceof Error ? error.message : "Invalid command" }),
    );
  }
});
server.listen(56380, "127.0.0.1");
function close() {
  server.closeAllConnections();
  server.close();
  redis.disconnect();
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
