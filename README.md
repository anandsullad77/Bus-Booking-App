# MS Travels — Bus Booking Website

A complete, front-end-only bus ticket booking site (branded **MS Travels**) that
mirrors the VRL Travels booking flow (**search → bus list → seat selection → passenger details → payment → ticket/PNR**).
The backend is your existing **Supabase** project (`saywqwlgamcltgbsmudk`) accessed
directly via its REST API with the public `anon` key — no server code to deploy.

## Files

| File | Purpose |
|------|---------|
| `index.html` | All screens (single-page, sections toggled by JS) |
| `style.css`  | VRL-inspired UI (navy + red theme, responsive, print-ready ticket) |
| `app.js`     | Search, seat maps, booking flow, PNR generation, Supabase calls |
| `supabase-schema.sql` | Creates the `bus_routes` & `bus_bookings` tables, RLS policies, and seeds sample VRL routes |

## One-time setup (required before it works)

1. Open your **Supabase Dashboard → SQL Editor → New query**.
2. Paste the entire contents of **`supabase-schema.sql`** and click **Run**.
   - This creates two tables, sets row-level-security policies that let the
     public anon key read routes and create bookings, and inserts sample routes.
3. Done. The site will now load real data from Supabase.

> If you ever want to reset the data, just re-run the seed `INSERT` block.

## Run the site

It's plain static files — open `index.html` in a browser, **or** serve the folder:

```powershell
# from inside the "bus booking" folder
python -m http.server 5500
# then visit http://localhost:5500
```

(Serving over http:// rather than file:// avoids any browser fetch restrictions.)

## How the VRL flow is reproduced

1. **Search** — From / To (with city autocomplete) + date. Queries `bus_routes`
   with a case-insensitive match on source & destination.
2. **Bus list** — Operator, bus type, departure/arrival times, duration, amenities,
   rating, fare, and filters (A/C, Non-A/C, Sleeper, Seater, departure time).
3. **Seat selection** — A real seat map is generated from the bus type:
   - *Sleeper* → Lower + Upper deck berths (2+1 layout).
   - *Seater* → 2+2 grid with a steering icon.
   Already-booked seats (read live from `bus_bookings` for that route + date) are
   greyed out. Pick boarding & dropping points like VRL.
4. **Passenger details** — Name / age / gender per seat + contact info.
5. **Payment (demo)** — UPI / Card / Net-banking UI. **No real money** — it just
   simulates success, then writes the booking to Supabase.
6. **Ticket** — A printable e-ticket with a generated **PNR** (e.g. `MS7K2P9`).
   Re-check prevents double-booking the same seat.
7. **My Bookings** — Look up any ticket again by PNR.

## Customising bus routes

Add or edit rows in the `bus_routes` table (Supabase **Table Editor** or SQL).
Key columns:

- `bus_type` — must contain `Sleeper` or `Seater` so the seat map renders correctly
  (e.g. `A/C Sleeper (2+1)`, `A/C Seater (2+2)`).
- `amenities`, `boarding_points`, `dropping_points` — JSON arrays
  (`boarding_points` items look like `{"name":"Majestic","time":"21:00"}`).
- `total_seats` — drives how many berths/seats are generated.

## Notes / limitations

- This is a **demo**: payment is simulated and the anon key is public by design
  (RLS limits it to reading routes + creating bookings).
- For production you'd add real auth, a payment gateway (Razorpay/Stripe), and
  tighter RLS / an Edge Function to allocate seats atomically.
- Branded **MS Travels**; the booking flow is modelled on VRL Travels' flow as
  requested. Not affiliated with VRL Logistics Ltd.
