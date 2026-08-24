# Local email testing

Local development uses Mailpit. It captures messages in a private inbox on the
machine, so ticket confirmations, communication plans, and test sends can be
checked without contacting a real recipient.

Start the inbox:

```sh
pnpm email:local
```

Open [http://127.0.0.1:8025](http://127.0.0.1:8025), then start the app with
`pnpm dev`. The app uses Mailpit automatically in development. If the app is
started in another local mode, set `EMAIL_TRANSPORT=mailpit` and
`EMAIL_MAILPIT_URL=http://127.0.0.1:8025` in `.env.local`.

Use the admin Communications panel as normal. Preview an individual stage or
send the complete test plan. The message appears in Mailpit with its HTML,
plain-text fallback, links, inline images, and attachments available to inspect.
The panel still needs the app's normal local Postgres setup because event plans
and ticket recipients are durable data; Mailpit replaces only the external
email provider.

Railway remains the separate real-delivery check. It is the right place to
confirm provider acceptance, Gmail/Outlook rendering, authentication, and
inbox placement. Never copy Railway email credentials into `.env.local`.

Stop Mailpit when it is not needed:

```sh
pnpm email:local:stop
```
