# Cloudflare: Rate limit image requests (WAF)

Prevent one IP from spamming your R2 image URLs and burning through read quota.

**Requirement:** Your images must be served from a domain that is on your Cloudflare account and **proxied** (orange cloud). Example: `pics.milkandhenny.com` (or whatever you set in `NEXT_PUBLIC_R2_PUBLIC_URL`). If you use an `*.r2.dev` URL, you cannot rate limit it here — switch to a custom domain on Cloudflare first.

---

## 1. Open WAF / Rate limiting

1. Log in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Select the **zone** that serves your images (e.g. **milkandhenny.com**).
3. In the left sidebar: **Security** → **WAF** (Web Application Firewall).
4. Open the **Rate limiting rules** tab (or **Rules** → **Rate limiting** depending on UI).

---

## 2. Create a rate limiting rule

1. Click **Create rule** (or **Add rule**).
2. **Rule name:** e.g. `Limit image requests per IP`.
3. **If…** (expression builder):
   - Field: **Hostname**
   - Operator: **equals**
   - Value: your image host, e.g. `pics.milkandhenny.com`
   - **And** (add another condition):
   - Field: **URI Path**
   - Operator: **starts with**
   - Value: `/albums/`

   So: only requests to `pics.milkandhenny.com` and paths like `/albums/...` are counted.

4. **When rate exceeds…**
   - **Requests:** e.g. `600`
   - **Period:** `1 minute`
   - **With same…:** **Source IP** (count per IP).

5. **Then…**
   - **Action:** **Block**
   - **Duration:** `10 seconds` (free plan only allows 10 seconds)

6. **Save** / **Deploy**.

---

## 3. Result

- Normal users: dozens of image requests per minute (album + thumbs + full size) stay well under 100/10s.
- Abuser/bot: after 100 requests in 10 seconds from one IP, Cloudflare returns **429** and blocks that IP for 10 seconds. This limits sustained abuse to ~100 requests per 20 seconds per IP.

> **Free plan limitation:** Both period and block duration are capped at 10 seconds. Pro plan unlocks longer periods (1 min, 5 min) and block durations (10 min+). The 10-second block is still effective against casual abuse; for serious attacks, use the incident response steps below.

---

## Billing notification (usage-based)

Cloudflare does not offer a hard “stop at $X” cap. You can only get **alerts** when usage passes a threshold:

1. **Billing** (account-level, not zone) → **Notifications** (or **Billing** → **Usage-based billing**).
2. If “Usage Based Billing” is listed but clicking it does nothing: try **Billing** in the left sidebar from the **account** (click the top-level “Cloudflare” or your account name to switch from zone to account). Then look for **Notifications** or **Billing notifications**.
3. Add a notification: product = **R2** (or **All products**), threshold = e.g. **$5** or **$10**, email = yours.

If your account has no usage-based products (e.g. R2 not enabled or no paid plan), the billing notification option may be missing or inactive — that’s a common reason “nothing happens” when clicking Billing.
