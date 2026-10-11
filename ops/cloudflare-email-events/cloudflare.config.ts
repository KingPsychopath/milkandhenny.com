import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
  worker: {
    name: "milkandhenny-email-event-relay",
    entrypoint: "worker.ts",
    compatibilityDate: "2026-08-24",
    workersDev: false,
    observability: { enabled: true },
    triggers: [
      triggers.queue({
        name: "milkandhenny-email-events",
        maxBatchSize: 10,
        maxBatchTimeout: 5,
        maxRetries: 10,
        deadLetterQueue: "milkandhenny-email-events-dlq",
        retryDelay: 30,
      }),
    ],
    env: {
      APP_BASE_URL: bindings.text("https://milkandhenny.com"),
      EMAIL_EVENT_SECRET: bindings.secret(),
    },
  },
});
