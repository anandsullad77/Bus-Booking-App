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

  // ---- Admin password (client-side gate only) ----
  const ADMIN_PASSWORD = 'MStravel2026';
  const SESSION_KEY = 'ms_admin_ok';

  const HEADERS = {
    apikey: SUPABASE_ANON,
    Authorization: 'Bearer ' + SUPABASE_ANON
  };

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

  /* ---------------- Auth gate ---------------- */
  function initGate() {
    if (sessionStorage.getItem(SESSION_KEY) === '1') return unlock();
    $('gate-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const val = $('gate-pass').value;
      if (val === ADMIN_PASSWORD) {
        sessionStorage.setItem(SESSION_KEY, '1');
        unlock();
      } else {
        $('gate-err').textContent = 'Incorrect password. Try again.';
        $('gate-pass').value = '';
        $('gate-pass').focus();
      }
    });
  }

  function unlock() {
    $('gate').hidden = true;
    $('dash').hidden = false;
    loadAll();
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    location.reload();
  }

  /* ---------------- Data ---------------- */
  async function sbGet(path) {
    const res = await fetch(REST + path, { headers: HEADERS });
    if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function loadAll() {
    try {
      $('b-body').innerHTML = '<tr><td colspan="10" class="loading">Loading…</td></tr>';
      $('r-body').innerHTML = '<tr><td colspan="13" class="loading">Loading…</td></tr>';
      const [routes, bookings] = await Promise.all([
        sbGet('/bus_routes?select=*&order=id.asc'),
        sbGet('/bus_bookings?select=*&order=created_at.desc')
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
