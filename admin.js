/* ====================================================================
   MS TRAVELS — ADMIN DASHBOARD
   Reads all routes + bookings from Supabase (same project as the app).
   Password gate is client-side only (soft gate, not real security).
   ==================================================================== */
(function () {
  'use strict';

  // ---- Supabase config (same project as app.js) ----
  const SUPABASE_URL  = 'https://juqqvpurkmonrruzmugv.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1cXF2cHVya21vbnJydXptdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjI1MDIsImV4cCI6MjA5NTg5ODUwMn0.6wCU-x7HVi1rhDfzFHxbv-T6R7VXAM01K0kr8KB1ZqY';
  const REST = SUPABASE_URL + '/rest/v1';

  // ---- Admin email (must match public.is_admin() in supabase-schema.sql) ----
  // >>> CHANGE THIS to the email you will use to log in as admin <<<
  const ADMIN_EMAIL = 'anandsullad77@gmail.com';

  // Supabase JS client handles the one-time-code login + authenticated reads.
  const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  let pendingEmail = '';

  const state = { routes: [], bookings: [], tab: 'bookings' };

  const $ = (id) => document.getElementById(id);
  const rupee = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function prettyDate(str) {
    if (!str) return '-';
    const d = new Date(String(str).length <= 10 ? str + 'T00:00:00' : str);
    if (isNaN(d)) return str;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function prettyDateTime(str) {
    if (!str) return '-';
    const d = new Date(str);
    if (isNaN(d)) return str;
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------------- Auth gate (email one-time code) ---------------- */
  async function initGate() {
    // Wire up both step forms.
    $('gate-email-form').addEventListener('submit', sendCode);
    $('gate-code-form').addEventListener('submit', verifyCode);
    $('gate-back').addEventListener('click', (e) => { e.preventDefault(); showStep('email'); });

    // Already signed in (and is the admin)? Go straight in.
    const { data: { session } } = await sbClient.auth.getSession();
    if (session && session.user && isAdmin(session.user)) {
      unlock();
    } else {
      if (session) await sbClient.auth.signOut(); // a non-admin session — clear it
      showStep('email');
    }
  }

  function isAdmin(user) {
    return user && (user.email || '').toLowerCase() === ADMIN_EMAIL.toLowerCase();
  }

  function showStep(step) {
    $('gate-email-step').hidden = step !== 'email';
    $('gate-code-step').hidden  = step !== 'code';
  }

  async function sendCode(e) {
    e.preventDefault();
    $('gate-err').textContent = '';
    const email = $('gate-email').value.trim();
    if (!email) return;
    if (email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      $('gate-err').textContent = 'This email is not authorised for admin access.';
      return;
    }
    try {
      const { error } = await sbClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      pendingEmail = email;
      $('gate-email-echo').textContent = email;
      $('gate-code').value = '';
      showStep('code');
    } catch (err) {
      $('gate-err').textContent = 'Could not send code: ' + err.message;
    }
  }

  async function verifyCode(e) {
    e.preventDefault();
    $('gate-err2').textContent = '';
    const token = $('gate-code').value.trim();
    if (!token || !pendingEmail) return;
    try {
      const { data, error } = await sbClient.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
      if (error) throw error;
      if (!isAdmin(data.user)) {
        await sbClient.auth.signOut();
        $('gate-err2').textContent = 'This account is not authorised for admin access.';
        return;
      }
      unlock();
    } catch (err) {
      $('gate-err2').textContent = 'Invalid or expired code. Try again.';
    }
  }

  function unlock() {
    $('gate').hidden = true;
    $('dash').hidden = false;
    loadAll();
  }

  async function logout() {
    await sbClient.auth.signOut();
    location.reload();
  }

  /* ---------------- Data ---------------- */
  // Authenticated read through the Supabase client. RLS lets the admin email
  // (and only the admin email) read every booking; routes are public.
  async function sbSelect(table, opts) {
    let q = sbClient.from(table).select('*');
    if (opts && opts.order) q = q.order(opts.order, { ascending: !!opts.ascending });
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function loadAll() {
    try {
      $('b-body').innerHTML = '<tr><td colspan="10" class="loading">Loading…</td></tr>';
      $('r-body').innerHTML = '<tr><td colspan="13" class="loading">Loading…</td></tr>';
      const [routes, bookings] = await Promise.all([
        sbSelect('bus_routes', { order: 'id', ascending: true }),
        sbSelect('bus_bookings', { order: 'created_at', ascending: false })
      ]);
      state.routes = routes || [];
      state.bookings = bookings || [];
      renderStats();
      renderBookings();
      renderRoutes();
    } catch (err) {
      console.error(err);
      $('b-body').innerHTML = `<tr><td colspan="10" class="empty">Failed to load: ${esc(err.message)}</td></tr>`;
    }
  }

  function refresh() { loadAll(); }

  /* ---------------- Stats ---------------- */
  function renderStats() {
    const totalRevenue = state.bookings.reduce((s, b) => s + Number(b.total_fare || 0), 0);
    const seatsSold = state.bookings.reduce((s, b) => s + ((b.seats && b.seats.length) || 0), 0);
    const cards = [
      { n: state.routes.length, l: 'Bus Routes' },
      { n: state.bookings.length, l: 'Total Bookings', cls: 'green' },
      { n: seatsSold, l: 'Seats Sold' },
      { n: rupee(totalRevenue), l: 'Revenue', cls: 'red' }
    ];
    $('stats').innerHTML = cards.map(c =>
      `<div class="stat ${c.cls || ''}"><div class="n">${c.n}</div><div class="l">${c.l}</div></div>`
    ).join('');
  }

  /* ---------------- Tabs ---------------- */
  function showTab(tab) {
    state.tab = tab;
    $('tab-bookings').classList.toggle('active', tab === 'bookings');
    $('tab-buses').classList.toggle('active', tab === 'buses');
    $('view-bookings').hidden = tab !== 'bookings';
    $('view-buses').hidden = tab !== 'buses';
  }

  /* ---------------- Bookings table ---------------- */
  function filteredBookings() {
    const q = $('b-search').value.trim().toLowerCase();
    const date = $('b-date').value;
    return state.bookings.filter(b => {
      if (date && b.journey_date !== date) return false;
      if (!q) return true;
      const hay = [
        b.pnr, b.source_city, b.destination_city, b.contact_name,
        b.contact_phone, b.contact_email, b.bus_type, b.operator,
        (b.seats || []).join(' '),
        (b.passengers || []).map(p => p.name).join(' ')
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  function renderBookings() {
    const rows = filteredBookings();
    $('b-count').textContent = `${rows.length} of ${state.bookings.length} bookings`;
    if (!rows.length) {
      $('b-body').innerHTML = '<tr><td colspan="10" class="empty">No bookings found.</td></tr>';
      return;
    }
    $('b-body').innerHTML = rows.map(b => {
      const seats = (b.seats || []).map(s => `<span class="seat-chip">${esc(s)}</span>`).join('');
      const paxCount = (b.passengers || []).length;
      const statusCls = (b.status === 'CONFIRMED') ? 'green' : 'grey';
      return `<tr>
        <td><span class="pnr">${esc(b.pnr)}</span></td>
        <td>${prettyDateTime(b.created_at)}</td>
        <td>${prettyDate(b.journey_date)}</td>
        <td><strong>${esc(b.source_city)}</strong> → <strong>${esc(b.destination_city)}</strong><br>
            <span class="amenity-mini">${esc(b.departure_time)} – ${esc(b.arrival_time)}</span></td>
        <td>${esc(b.bus_type)}</td>
        <td>${seats}</td>
        <td><button class="link-btn" onclick="Admin.togglePax(this,${b.id})">${paxCount} passenger${paxCount !== 1 ? 's' : ''} ▾</button></td>
        <td>${esc(b.contact_name)}<br><span class="amenity-mini">${esc(b.contact_phone)}</span></td>
        <td><strong>${rupee(b.total_fare)}</strong></td>
        <td><span class="pill ${statusCls}">${esc(b.status || '')}</span></td>
      </tr>`;
    }).join('');
  }

  // Expand/collapse passenger detail row
  function togglePax(btn, id) {
    const tr = btn.closest('tr');
    if (tr.nextElementSibling && tr.nextElementSibling.classList.contains('pax-detail')) {
      tr.nextElementSibling.remove();
      btn.innerHTML = btn.innerHTML.replace('▴', '▾');
      return;
    }
    const b = state.bookings.find(x => x.id === id);
    if (!b) return;
    const bp = b.boarding_point || {}, dp = b.dropping_point || {};
    const paxRows = (b.passengers || []).map((p, i) =>
      `<tr><td>${i + 1}</td><td>${esc(p.name)}</td><td>${esc(p.age)}</td><td>${esc(p.gender)}</td><td><strong>${esc(p.seat)}</strong></td></tr>`
    ).join('');
    const detail = document.createElement('tr');
    detail.className = 'pax-detail';
    detail.innerHTML = `<td colspan="10">
      <div style="display:flex;gap:30px;flex-wrap:wrap;margin-bottom:10px">
        <div><span class="amenity-mini">BOARDING</span><br><strong>${esc(bp.name || '-')}</strong> ${esc(bp.time || '')}</div>
        <div><span class="amenity-mini">DROPPING</span><br><strong>${esc(dp.name || '-')}</strong> ${esc(dp.time || '')}</div>
        <div><span class="amenity-mini">EMAIL</span><br>${esc(b.contact_email || '-')}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Name</th><th>Age</th><th>Gender</th><th>Seat</th></tr></thead>
        <tbody>${paxRows}</tbody>
      </table>
    </td>`;
    tr.after(detail);
    btn.innerHTML = btn.innerHTML.replace('▾', '▴');
  }

  function clearBookingFilters() {
    $('b-search').value = '';
    $('b-date').value = '';
    renderBookings();
  }

  /* ---------------- Routes table ---------------- */
  function renderRoutes() {
    const q = $('r-search').value.trim().toLowerCase();
    const rows = state.routes.filter(r => {
      if (!q) return true;
      return [r.operator, r.bus_type, r.source_city, r.destination_city]
        .join(' ').toLowerCase().includes(q);
    });
    $('r-count').textContent = `${rows.length} of ${state.routes.length} routes`;
    if (!rows.length) {
      $('r-body').innerHTML = '<tr><td colspan="13" class="empty">No routes found.</td></tr>';
      return;
    }
    $('r-body').innerHTML = rows.map(r => {
      const amen = (r.amenities || []).join(', ');
      return `<tr>
        <td>${r.id}</td>
        <td><strong>${esc(r.operator)}</strong></td>
        <td>${esc(r.bus_type)}</td>
        <td>${esc(r.source_city)}</td>
        <td>${esc(r.destination_city)}</td>
        <td>${esc(r.departure_time)}</td>
        <td>${esc(r.arrival_time)}</td>
        <td>${esc(r.duration)}</td>
        <td><strong>${rupee(r.fare)}</strong></td>
        <td>${esc(r.total_seats)}</td>
        <td>★ ${esc(r.rating)}</td>
        <td><span class="amenity-mini">${esc(amen)}</span></td>
        <td><span class="pill ${r.is_active ? 'green' : 'grey'}">${r.is_active ? 'Yes' : 'No'}</span></td>
      </tr>`;
    }).join('');
  }

  /* ---------------- CSV export ---------------- */
  function exportCSV() {
    const rows = filteredBookings();
    if (!rows.length) { alert('No bookings to export.'); return; }
    const cols = ['PNR', 'Booked On', 'Journey Date', 'From', 'To', 'Bus Type',
      'Departure', 'Arrival', 'Seats', 'Passengers', 'Boarding', 'Dropping',
      'Contact Name', 'Phone', 'Email', 'Total Fare', 'Status'];
    const csvCell = (v) => {
      const s = String(v == null ? '' : v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [cols.join(',')];
    rows.forEach(b => {
      const bp = b.boarding_point || {}, dp = b.dropping_point || {};
      const pax = (b.passengers || []).map(p => `${p.name} (${p.age}/${p.gender}/${p.seat})`).join('; ');
      lines.push([
        b.pnr, prettyDateTime(b.created_at), b.journey_date, b.source_city, b.destination_city,
        b.bus_type, b.departure_time, b.arrival_time, (b.seats || []).join(' '), pax,
        `${bp.name || ''} ${bp.time || ''}`.trim(), `${dp.name || ''} ${dp.time || ''}`.trim(),
        b.contact_name, b.contact_phone, b.contact_email, b.total_fare, b.status
      ].map(csvCell).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'MS-Travels-Bookings.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------------- Expose ---------------- */
  window.Admin = {
    refresh, logout, showTab, renderBookings, renderRoutes,
    togglePax, clearBookingFilters, exportCSV
  };

  document.addEventListener('DOMContentLoaded', initGate);
})();
