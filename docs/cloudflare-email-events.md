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
4. Deploy the Worker in `ops/cloudflare-email-events`.
5. Set `EMAIL_EVENT_SECRET` on that Worker and the Railway web service.

The Worker forwards each Queue message separately. It acknowledges successful and malformed events, retries temporary failures with backoff, and moves events to a dead-letter queue after ten failed attempts. The app stores the message ID for replay protection and stores only a SHA-256 hash of the recipient.

After deployment, send one message to a Cloudflare hard-bounce test address or another controlled invalid address. Confirm that the event reaches the app and that a second send to the same address is rejected by the outbox.
