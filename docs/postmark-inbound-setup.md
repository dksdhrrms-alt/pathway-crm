# Postmark Inbound — Setup Guide

**Why**: Resend Inbound doesn't ship the message body in webhook payloads,
so BCC'd emails land in the CRM as `(Body unavailable)` and contact matching
has nothing to work with. Postmark's Inbound Stream ships the full body,
all headers, and the original recipient — everything we need to auto-attach
each email to the right Contact.

The outbound side (sending) stays on Resend. Only inbound switches.

---

## 1. Sign up + create an Inbound Stream

1. Sign up at <https://postmarkapp.com> (free tier: 100 inbound emails/mo).
2. Create a Server (any name — e.g. **"Pathway CRM"**).
3. Inside the server, open **Message Streams** → **Add Stream** → pick
   **Inbound**. Note the auto-generated inbound address; it looks like
   `abcdef123456@inbound.postmarkapp.com`.

You now have two options for the mailbox address:

- **Quick start** — use the Postmark-generated address directly. Reps BCC
  `abcdef123456@inbound.postmarkapp.com` on every email. Ugly but zero DNS.
- **Custom domain** (recommended for parity with the old Resend setup):
  point `crm@log.pathway-intermediates.com` at Postmark. Instructions
  under §2.

## 2. (Optional) Custom inbound domain

If you want reps to keep BCC'ing `crm@log.pathway-intermediates.com`:

1. In Postmark's Inbound Stream settings, set **Inbound domain** to
   `log.pathway-intermediates.com`.
2. Postmark shows an **MX record** to add. In your DNS provider (wherever
   `pathway-intermediates.com` lives — Cloudflare, GoDaddy, etc.), add:

   ```
   Type:  MX
   Host:  log.pathway-intermediates.com
   Value: inbound.postmarkapp.com
   Priority: 10
   TTL:  Auto (or 3600)
   ```

3. Wait ~5–15 min for DNS to propagate. Postmark verifies automatically.
4. **Turn off the Resend inbound MX record** for the same subdomain — you
   can only have one MX provider per hostname.

## 3. Wire the webhook

1. In the Inbound Stream, open the **Webhook** tab.
2. Pick a random token, e.g.:

   ```
   openssl rand -hex 24
   # → a3f9c2e1b6d84f2a…
   ```

3. Set the webhook URL to:

   ```
   https://pathway-crm.vercel.app/api/postmark/inbound?token=<PASTE-TOKEN-HERE>
   ```

4. Enable **"Include raw email content in JSON payload"** if it's offered
   (it doesn't affect our parser but keeps future flexibility).
5. Save.

## 4. Vercel env vars

Add these in the CRM project's Vercel dashboard → Settings → Environment
Variables (Production + Preview + Development):

| Name | Value |
|---|---|
| `POSTMARK_WEBHOOK_TOKEN` | The same random token you put in the webhook URL |
| `POSTMARK_INBOUND_ADDRESS` | (Optional) The BCC mailbox address, defaults to `crm@log.pathway-intermediates.com` |

`SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` are already set —
we reuse them so we can insert activities server-side without RLS friction.

## 5. Deploy + test

1. Deploy the branch that includes `app/api/postmark/inbound/route.ts`.
2. Verify the endpoint is live:

   ```
   curl https://pathway-crm.vercel.app/api/postmark/inbound
   ```

   Should return JSON with `route`, `token_configured: true`,
   `service_role_configured: true`.

3. Send a test email from a whitelisted address (e.g. `you@pathway-intermediates.com`)
   to a real contact, BCC'ing the Postmark mailbox address.
4. In Postmark's **Activity** tab you should see the message arrive, then
   the webhook delivery to Vercel with a `200 OK` response.
5. In the CRM, open the Contact you addressed — a new **Email** activity
   should be there with the full body and correct attribution.

## 6. Cut over from Resend Inbound

Once step 5 works end-to-end:

1. In the **Resend** dashboard, disable the inbound webhook (Webhooks →
   `https://pathway-crm.vercel.app/api/inbound-email` → Disable).
2. If you kept a Resend inbound MX record, remove it (only Postmark's
   should point at `log.pathway-intermediates.com` now).
3. The old `/api/inbound-email` route stays deployed — it's harmless and
   still 200s to any late Resend retries. You can delete it later.

## Troubleshooting

**Webhook delivery shows 401 in Postmark's Activity tab**
- `POSTMARK_WEBHOOK_TOKEN` in Vercel doesn't match the `?token=…` in the
  webhook URL. Copy them fresh.

**Delivery shows 200 but no activity appears in CRM**
- Vercel logs (`Deployments → Functions → /api/postmark/inbound → Logs`)
  will have `[postmark-inbound]` diagnostics. Check for:
  - `sender-not-in-crm` — the FROM address isn't in `users.email`. Fix the
    user row.
  - `from-domain-not-whitelisted` — sender is outside
    `pathway-intermediates.com`. Add domain to `RESEND_FROM_WHITELIST_DOMAINS`.
  - `body-scan matched: <email>` — activity created but attached to a
    different contact than expected. Check `contacts.email` values.

**Activity is created but Contact is empty**
- The recipient email wasn't in any Contact's `email` field, and there was
  no email-shape string in the body scan that matched a Contact.
- Fix the Contact's email in the CRM, then have the rep re-send.

**Duplicate messages inserted**
- Should never happen — we key on `MessageID`. If it does, the sender is
  bypassing normal SMTP and setting a new MessageID per delivery.
