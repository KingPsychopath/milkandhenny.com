# Cloudflare email delivery events

Cloudflare Email Sending publishes delivery events through Cloudflare Queues. The app uses bounce and complaint events to stop repeated delivery attempts to a bad address.

## App configuration

Generate one dedicated relay secret and set the same value in Railway and the Queue consumer Worker:

```bash
openssl rand -hex 32
```

Store it as `EMAIL_EVENT_SECRET`. Do not reuse `CRON_SECRET`, an API token, or an account key.

## Cloudflare configuration

1. Create one Queue for Email Sending events.
2. Add Email Sending event subscriptions for `tickets.milkandhenny.com` and `notify.milkandhenny.com`.
3. Subscribe to `message.bounced` and `message.complained`.
4. Bind the Queue to a Worker consumer.
5. Set `APP_BASE_URL=https://milkandhenny.com` and `EMAIL_EVENT_SECRET` on that Worker.

The Worker forwards the Queue message ID with the Cloudflare event. The app stores the ID for replay protection and stores only a SHA-256 hash of the recipient.

```ts
interface Env {
  APP_BASE_URL: string;
  EMAIL_EVENT_SECRET: string;
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const response = await fetch(`${env.APP_BASE_URL}/api/email/events/cloudflare`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.EMAIL_EVENT_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        events: batch.messages.map((message) => ({
          id: message.id,
          occurredAt: message.timestamp.toISOString(),
          event: message.body,
        })),
      }),
    });
    if (!response.ok) throw new Error(`Email event relay failed: ${response.status}`);
  },
} satisfies ExportedHandler<Env>;
```

After deployment, send one message to a Cloudflare hard-bounce test address or another controlled invalid address. Confirm that the event reaches the app and that a second send to the same address is rejected by the outbox.
