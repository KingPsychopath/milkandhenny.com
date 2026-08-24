# Cloudflare email delivery events

Cloudflare Email Sending publishes delivery events through Cloudflare Queues. The app translates those provider events into its own delivery model, then records delivery, deferral, failure, bounce, rejection, complaint, and meaningful link-click state in Postgres.

## App configuration

Generate one dedicated relay secret and set the same value in Railway and the Queue consumer Worker:

```bash
openssl rand -hex 32
```

Store it as `EMAIL_EVENT_SECRET`. Do not reuse `CRON_SECRET`, an API token, or an account key.

## Cloudflare configuration

1. Create one Queue for Email Sending events.
2. Add Email Sending event subscriptions for `tickets.milkandhenny.com` and `notify.milkandhenny.com`.
3. Subscribe to `message.delivered`, `message.deferred`, `message.failed`, `message.rejected`, `message.bounced`, and `message.complained`.
4. Deploy the Worker in `ops/cloudflare-email-events`.
5. Set `EMAIL_EVENT_SECRET` on that Worker and the Railway web service.

The Worker forwards each Queue message separately. It acknowledges successful and malformed events, retries temporary failures with backoff, and moves events to a dead-letter queue after ten failed attempts. The app stores the message ID for replay protection and stores only a SHA-256 hash of the recipient. Cloudflare is only the relay adapter: the admin panel reads the normalized app state, so a later provider can map into the same model.

The app also signs first-party links for communications. The redirect contains no recipient address and records only aggregate clicks by message, stage, and link key. A database outage does not break the destination because the signed URL carries the verified destination; the click count is best effort.

After deployment, send one message to a Cloudflare hard-bounce test address or another controlled invalid address. Confirm that the event reaches the app and that a second send to the same address is rejected by the outbox.
