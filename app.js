/* ====================================================================
   MS TRAVELS BUS BOOKING — Front-end app logic
   Backend: Supabase REST API (same project as the marketing site)
   ==================================================================== */
(function () {
  'use strict';

  // ---- Supabase config (your project) ----
  const SUPABASE_URL  = 'https://juqqvpurkmonrruzmugv.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1cXF2cHVya21vbnJydXptdWd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMjI1MDIsImV4cCI6MjA5NTg5ODUwMn0.6wCU-x7HVi1rhDfzFHxbv-T6R7VXAM01K0kr8KB1ZqY';
  const REST = SUPABASE_URL + '/rest/v1';

  const HEADERS = {
    apikey: SUPABASE_ANON,
    Authorization: 'Bearer ' + SUPABASE_ANON,
    'Content-Type': 'application/json'
  };

  // ---- App state ----
  const state = {
    allRoutes: [],        // routes returned by last search
    filtered: [],
    search: { from: '', to: '', date: '' },
    route: null,          // selected route
    bookedSeats: [],      // seat ids already booked for this route+date
    seatLayout: [],       // generated seat objects
    selected: [],         // selected seat ids
    booking: null         // final booking record
  };

  const CITIES = ['Bangalore', 'Hyderabad', 'Mumbai', 'Pune', 'Goa', 'Chennai', 'Delhi', 'Coimbatore', 'Mangalore', 'Hubli'];

  /* ---------------- Helpers ---------------- */
  const $  = (id) => document.getElementById(id);
  const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN');

  function showView(id) {
    document.querySelectorAll('.view, .hero').forEach(v => v.hidden = true);
    const el = $(id);
    if (el) el.hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function overlay(show, text) {
    $('overlay-text').textContent = text || 'Loading…';
    $('overlay').hidden = !show;
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  function todayStr(offset) {
    const d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }

  function prettyDate(str) {
    const d = new Date(str + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ---------------- Supabase REST ---------------- */
  async function sbGet(path) {
    const res = await fetch(REST + path, { headers: HEADERS });
    if (!res.ok) throw new Error('Supabase GET ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  async function sbPost(table, body) {
    const res = await fetch(REST + '/' + table, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=representation' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Supabase POST ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  /* ---------------- Init ---------------- */
  function init() {
    // city datalist
    const dl = $('city-list');
    dl.innerHTML = CITIES.map(c => `<option value="${c}">`).join('');
    // default date = today
    $('journey-date').value = todayStr(0);
    $('journey-date').min = todayStr(0);
  }

  /* ---------------- Search ---------------- */
  function setDate(offset) {
    $('journey-date').value = todayStr(offset);
  }

  function swapCities() {
    const f = $('from-city'), t = $('to-city');
    [f.value, t.value] = [t.value, f.value];
  }

  async function search(e) {
    if (e) e.preventDefault();
    const from = $('from-city').value.trim();
    const to   = $('to-city').value.trim();
    const date = $('journey-date').value;

    if (!from || !to || !date) { toast('Please fill all fields', true); return; }
    if (from.toLowerCase() === to.toLowerCase()) { toast('Source and destination cannot be the same', true); return; }

    state.search = { from, to, date };
    overlay(true, 'Searching buses…');
    try {
      // case-insensitive match on source + destination, active only
      const q = `/bus_routes?is_active=eq.true`
        + `&source_city=ilike.${encodeURIComponent(from)}`
        + `&destination_city=ilike.${encodeURIComponent(to)}`
        + `&order=departure_time.asc`;
      state.allRoutes = await sbGet(q);
      state.filtered = state.allRoutes.slice();
      renderResults();
      showView('view-results');
    } catch (err) {
      console.error(err);
      toast('Could not load buses. Check Supabase setup / network.', true);
    } finally {
      overlay(false);
    }
  }

  /* ---------------- Results ---------------- */
  function renderResults() {
    const { from, to, date } = state.search;
    $('results-route').textContent = `${from} → ${to}`;
    $('results-meta').textContent = `${prettyDate(date)} · ${state.filtered.length} bus(es) found`;

    const list = $('results-list');
    if (!state.filtered.length) {
      list.innerHTML = `<div class="empty-state">
        <h3>No buses found</h3>
        <p>Try another route or date. (Seeded routes include Bangalore↔Hyderabad, Mumbai↔Pune, Bangalore↔Goa, Bangalore→Chennai.)</p>
      </div>`;
      return;
    }

    list.innerHTML = state.filtered.map((r, i) => {
      const amen = (r.amenities || []).slice(0, 4)
        .map(a => `<span class="amenity-tag">${a}</span>`).join('');
      return `<div class="bus-card">
        <div class="bus-main">
          <div class="bus-operator">${r.operator}</div>
          <div class="bus-type">${r.bus_type}</div>
          <div class="bus-times">
            <div class="bus-time">${r.departure_time}<small>${r.source_city}</small></div>
            <div class="bus-dash">—— ${r.duration} ——▶</div>
            <div class="bus-time">${r.arrival_time}<small>${r.destination_city}</small></div>
          </div>
          <div class="bus-amenities">${amen}</div>
        </div>
        <div class="bus-side">
          <span class="bus-rating">★ ${r.rating}</span>
          <div class="bus-fare">${rupee(r.fare)}<small> onwards</small></div>
          <button class="select-seat-btn" onclick="App.selectBus(${i})">Select Seats</button>
        </div>
      </div>`;
    }).join('');
  }

  function applyFilters() {
    const types = [...document.querySelectorAll('.f-type:checked')].map(c => c.value);
    const times = [...document.querySelectorAll('.f-time:checked')].map(c => c.value);

    state.filtered = state.allRoutes.filter(r => {
      // bus type filter
      if (types.length) {
        const bt = r.bus_type.toLowerCase();
        const ok = types.some(t => {
          if (t === 'A/C')     return bt.includes('a/c') && !bt.includes('non');
          if (t === 'Non A/C') return bt.includes('non a/c');
          return bt.includes(t.toLowerCase());
        });
        if (!ok) return false;
      }
      // departure time filter
      if (times.length) {
        const h = parseInt(r.departure_time.split(':')[0], 10);
        const slot = h < 12 ? 'morning' : (h < 18 ? 'evening' : 'night');
        if (!times.includes(slot)) return false;
      }
      return true;
    });
    renderResults();
  }

  /* ---------------- Seat selection ---------------- */
  async function selectBus(i) {
    state.route = state.filtered[i];
    state.selected = [];
    overlay(true, 'Loading seat map…');
    try {
      // which seats are already booked for this route on this date?
      const q = `/bus_bookings?route_id=eq.${state.route.id}`
        + `&journey_date=eq.${state.search.date}`
        + `&select=seats`;
      const rows = await sbGet(q);
      state.bookedSeats = rows.flatMap(r => r.seats || []);
      buildSeatLayout();
      renderSeatMap();
      renderBoardingDropping();
      updateSeatSummary();
      showView('view-seats');
    } catch (err) {
      console.error(err);
      toast('Could not load seats.', true);
    } finally {
      overlay(false);
    }
  }

  // Build seat objects based on bus_type. Returns {decks:[{name, rows:[[seat...]]}]}
  function buildSeatLayout() {
    const r = state.route;
    const bt = r.bus_type.toLowerCase();
    const isSleeper = bt.includes('sleeper');
    state.layout = isSleeper ? buildSleeper(r.total_seats) : buildSeater(r.total_seats);

    $('seats-title').textContent = `Select Seats — ${r.operator}`;
    $('seats-sub').textContent =
      `${state.search.from} → ${state.search.to} · ${prettyDate(state.search.date)} · ${r.bus_type} · Dep ${r.departure_time}`;
  }

  // Sleeper 2+1: two decks (Lower/Upper). Each deck: rows of [2 berths] + aisle + [1 berth].
  function buildSleeper(total) {
    const perDeck = Math.ceil(total / 2);
    const decks = [
      { name: 'Lower Deck', prefix: 'L', count: perDeck, sleeper: true },
      { name: 'Upper Deck', prefix: 'U', count: total - perDeck, sleeper: true }
    ];
    return decks.map(d => {
      const seats = [];
      for (let n = 1; n <= d.count; n++) seats.push(makeSeat(d.prefix + n, d.prefix + n, n));
      // arrange into rows: left column gets pairs, right column gets singles
      const rows = [];
      const cols = Math.ceil(d.count / 3);
      // Build column-major: each "row" visually = left-top, left-bottom (2) + right (1)
      let idx = 0;
      for (let c = 0; c < cols; c++) {
        const row = [];
        // left 2
        if (seats[idx]) row.push(seats[idx++]);
        if (seats[idx]) row.push(seats[idx++]);
        // spacer marker then right 1
        if (seats[idx]) row.push({ ...seats[idx++], _right: true });
        rows.push(row);
      }
      return { name: d.name, sleeper: true, rows };
    });
  }

  // Seater 2+2 or 2+1: single deck, rows of 4 (2 + aisle + 2)
  function buildSeater(total) {
    const seats = [];
    for (let n = 1; n <= total; n++) seats.push(makeSeat('S' + n, n, n));
    const rows = [];
    for (let i = 0; i < total; i += 4) {
      rows.push(seats.slice(i, i + 4));
    }
    return [{ name: 'Seater', sleeper: false, rows }];
  }

  function makeSeat(id, label, n) {
    return {
      id,
      label: String(label),
      ladies: false,                 // could flag specific seats as ladies-only
      booked: state.bookedSeats.includes(id)
    };
  }

  function renderSeatMap() {
    const map = $('seat-map');
    map.innerHTML = state.layout.map(deck => {
      const rowsHtml = deck.rows.map(row => {
        const cells = row.map(seat => {
          const cls = ['seat'];
          if (deck.sleeper) cls.push('sleeper');
          if (seat.ladies) cls.push('ladies');
          if (seat.booked) cls.push('booked');
          else if (state.selected.includes(seat.id)) cls.push('selected');
          const onclick = seat.booked ? '' : `onclick="App.toggleSeat('${seat.id}')"`;
          const spacer = seat._right ? '<span style="width:28px;display:inline-block"></span>' : '';
          return `${spacer}<div class="${cls.join(' ')}" data-seat="${seat.id}" ${onclick} title="Seat ${seat.label} · ${rupee(state.route.fare)}">${seat.label}</div>`;
        }).join('');
        return `<div class="deck-row">${cells}</div>`;
      }).join('');
      const steer = deck.sleeper ? '' : '<div class="deck-row" style="justify-content:flex-end"><span class="steering">🛞</span></div>';
      return `<div class="deck"><div class="deck-title">${deck.name}</div>${steer}<div class="deck-grid">${rowsHtml}</div></div>`;
    }).join('');
  }

  function toggleSeat(id) {
    const i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else {
      if (state.selected.length >= 6) { toast('Max 6 seats per booking', true); return; }
      state.selected.push(id);
    }
    renderSeatMap();
    updateSeatSummary();
  }

  function renderBoardingDropping() {
    const r = state.route;
    $('boarding-select').innerHTML = (r.boarding_points || [])
      .map((p, i) => `<option value="${i}">${p.name} · ${p.time}</option>`).join('');
    $('dropping-select').innerHTML = (r.dropping_points || [])
      .map((p, i) => `<option value="${i}">${p.name} · ${p.time}</option>`).join('');
  }

  function updateSeatSummary() {
    const n = state.selected.length;
    const total = n * Number(state.route.fare);
    $('selected-seats-text').textContent = n ? state.selected.join(', ') : 'No seats selected';
    $('seat-count').textContent = n;
    $('seat-total').textContent = rupee(total);
    $('to-passenger-btn').disabled = n === 0;
  }

  /* ---------------- Passenger details ---------------- */
  function toPassengerDetails() {
    if (!state.selected.length) return;
    const fields = $('passenger-fields');
    fields.innerHTML = state.selected.map((seat, i) => `
      <div class="passenger-block">
        <h4>Passenger ${i + 1}<span class="seat-badge">Seat ${seat}</span></h4>
        <div class="form-grid">
          <div class="form-field">
            <label>Full Name</label>
            <input type="text" data-pax="name" data-seat="${seat}" required />
          </div>
          <div class="form-field">
            <label>Age</label>
            <input type="number" min="1" max="120" data-pax="age" data-seat="${seat}" required />
          </div>
          <div class="form-field">
            <label>Gender</label>
            <select data-pax="gender" data-seat="${seat}">
              <option value="M">Male</option>
              <option value="F">Female</option>
              <option value="O">Other</option>
            </select>
          </div>
        </div>
      </div>`).join('');

    const total = state.selected.length * Number(state.route.fare);
    $('passenger-total').textContent = rupee(total);
    showView('view-passenger');
  }

  function collectPassengers() {
    return state.selected.map(seat => {
      const block = (attr) => document.querySelector(`[data-pax="${attr}"][data-seat="${seat}"]`);
      return {
        seat,
        name: block('name').value.trim(),
        age: Number(block('age').value),
        gender: block('gender').value
      };
    });
  }

  /* ---------------- Payment ---------------- */
  function toPayment(e) {
    if (e) e.preventDefault();
    const form = $('passenger-form');
    if (!form.checkValidity()) { form.reportValidity(); return; }
    const total = state.selected.length * Number(state.route.fare);
    $('pay-amount').textContent = rupee(total);
    showView('view-payment');
  }

  function generatePNR() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'MS';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async function confirmBooking() {
    const r = state.route;
    const passengers = collectPassengers();
    const bIdx = $('boarding-select').value || 0;
    const dIdx = $('dropping-select').value || 0;
    const total = state.selected.length * Number(r.fare);

    const booking = {
      pnr: generatePNR(),
      route_id: r.id,
      journey_date: state.search.date,
      source_city: r.source_city,
      destination_city: r.destination_city,
      operator: r.operator,
      bus_type: r.bus_type,
      departure_time: r.departure_time,
      arrival_time: r.arrival_time,
      seats: state.selected.slice(),
      passengers,
      boarding_point: r.boarding_points[bIdx] || null,
      dropping_point: r.dropping_points[dIdx] || null,
      contact_name: $('contact-name').value.trim(),
      contact_email: $('contact-email').value.trim(),
      contact_phone: $('contact-phone').value.trim(),
      total_fare: total,
      status: 'CONFIRMED'
    };

    $('pay-now-btn').disabled = true;
    overlay(true, 'Processing payment…');
    try {
      // Re-check seat availability to avoid double-booking
      const fresh = await sbGet(`/bus_bookings?route_id=eq.${r.id}&journey_date=eq.${state.search.date}&select=seats`);
      const taken = fresh.flatMap(x => x.seats || []);
      const clash = state.selected.filter(s => taken.includes(s));
      if (clash.length) {
        toast('Seats ' + clash.join(', ') + ' were just booked. Please pick again.', true);
        state.bookedSeats = taken;
        state.selected = state.selected.filter(s => !taken.includes(s));
        buildSeatLayout(); renderSeatMap(); updateSeatSummary();
        showView('view-seats');
        return;
      }

      const saved = await sbPost('bus_bookings', booking);
      state.booking = Array.isArray(saved) ? saved[0] : saved;
      renderTicket(state.booking);
      showView('view-ticket');
      toast('Booking confirmed! PNR ' + state.booking.pnr);
    } catch (err) {
      console.error(err);
      toast('Booking failed: ' + err.message, true);
    } finally {
      overlay(false);
      $('pay-now-btn').disabled = false;
    }
  }

  /* ---------------- Ticket ---------------- */
  function renderTicket(b) {
    const bp = b.boarding_point || {};
    const dp = b.dropping_point || {};
    const paxRows = (b.passengers || []).map(p =>
      `<tr><td>${p.name}</td><td>${p.age}</td><td>${p.gender}</td><td>${p.seat}</td></tr>`).join('');

    $('ticket-card').innerHTML = `
      <div class="ticket-top">
        <div>
          <div style="font-weight:600">${b.operator}</div>
          <div style="font-size:.82rem;opacity:.85">${b.bus_type}</div>
        </div>
        <div class="pnr">PNR<strong>${b.pnr}</strong></div>
      </div>
      <div class="ticket-body">
        <div class="ticket-route">
          <div class="ticket-city">${b.source_city}<small>${b.departure_time} · ${bp.name || ''}</small></div>
          <div class="ticket-arrow">▶</div>
          <div class="ticket-city">${b.destination_city}<small>${b.arrival_time} · ${dp.name || ''}</small></div>
        </div>
        <div class="ticket-grid">
          <div><div class="label">Journey Date</div><div class="val">${prettyDate(b.journey_date)}</div></div>
          <div><div class="label">Boarding</div><div class="val">${bp.name || '-'} (${bp.time || '-'})</div></div>
          <div><div class="label">Dropping</div><div class="val">${dp.name || '-'} (${dp.time || '-'})</div></div>
          <div><div class="label">Seats</div><div class="val">${(b.seats || []).join(', ')}</div></div>
          <div><div class="label">Contact</div><div class="val">${b.contact_phone}</div></div>
          <div><div class="label">Status</div><div class="val" style="color:var(--green)">${b.status}</div></div>
        </div>
        <div class="ticket-pax">
          <table>
            <thead><tr><th>Passenger</th><th>Age</th><th>Gender</th><th>Seat</th></tr></thead>
            <tbody>${paxRows}</tbody>
          </table>
          <div class="ticket-total">
            <span>Total Paid</span>
            <strong>${rupee(b.total_fare)}</strong>
          </div>
        </div>
      </div>`;
  }

  /* ---------- PDF e-ticket (boarding pass) ---------- */

  // QR as a PNG data-URL (most reliable for html2canvas). Falls back to '' if lib missing.
  function makeQRDataURL(text, size) {
    if (typeof window.QRCode === 'undefined') return '';
    try {
      const tmp = document.createElement('div');
      // qrcodejs draws synchronously onto a <canvas>
      new window.QRCode(tmp, {
        text: text, width: size, height: size,
        colorDark: '#1d3557', colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
      const cv = tmp.querySelector('canvas');
      if (cv) return cv.toDataURL('image/png');
      const img = tmp.querySelector('img');
      return img ? img.src : '';
    } catch (e) { console.warn('QR failed', e); return ''; }
  }

  // CODE128 barcode of the PNR as a PNG data-URL.
  function makeBarcodeDataURL(text) {
    if (typeof window.JsBarcode === 'undefined') return '';
    try {
      const cv = document.createElement('canvas');
      window.JsBarcode(cv, text, {
        format: 'CODE128', displayValue: false, height: 54, width: 2,
        margin: 0, lineColor: '#1d3557', background: '#ffffff'
      });
      return cv.toDataURL('image/png');
    } catch (e) { console.warn('Barcode failed', e); return ''; }
  }

  // Build the rich ticket DOM into #pdf-ticket and return the element.
  function buildPdfTicket(b) {
    const bp = b.boarding_point || {};
    const dp = b.dropping_point || {};
    const seats = b.seats || [];
    const route = state.route || {};
    const amenities = (route.amenities && route.amenities.length) ? route.amenities : null;

    // Fare breakdown (totals stay consistent: GST assumed included @5%)
    const total = Number(b.total_fare) || 0;
    const base  = Math.round(total / 1.05);
    const gst   = total - base;

    const paxRows = (b.passengers || []).map((p, i) =>
      `<tr><td>${i + 1}</td><td>${p.name}</td><td>${p.age}</td><td>${p.gender}</td><td><strong>${p.seat}</strong></td></tr>`
    ).join('');

    const amenHtml = amenities
      ? `<div class="pt-amen">${amenities.map(a => `<span>${a}</span>`).join('')}</div>` : '';

    // QR encodes the key trip facts so it can be scanned at boarding
    const qrPayload =
      `MS TRAVELS E-TICKET\nPNR:${b.pnr}\n${b.source_city}->${b.destination_city}\n` +
      `${prettyDate(b.journey_date)} ${b.departure_time}\nSeats:${seats.join(',')}\n` +
      `Passengers:${(b.passengers || []).length}\nFare:Rs.${total}`;
    const qrUrl = makeQRDataURL(qrPayload, 240);
    const bcUrl = makeBarcodeDataURL(b.pnr);

    const html = `
      <div class="pt">
        <div class="pt-watermark">MS TRAVELS</div>

        <div class="pt-head">
          <div class="pt-brand">
            <div class="pt-logo">MS</div>
            <div>
              <div class="pt-brand-name">MS Travels</div>
              <div class="pt-brand-sub">Safe • Reliable • On-time</div>
            </div>
          </div>
          <div class="pt-doc">
            <div class="pt-doc-type">E-Ticket / Boarding Pass</div>
            <div class="pt-doc-pnr">${b.pnr}</div>
          </div>
        </div>

        <div class="pt-stamp">✓ ${b.status || 'CONFIRMED'}</div>

        <div class="pt-route">
          <div class="pt-city from">
            <div class="name">${b.source_city}</div>
            <div class="time">${b.departure_time}</div>
            <div class="pt-place">${bp.name || ''}</div>
          </div>
          <div class="pt-mid">
            <div class="dur">${route.duration || ''}</div>
            <div class="line">———▶</div>
            <div class="bus-emoji">🚌</div>
          </div>
          <div class="pt-city to">
            <div class="name">${b.destination_city}</div>
            <div class="time">${b.arrival_time}</div>
            <div class="pt-place">${dp.name || ''}</div>
          </div>
        </div>

        <div class="pt-grid">
          <div class="pt-cell"><div class="lbl">Journey Date</div><div class="val">${prettyDate(b.journey_date)}</div></div>
          <div class="pt-cell"><div class="lbl">Bus Type</div><div class="val">${b.bus_type}</div></div>
          <div class="pt-cell"><div class="lbl">Boarding</div><div class="val">${bp.name || '-'}<br>${bp.time || ''}</div></div>
          <div class="pt-cell"><div class="lbl">Dropping</div><div class="val">${dp.name || '-'}<br>${dp.time || ''}</div></div>
        </div>

        <div class="pt-body">
          <div class="pt-pax">
            <h4>Passengers — Seats ${seats.join(', ')}</h4>
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Age</th><th>Gender</th><th>Seat</th></tr></thead>
              <tbody>${paxRows}</tbody>
            </table>
            ${amenHtml}
          </div>
          <div class="pt-side">
            <h4>Scan at Boarding</h4>
            <div class="pt-qr">${qrUrl ? `<img src="${qrUrl}" alt="QR">` : '<span style="font-size:.7rem;color:#9aa3b2">QR unavailable</span>'}</div>
            <div class="pt-scan">PNR ${b.pnr}</div>
            <div class="pt-fare">
              <div class="row"><span>Base Fare (${seats.length} × seat)</span><span>${rupee(base)}</span></div>
              <div class="row"><span>GST (5%, incl.)</span><span>${rupee(gst)}</span></div>
              <div class="row total"><span>Total Paid</span><span>${rupee(total)}</span></div>
            </div>
          </div>
        </div>

        <div class="pt-barcode">
          ${bcUrl ? `<img src="${bcUrl}" alt="barcode">` : ''}
          <div class="bc-pnr">${b.pnr}</div>
        </div>

        <div class="pt-notes">
          <h5>Boarding Instructions</h5>
          <ul>
            <li>Reach the boarding point at least <strong>15 minutes</strong> before departure (${b.departure_time}).</li>
            <li>Carry a valid government photo ID — it may be checked at boarding.</li>
            <li>Show this e-ticket (printed or on your phone); the QR/barcode will be scanned.</li>
            <li>Tickets are non-transferable. Baggage allowance: up to 15 kg per passenger.</li>
          </ul>
        </div>

        <div class="pt-quote">
          <div class="q">“The world is a book and those who do not travel read only one page.”</div>
          <div class="a">— Saint Augustine</div>
        </div>

        <div class="pt-foot">
          <span class="tag">🚌 Wishing you a safe &amp; happy journey!</span>
          <span class="contact">Helpline 1800-200-1234 • support@mstravels.demo • mstravels.demo</span>
        </div>
      </div>`;

    const host = document.getElementById('pdf-ticket');
    host.innerHTML = html;
    return host;
  }

  // Generate a PDF of the ticket and download it. We render the ticket to a
  // canvas, then place it on an A4 page scaled to FIT (so nothing is clipped).
  function downloadTicket() {
    const b = state.booking;
    if (!b) { toast('No ticket to download', true); return; }
    const filename = `MS-Travels-Ticket-${b.pnr || 'ticket'}.pdf`;

    const haveLibs = typeof window.html2canvas !== 'undefined'
      && window.jspdf && window.jspdf.jsPDF;
    if (!haveLibs) {
      toast('Preparing print view…');
      window.print();
      return;
    }

    overlay(true, 'Generating your ticket PDF…');
    const el = buildPdfTicket(b);

    // Small delay so the QR/barcode images paint before we capture.
    setTimeout(() => {
      window.html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' })
        .then((canvas) => {
          const imgData = canvas.toDataURL('image/jpeg', 0.98);
          const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4');
          const pageW = pdf.internal.pageSize.getWidth();   // 210mm
          const pageH = pdf.internal.pageSize.getHeight();  // 297mm
          const margin = 10;
          const availW = pageW - margin * 2;
          const availH = pageH - margin * 2;

          // Fit to width; if that makes it taller than the page, fit to height
          // instead so the whole ticket stays on a single A4 sheet.
          let w = availW;
          let h = canvas.height * w / canvas.width;
          if (h > availH) { h = availH; w = canvas.width * h / canvas.height; }

          const x = (pageW - w) / 2;     // centre horizontally
          const y = margin;              // top aligned
          pdf.addImage(imgData, 'JPEG', x, y, w, h);
          pdf.save(filename);
          toast('Ticket downloaded as ' + filename);
        })
        .catch((err) => {
          console.error(err);
          toast('Could not generate PDF — opening print view instead.', true);
          window.print();
        })
        .finally(() => overlay(false));
    }, 150);
  }

  // Kept for backwards compatibility (older button hook).
  function printTicket() { downloadTicket(); }

  /* ---------------- PNR lookup ---------------- */
  function openLookup() {
    $('lookup-result').innerHTML = '';
    $('lookup-pnr').value = '';
    showView('view-lookup');
  }

  async function lookupPNR(e) {
    if (e) e.preventDefault();
    const pnr = $('lookup-pnr').value.trim().toUpperCase();
    if (!pnr) return;
    overlay(true, 'Finding your ticket…');
    try {
      const rows = await sbGet(`/bus_bookings?pnr=eq.${encodeURIComponent(pnr)}&limit=1`);
      if (!rows.length) {
        $('lookup-result').innerHTML = `<div class="empty-state"><p>No booking found for PNR <strong>${pnr}</strong></p></div>`;
        return;
      }
      state.booking = rows[0];
      renderTicket(rows[0]);
      // move ticket markup into lookup view
      $('lookup-result').innerHTML = $('ticket-card').outerHTML;
    } catch (err) {
      console.error(err);
      toast('Lookup failed.', true);
    } finally {
      overlay(false);
    }
  }

  /* ---------------- Navigation ---------------- */
  function goHome() { showView('view-hero'); }
  function backToResults() { showView('view-results'); }
  function backToSeats() { showView('view-seats'); }

  /* ---------------- Expose ---------------- */
  window.App = {
    search, setDate, swapCities, applyFilters,
    selectBus, toggleSeat, toPassengerDetails, toPayment, confirmBooking,
    printTicket, downloadTicket, openLookup, lookupPNR,
    goHome, backToResults, backToSeats
  };

  document.addEventListener('DOMContentLoaded', init);
})();
