# Email Login Setup (My Bookings + Admin)

Customers now sign in with their **email + a one-time 6-digit code** to view and
manage their tickets, and the **admin dashboard** uses the same code login. This
needs a few one-time steps in your Supabase project.

> Project: `juqqvpurkmonrruzmugv` (same one the app already uses)

---

## 1. Run the updated SQL

Open **Supabase → SQL Editor → New query**, paste the entire
[`supabase-schema.sql`](supabase-schema.sql) file, and **Run**. It is safe to
re-run (everything uses `if not exists` / `drop policy if exists`).

This adds:
- `cancelled_at` + `refund_amount` columns
- Row-Level Security so a signed-in user can only see **their own** bookings
  (matched on the email they booked with), while the admin email sees **all**
- `booked_seats()` — a PII-free function so the public seat map still works
  without exposing booking data

---

## 2. Set your admin email (if different)

The admin email is **`anandsullad77@gmail.com`**. If you want a
different one, change it in **two** places so they match:

1. [`admin.js`](admin.js) → `const ADMIN_EMAIL = '...'`
2. [`supabase-schema.sql`](supabase-schema.sql) → inside `public.is_admin()` →
   `lower('...')`  (then re-run that part of the SQL)

---

## 3. Enable email auth + put the CODE in the email

By default Supabase emails a **magic link**, but our screens ask for a **6-digit
code**. You must add the code token to the email template:

1. **Authentication → Providers → Email** → make sure **Email** is **enabled**.
2. **Authentication → Email Templates → "Magic Link"** → edit the template body
   and include the code, for example:

   ```html
   <h2>Your MS Travels sign-in code</h2>
   <p>Enter this code to sign in:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>This code expires in 1 hour.</p>
   ```

   The important part is **`{{ .Token }}`** — that is the 6-digit code.
   (You can keep the magic link too; clicking it also signs the user in.)

3. Save.

That's it — no SMTP needed for testing.

---

## 4. (Recommended) configure free SMTP with Brevo

Supabase's built-in email sender is **rate-limited** (only a handful of emails
per hour) and meant for development. Brevo's **free tier sends 300 emails/day**
— plenty for this app. Set it up once:

### A. Create the Brevo account + sender
1. Sign up at **https://www.brevo.com** (free, no card needed).
2. Go to **Senders, Domains & Dedicated IPs → Senders → Add a sender**.
   Enter your name + the **From** email you want (e.g. `anandsullad77@gmail.com`).
3. Brevo emails you a confirmation link — click it to **verify the sender**.

### B. Get your SMTP key
1. In Brevo, open **SMTP & API → SMTP** tab.
2. Note the **Login** (an email like `xxxx@smtp-brevo.com`) and click
   **Generate a new SMTP key** → copy the key (this is the password).

### C. Enter it in Supabase
**Supabase → Authentication → Emails → SMTP Settings → Enable Custom SMTP**, then:

| Field | Value |
|-------|-------|
| Sender email | the address you verified in step A (e.g. `anandsullad77@gmail.com`) |
| Sender name | `MS Travels` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the Brevo **Login** (`xxxx@smtp-brevo.com`) |
| Password | the **SMTP key** you generated |
| Minimum interval | `60` (seconds) is fine |

Save, then send yourself a sign-in code to test.

> Tip: the **Sender email** in Supabase must match a **verified sender** in Brevo,
> or the emails won't send.

---

## How it behaves

| Who | What they see |
|-----|----------------|
| Visitor (not signed in) | Can search buses and **book** (no login needed to buy a ticket) |
| Signed-in customer | Only the bookings made with **their** email — view, download PDF, cancel |
| Admin email | The full admin dashboard — every booking, CSV export, routes |

- **Booking** stays anonymous (no login to buy). The ticket is shown immediately
  after payment; to see it again later the customer signs in with the same email
  they entered at checkout.
- A customer can only **cancel their own** booking; the database enforces this,
  not just the UI.

### Tip: emails must match
A customer only sees a booking if they sign in with the **same email** they typed
in the "Contact Details" step at checkout. Encourage correct emails there.
