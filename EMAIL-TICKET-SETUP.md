# Ticket Confirmation Email Setup

When a booking is confirmed, the app now emails a **beautiful HTML e-ticket**
(PNR, route, seats, passengers, QR code, fare) to the customer's email via Brevo.

It works through a **Supabase Edge Function** ([`supabase/functions/send-ticket/index.ts`](supabase/functions/send-ticket/index.ts))
so your Brevo key stays on the server and is never exposed in the browser.

---

## 1. Get a Brevo **API key** (not the SMTP key)

The email is sent with Brevo's transactional API, which needs a **v3 API key**
(different from the SMTP key you used for Supabase Auth).

1. Brevo → **SMTP & API → API keys & MCP** tab.
2. **Generate a new API key** → name it `supabase-edge` → copy it
   (looks like `xkeysib-...`). You only see it once.

---

## 2. Deploy the Edge Function

### Option A — Supabase Dashboard (no tools to install)
1. Supabase → **Edge Functions → Create a function**.
2. Name it **exactly** `send-ticket`.
3. Paste the contents of
   [`supabase/functions/send-ticket/index.ts`](supabase/functions/send-ticket/index.ts)
   into the editor.
4. Click **Deploy**.

### Option B — Supabase CLI
```bash
npm install -g supabase           # if you don't have it
supabase login
supabase link --project-ref juqqvpurkmonrruzmugv
supabase functions deploy send-ticket
```

---

## 3. Add the secrets

The function reads two secrets: your Brevo API key and the sender email
(must be a **verified sender** in Brevo — `anandsullad77@gmail.com`).

### Dashboard
Supabase → **Edge Functions → send-ticket → Secrets** (or
**Project Settings → Edge Functions → Secrets**), add:

| Name | Value |
|------|-------|
| `BREVO_API_KEY` | the `xkeysib-...` key from step 1 |
| `SENDER_EMAIL`  | `anandsullad77@gmail.com` |

### CLI
```bash
supabase secrets set BREVO_API_KEY=xkeysib-xxxxxxxx
supabase secrets set SENDER_EMAIL=anandsullad77@gmail.com
```

---

## 4. Test

Make a booking in the app with a real email in the **Contact Details** step.
After payment you should see a toast *"Ticket emailed to …"* and the e-ticket
should arrive in that inbox (check spam the first time).

---

## Troubleshooting

- **No email + console warning "Ticket email failed"** → open the function logs
  in Supabase (Edge Functions → send-ticket → Logs) to see the error.
- **`BREVO_API_KEY not set`** → the secret wasn't added / function wasn't
  re-deployed after adding it. Re-deploy after setting secrets.
- **`Brevo: ... sender not valid`** → `SENDER_EMAIL` must match a **verified
  sender** in Brevo.
- **401 Unauthorized when the app calls the function** → in the function's
  settings, turn **Verify JWT** off (anonymous checkout calls it with the public
  key). The booking still succeeds either way — the email is best-effort.

> Note: the email is **non-blocking** — if sending fails, the booking is still
> confirmed and the on-screen ticket + PDF download still work.
