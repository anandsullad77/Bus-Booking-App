// ====================================================================
//  Supabase Edge Function: send-ticket
//  Sends a branded booking-confirmation e-ticket email via Brevo.
//
//  Deploy:   supabase functions deploy send-ticket
//  Secrets:  supabase secrets set BREVO_API_KEY=xkeysib-...   (Brevo v3 API key)
//            supabase secrets set SENDER_EMAIL=anandsullad77@gmail.com  (verified)
//  Called from the app:  sbClient.functions.invoke('send-ticket', { body: { booking } })
// ====================================================================
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY") ?? "";
const SENDER_EMAIL  = Deno.env.get("SENDER_EMAIL")  ?? "anandsullad77@gmail.com";
const SENDER_NAME   = "MS Travels";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const rupee = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN");

function prettyDate(str: string) {
  try {
    const d = new Date(String(str).length <= 10 ? str + "T00:00:00" : str);
    return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  } catch {
    return str;
  }
}

function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ----- The beautiful e-ticket email -----
function buildHtml(b: any) {
  const bp = b.boarding_point || {};
  const dp = b.dropping_point || {};
  const seats: string[] = b.seats || [];
  const total = Number(b.total_fare) || 0;
  const base = Math.round(total / 1.05);
  const gst = total - base;

  const paxRows = (b.passengers || []).map((p: any, i: number) =>
    `<tr>
       <td style="padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;color:#475569">${i + 1}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;color:#1d3557;font-weight:600">${esc(p.name)}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;color:#475569">${esc(p.age)} / ${esc(p.gender)}</td>
       <td style="padding:8px 10px;border-bottom:1px solid #eef2f6;font-size:13px;color:#1d3557;font-weight:700">${esc(p.seat)}</td>
     </tr>`).join("");

  const qrPayload =
    `MS TRAVELS E-TICKET | PNR:${b.pnr} | ${b.source_city}->${b.destination_city} | ` +
    `${prettyDate(b.journey_date)} ${b.departure_time} | Seats:${seats.join(",")}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=${encodeURIComponent(qrPayload)}`;

  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 0;font-family:Arial,Helvetica,sans-serif">
 <tr><td align="center">
  <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(29,53,87,.12)">

   <!-- Header -->
   <tr><td style="background:#1d3557;padding:26px 32px">
     <table width="100%"><tr>
       <td style="vertical-align:middle">
         <span style="display:inline-block;background:#e63946;color:#fff;font-size:16px;font-weight:bold;letter-spacing:2px;padding:7px 13px;border-radius:8px">MS</span>
         <span style="color:#fff;font-size:18px;font-weight:bold;margin-left:8px;vertical-align:middle">MS Travels</span>
       </td>
       <td align="right" style="vertical-align:middle">
         <span style="display:inline-block;background:#2a9d8f;color:#fff;font-size:12px;font-weight:bold;padding:6px 12px;border-radius:20px">✓ CONFIRMED</span>
       </td>
     </tr></table>
   </td></tr>

   <!-- Greeting -->
   <tr><td style="padding:28px 32px 8px;text-align:center">
     <h1 style="margin:0 0 6px;color:#1d3557;font-size:22px">Booking Confirmed! 🎉</h1>
     <p style="margin:0;color:#6b7280;font-size:14px">Hi ${esc(b.contact_name || "Traveller")}, your seats are booked. Have a safe journey!</p>
   </td></tr>

   <!-- PNR strip -->
   <tr><td style="padding:18px 32px">
     <table width="100%" style="background:#f1faee;border:1px dashed #2a9d8f;border-radius:12px">
       <tr><td style="padding:14px 18px;text-align:center">
         <div style="color:#6b7280;font-size:12px;letter-spacing:1px">YOUR PNR</div>
         <div style="color:#1d3557;font-size:26px;font-weight:bold;letter-spacing:4px">${esc(b.pnr)}</div>
       </td></tr>
     </table>
   </td></tr>

   <!-- Route -->
   <tr><td style="padding:6px 32px 8px">
     <table width="100%"><tr>
       <td style="text-align:left;vertical-align:top">
         <div style="color:#1d3557;font-size:20px;font-weight:bold">${esc(b.source_city)}</div>
         <div style="color:#6b7280;font-size:13px">${esc(b.departure_time)} · ${esc(bp.name || "")}</div>
       </td>
       <td style="text-align:center;color:#e63946;font-size:18px;vertical-align:middle">🚌 ▶</td>
       <td style="text-align:right;vertical-align:top">
         <div style="color:#1d3557;font-size:20px;font-weight:bold">${esc(b.destination_city)}</div>
         <div style="color:#6b7280;font-size:13px">${esc(b.arrival_time)} · ${esc(dp.name || "")}</div>
       </td>
     </tr></table>
   </td></tr>

   <!-- Detail grid -->
   <tr><td style="padding:14px 32px">
     <table width="100%" style="border-top:1px solid #eef2f6;border-bottom:1px solid #eef2f6">
       <tr>
         <td style="padding:12px 0;width:50%">
           <div style="color:#9aa3b2;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Journey Date</div>
           <div style="color:#1d3557;font-size:14px;font-weight:600">${prettyDate(b.journey_date)}</div>
         </td>
         <td style="padding:12px 0;width:50%">
           <div style="color:#9aa3b2;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Bus Type</div>
           <div style="color:#1d3557;font-size:14px;font-weight:600">${esc(b.bus_type)}</div>
         </td>
       </tr>
       <tr>
         <td style="padding:12px 0">
           <div style="color:#9aa3b2;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Boarding</div>
           <div style="color:#1d3557;font-size:14px;font-weight:600">${esc(bp.name || "-")} ${esc(bp.time || "")}</div>
         </td>
         <td style="padding:12px 0">
           <div style="color:#9aa3b2;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Seats</div>
           <div style="color:#1d3557;font-size:14px;font-weight:700">${seats.join(", ")}</div>
         </td>
       </tr>
     </table>
   </td></tr>

   <!-- Passengers -->
   <tr><td style="padding:8px 32px">
     <div style="color:#1d3557;font-size:14px;font-weight:bold;margin-bottom:6px">Passengers</div>
     <table width="100%" style="border-collapse:collapse">
       <thead><tr style="background:#f8fafc">
         <th style="padding:8px 10px;text-align:left;font-size:11px;color:#9aa3b2;text-transform:uppercase">#</th>
         <th style="padding:8px 10px;text-align:left;font-size:11px;color:#9aa3b2;text-transform:uppercase">Name</th>
         <th style="padding:8px 10px;text-align:left;font-size:11px;color:#9aa3b2;text-transform:uppercase">Age/Gender</th>
         <th style="padding:8px 10px;text-align:left;font-size:11px;color:#9aa3b2;text-transform:uppercase">Seat</th>
       </tr></thead>
       <tbody>${paxRows}</tbody>
     </table>
   </td></tr>

   <!-- QR + fare -->
   <tr><td style="padding:18px 32px">
     <table width="100%"><tr>
       <td style="width:180px;text-align:center;vertical-align:top">
         <img src="${qrUrl}" width="150" height="150" alt="QR" style="border:1px solid #eef2f6;border-radius:10px;padding:6px;background:#fff" />
         <div style="color:#9aa3b2;font-size:11px;margin-top:6px">Scan at boarding</div>
       </td>
       <td style="vertical-align:top;padding-left:18px">
         <table width="100%">
           <tr><td style="color:#6b7280;font-size:13px;padding:4px 0">Base Fare</td><td align="right" style="color:#1d3557;font-size:13px;padding:4px 0">${rupee(base)}</td></tr>
           <tr><td style="color:#6b7280;font-size:13px;padding:4px 0">GST (5%, incl.)</td><td align="right" style="color:#1d3557;font-size:13px;padding:4px 0">${rupee(gst)}</td></tr>
           <tr><td style="color:#1d3557;font-size:16px;font-weight:bold;padding:10px 0 0;border-top:2px solid #1d3557">Total Paid</td>
               <td align="right" style="color:#1d3557;font-size:16px;font-weight:bold;padding:10px 0 0;border-top:2px solid #1d3557">${rupee(total)}</td></tr>
         </table>
       </td>
     </tr></table>
   </td></tr>

   <!-- Instructions -->
   <tr><td style="padding:8px 32px 18px">
     <div style="background:#fff5f5;border-radius:10px;padding:14px 16px">
       <div style="color:#c1121f;font-size:13px;font-weight:bold;margin-bottom:6px">Before you board</div>
       <ul style="margin:0;padding-left:18px;color:#6b7280;font-size:12px;line-height:1.7">
         <li>Reach the boarding point 15 minutes before departure (${esc(b.departure_time)}).</li>
         <li>Carry a valid government photo ID.</li>
         <li>Show this email (QR/PNR) at boarding.</li>
       </ul>
     </div>
   </td></tr>

   <!-- Footer -->
   <tr><td style="background:#1d3557;padding:20px 32px;text-align:center">
     <div style="color:#fff;font-size:13px;font-weight:600">🚌 Wishing you a safe & happy journey!</div>
     <div style="color:rgba(255,255,255,.7);font-size:11px;margin-top:6px">Helpline 1800-200-1234 · support@mstravels.demo</div>
   </td></tr>

  </table>
 </td></tr>
</table>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    if (!BREVO_API_KEY) {
      return new Response(JSON.stringify({ error: "BREVO_API_KEY not set" }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const { booking } = await req.json();
    if (!booking || !booking.contact_email) {
      return new Response(JSON.stringify({ error: "Missing booking or contact_email" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: booking.contact_email, name: booking.contact_name || "Traveller" }],
        subject: `🎫 Booking Confirmed — ${booking.source_city} → ${booking.destination_city} (PNR ${booking.pnr})`,
        htmlContent: buildHtml(booking),
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: "Brevo: " + t }),
        { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
