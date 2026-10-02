import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  S3Client,
  CreateBucketCommand,
  PutBucketCorsCommand,
  PutBucketPolicyCommand,
} from "@aws-sdk/client-s3";
import { localDevEnvironment } from "./local-dev-env.mjs";

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, { stdio: "inherit", env, detached: grouped });
    const interrupt = () => {
      if (!child.pid) return;
      if (grouped) process.kill(-child.pid, "SIGINT");
      else child.kill("SIGINT");
    };
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
      if (signal || code === 130) process.exit(130);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}`));
    });
  });
}
const compose = ["compose", "-f", "docker-compose.local.yml"];
async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "setup") {
    await run("docker", [...compose, "pull"]);
    await run("pnpm", ["model:semantic"]);
    console.log(
      "Local services and semantic model cached. Run pnpm dev; subsequent starts work offline.",
    );
    return;
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("Local development cannot run in production.");
  await mkdir(".local-dev", { recursive: true });
  let secret;
  try {
    secret = await readFile(".local-dev/auth-secret", "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    secret = randomBytes(32).toString("hex");
    await writeFile(".local-dev/auth-secret", secret, { mode: 0o600, flag: "wx" });
  }
  const portIndex = args.indexOf("--port");
  const port = portIndex < 0 ? 3000 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid local port.");
  const env = localDevEnvironment(process.env, secret, port);
  await run(
    "docker",
    [...compose, "up", "-d", "--pull", "never", "--wait", "--wait-timeout", "60"],
    env,
  );
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_PUBLIC_ACCESS_KEY,
      secretAccessKey: env.R2_PUBLIC_SECRET_KEY,
    },
    maxAttempts: 1,
  });
  try {
    for (const Bucket of [env.R2_PUBLIC_BUCKET, env.R2_PRIVATE_BUCKET]) {
      let ready = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket }));
          ready = true;
          break;
        } catch (error) {
          if (["BucketAlreadyOwnedByYou", "BucketAlreadyExists"].includes(error.name)) {
            ready = true;
            break;
          }
          if (attempt === 29) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      if (!ready) throw new Error("Local storage did not start.");
      await s3.send(
        new PutBucketCorsCommand({
          Bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`],
                AllowedMethods: ["GET", "HEAD", "PUT", "POST"],
                AllowedHeaders: ["*"],
                ExposeHeaders: ["ETag"],
              },
            ],
          },
        }),
      );
    }
    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: env.R2_PUBLIC_BUCKET,
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: ["s3:GetObject"],
              Resource: [`arn:aws:s3:::${env.R2_PUBLIC_BUCKET}/*`],
            },
          ],
        }),
      }),
    );
  } finally {
    s3.destroy();
  }
  await run("pnpm", ["database:migrate"], env);
  if (args[0] === "cli") {
    await run("pnpm", ["cli", ...args.slice(1)], env);
    return;
  }
  console.log(
    `\nApp: http://127.0.0.1:${port}\nInbox: http://127.0.0.1:18025\nAdmin password: local-admin-password\nUpload PIN: local-upload-pin\nData persists between starts. Stop services with pnpm dev:stop.\n`,
  );
  await run("pnpm", ["dev:server", "--host", "127.0.0.1", ...args], env);
}
main().catch((error) => {
  console.error(
    `Local development: ${error.message}\nIf images are missing, run pnpm dev:setup once while online.`,
  );
  process.exitCode = 1;
});
