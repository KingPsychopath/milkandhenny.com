import "./r2-client";

import { closeDirectRedisConnections } from "@/lib/platform/redis-direct";
import { drainMediaQueuesUntilIdle } from "@/features/media/worker-runtime";

async function main() {
  const result = await drainMediaQueuesUntilIdle();
  console.log(JSON.stringify(result));
}

void main()
  .finally(() => closeDirectRedisConnections())
  .catch((error) => {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(detail);
    process.exitCode = 1;
  });
