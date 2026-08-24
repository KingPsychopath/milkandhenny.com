import "./worker-configuration.d.ts";

type CloudflareEmailEvent = {
  metadata?: { eventTimestamp?: unknown };
};

function retryDelay(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3_600);
}

export default {
  async queue(batch: MessageBatch<CloudflareEmailEvent>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const eventTimestamp = message.body.metadata?.eventTimestamp;
        const response = await fetch(`${env.APP_BASE_URL}/api/email/events/cloudflare`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${env.EMAIL_EVENT_SECRET}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            events: [
              {
                id: message.id,
                occurredAt:
                  typeof eventTimestamp === "string"
                    ? eventTimestamp
                    : message.timestamp.toISOString(),
                event: message.body,
              },
            ],
          }),
        });

        if (response.ok) {
          message.ack();
          continue;
        }

        if (response.status === 400) {
          console.error("Discarding invalid Cloudflare email event", {
            messageId: message.id,
            status: response.status,
          });
          message.ack();
          continue;
        }

        console.error("Email event relay failed", {
          messageId: message.id,
          status: response.status,
        });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      } catch (error) {
        console.error("Email event relay request failed", {
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error),
        });
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      }
    }
  },
} satisfies ExportedHandler<Env, CloudflareEmailEvent>;
