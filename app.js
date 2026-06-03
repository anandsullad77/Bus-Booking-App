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

  // ---- Supabase JS client (handles the email one-time-code login + session) ----
  const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // ---- App state ----
  const state = {
    allRoutes: [],        // routes returned by last search
    filtered: [],
    search: { from: '', to: '', date: '' },
    route: null,          // selected route
    bookedSeats: [],      // seat ids already booked for this route+date
    seatLayout: [],       // generated seat objects
    selected: [],         // selected seat ids
    booking: null,        // final / currently viewed booking record
    user: null,           // signed-in user (My Bookings)
    pendingEmail: '',     // email awaiting code verification
    myBookings: [],       // bookings for the signed-in user
    activeRoutes: [],     // all active routes (for city list + popular routes)
    holdTimer: null,      // seat-hold countdown interval
    holdExpiresAt: 0,     // epoch ms when the current seat selection "expires"
    holdToken: null,      // server-side seat-hold token for this selection
    activeDeck: 0,        // which deck is shown (sleeper Lower/Upper toggle)
    afterAuth: null       // callback to resume after checkout sign-in
  };

  // Fallback only — the real city list is derived from active routes at init so
  // we never suggest a city we don't actually serve.
  const CITIES = ['Bangalore', 'Hyderabad', 'Mumbai', 'Pune', 'Goa', 'Chennai'];

  /* ---------------- Helpers ---------------- */
  const $  = (id) => document.getElementById(id);
  const rupee = (n) => '₹' + Number(n).toLocaleString('en-IN');

  // GST is assumed included @5% (matches the e-ticket PDF math). Split a gross
  // total into base + tax for a transparent, pre-payment fare breakdown.
  function fareBreakdown(total) {
    const t = Number(total) || 0;
    const base = Math.round(t / 1.05);
    return { base, gst: t - base, total: t };
  }

  function fareBreakdownHtml(seatCount, fare) {
    const total = seatCount * Number(fare);
    const { base, gst } = fareBreakdown(total);
    return `
      <div class="fare-row"><span>Base fare (${seatCount} × ${rupee(fare)})</span><span>${rupee(base)}</span></div>
      <div class="fare-row"><span>GST (5%, incl.)</span><span>${rupee(gst)}</span></div>
      <div class="fare-row total"><span>Total payable</span><span>${rupee(total)}</span></div>`;
  }

  // Pre-purchase refund window, computed from this route's departure on the
  // chosen journey date (mirrors the post-booking cancellationInfo tiers).
  function preCancelPolicyHtml(route, dateStr) {
    if (!route || !dateStr) return '';
    const time = /^\d{1,2}:\d{2}/.test(route.departure_time) ? route.departure_time : '00:00';
    const dep = new Date(dateStr + 'T' + time + ':00');
    const cutoff = new Date(dep.getTime() - 24 * 36e5);
    const when = cutoff.toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `<span class="cancel-policy-icon">↩</span> Cancel by <strong>${when}</strong> for a 90% refund · <a href="#" onclick="App.openHelp();return false;">full policy</a>`;
  }

  function showView(id) {
    // close the mobile filter sheet on any navigation
    const f = $('filters'); if (f) f.classList.remove('open', 'mode-sort', 'mode-filter');
    const fb = $('filters-backdrop'); if (fb) fb.hidden = true;
    document.body.classList.remove('sheet-open');

    document.querySelectorAll('.view, .hero').forEach(v => v.hidden = true);
    const el = $(id);
    if (el) el.hidden = false;
    document.body.setAttribute('data-view', id);   // drives bottom-nav visibility/active state
    window.scrollTo({ top: 0, behavior: 'smooth' });
    // move focus to the view's heading so screen-reader / keyboard users land in
    // the new content instead of being stranded at the top of the old view.
    if (el) {
      const h = el.querySelector('h1, h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
  }

  // Skip-link target: focus the heading of whatever view is currently shown.
  function skipToContent() {
    const v = document.querySelector('.view:not([hidden]), .hero:not([hidden])');
    const h = v && v.querySelector('h1, h2');
    if (h) { h.setAttribute('tabindex', '-1'); h.focus(); }
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

  // Insert without asking for the row back. Anonymous checkout can write a
  // booking but (by design) cannot read the bookings table, so requesting a
  // representation would fail RLS — we already hold all the fields locally.
  async function sbInsert(table, body) {
    const res = await fetch(REST + '/' + table, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Supabase POST ' + res.status + ': ' + (await res.text()));
  }

  // Call a Postgres function (e.g. booked_seats) via PostgREST RPC.
  async function sbRpc(fn, body) {
    const res = await fetch(REST + '/rpc/' + fn, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Supabase RPC ' + res.status + ': ' + (await res.text()));
    return res.json();
  }

  /* ---------------- Init ---------------- */
  function init() {
    document.body.setAttribute('data-view', 'view-hero');
    // default date = today
    $('journey-date').value = todayStr(0);
    $('journey-date').min = todayStr(0);
    // seed the datalist with the fallback list, then refine from live inventory
    setCityList(CITIES);
    loadActiveRoutes();
    renderDateStrip();
    $('journey-date').addEventListener('change', syncDateStrip);
  }

  // Build a swipeable strip of the next 14 days; tapping one sets the date.
  function renderDateStrip() {
    const strip = $('date-strip');
    if (!strip) return;
    const cur = $('journey-date').value;
    strip.innerHTML = Array.from({ length: 14 }).map((_, i) => {
      const ds = todayStr(i);
      const d = new Date(ds + 'T00:00:00');
      const dow = d.toLocaleDateString('en-IN', { weekday: 'short' });
      const lbl = i === 0 ? 'Today' : (i === 1 ? 'Tom' : dow);
      const mon = d.toLocaleDateString('en-IN', { month: 'short' });
      return `<button type="button" class="ds-day${ds === cur ? ' active' : ''}" data-date="${ds}"
        aria-pressed="${ds === cur}" onclick="App.pickDate('${ds}')">
        <span class="ds-dow">${lbl}</span><span class="ds-num">${d.getDate()}</span><span class="ds-mon">${mon}</span>
      </button>`;
    }).join('');
  }

  function pickDate(ds) {
    $('journey-date').value = ds;
    syncDateStrip();
  }

  // Reflect the current #journey-date value as the active strip cell.
  function syncDateStrip() {
    const cur = $('journey-date').value;
    document.querySelectorAll('#date-strip .ds-day').forEach(b => {
      const on = b.getAttribute('data-date') === cur;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
  }

  // Pull every active route once so the city autocomplete and the "popular
  // routes" chips reflect inventory we can actually fulfil (no phantom cities).
  async function loadActiveRoutes() {
    try {
      const rows = await sbGet('/bus_routes?is_active=eq.true'
        + '&select=source_city,destination_city,fare&order=fare.asc');
      state.activeRoutes = Array.isArray(rows) ? rows : [];
      const cities = [...new Set(
        state.activeRoutes.flatMap(r => [r.source_city, r.destination_city])
      )].sort();
      if (cities.length) setCityList(cities);
      renderPopularRoutes();
    } catch (err) {
      console.warn('Could not load active routes (using fallback city list):', err);
    }
  }

  function setCityList(cities) {
    $('city-list').innerHTML = cities.map(c => `<option value="${c}">`).join('');
  }

  // Render up to 6 cheapest distinct routes as one-tap chips in the hero.
  function renderPopularRoutes() {
    const seen = new Set();
    const routes = [];
    for (const r of state.activeRoutes) {
      const key = r.source_city + '→' + r.destination_city;
      if (seen.has(key)) continue;
      seen.add(key);
      routes.push(r);
      if (routes.length >= 6) break;
    }
    const wrap = $('popular-routes');
    if (!routes.length) { wrap.hidden = true; return; }
    $('popular-chips').innerHTML = routes.map(r =>
      `<button type="button" class="route-chip"
         onclick="App.quickSearch('${r.source_city}','${r.destination_city}')">
         ${r.source_city} → ${r.destination_city}
         <span class="route-chip-fare">${rupee(r.fare)}</span>
       </button>`).join('');
    wrap.hidden = false;
  }

  // Prefill the search form from a chip and run the search immediately.
  function quickSearch(from, to) {
    $('from-city').value = from;
    $('to-city').value = to;
    if (!$('journey-date').value) $('journey-date').value = todayStr(0);
    goHome();
    search();
  }

  // Days from today until the upcoming weekend (Saturday). Used by the chip.
  function daysToWeekend() {
    const day = new Date().getDay();            // 0 Sun … 6 Sat
    return day === 6 ? 0 : (6 - day);
  }

  /* ---------------- Search ---------------- */
  function setDate(offset) {
    $('journey-date').value = todayStr(offset);
    syncDateStrip();
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
    showResultsSkeleton();                 // jump to results with placeholders, no blank overlay
    try {
      // case-insensitive match on source + destination, active only
      const q = `/bus_routes?is_active=eq.true`
        + `&source_city=ilike.${encodeURIComponent(from)}`
        + `&destination_city=ilike.${encodeURIComponent(to)}`
        + `&order=departure_time.asc`;
      state.allRoutes = await sbGet(q);
      state.filtered = state.allRoutes.slice();
      renderAmenityFilters();
      renderResults();
    } catch (err) {
      console.error(err);
      $('results-meta').textContent = '';
      $('results-list').innerHTML = `<div class="empty-state">
        <h3>Couldn't load buses</h3>
        <p>Please check your connection and try again.</p>
        <button class="primary-btn" onclick="App.search()">Retry</button>
        <p class="muted small" style="margin-top:14px"><a href="#" onclick="App.openHelp();return false;">Contact support</a></p>
      </div>`;
    }
  }

  // Placeholder bus-cards while the search request is in flight (no full-screen
  // overlay — the user sees the results shell immediately).
  function showResultsSkeleton() {
    const { from, to } = state.search;
    $('results-route').textContent = `${from} → ${to}`;
    $('results-meta').textContent = 'Searching…';
    $('results-list').innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="bus-card skeleton-card" aria-hidden="true">
        <div class="bus-main">
          <div class="sk sk-line w40"></div>
          <div class="sk sk-line w25"></div>
          <div class="sk sk-line w70"></div>
          <div class="sk sk-line w55"></div>
        </div>
        <div class="bus-side">
          <div class="sk sk-pill"></div>
          <div class="sk sk-line w30"></div>
          <div class="sk sk-btn"></div>
        </div>
      </div>`).join('');
    showView('view-results');
  }

  // Placeholder seat grid while booked seats load.
  function showSeatSkeleton(route) {
    $('seats-title').textContent = `Select Seats — ${route.operator}`;
    $('seats-sub').textContent = `${state.search.from} → ${state.search.to} · ${prettyDate(state.search.date)} · ${route.bus_type}`;
    const rows = Array.from({ length: 6 }).map(() =>
      `<div class="deck-row">${Array.from({ length: 4 }).map(() => '<div class="sk sk-seat"></div>').join('')}</div>`).join('');
    $('seat-map').innerHTML = `<div class="deck"><div class="sk sk-line w30" style="margin-bottom:14px"></div><div class="deck-grid">${rows}</div></div>`;
    showView('view-seats');
  }

  /* ---------------- Results ---------------- */
  // Convert a "08h 30m" / "8h30" style string into total minutes for sorting.
  function durationMinutes(s) {
    const m = String(s || '').match(/(\d+)\s*h.*?(\d+)?\s*m?/i);
    if (!m) return 1e9;
    return parseInt(m[1], 10) * 60 + (m[2] ? parseInt(m[2], 10) : 0);
  }

  function renderResults() {
    const { from, to, date } = state.search;
    $('results-route').textContent = `${from} → ${to}`;
    $('results-meta').textContent = `${prettyDate(date)} · ${state.filtered.length} bus(es) found`;

    const list = $('results-list');
    if (!state.filtered.length) {
      list.innerHTML = renderEmptyResults();
      return;
    }

    list.innerHTML = state.filtered.map((r, i) => {
      const amen = (r.amenities || []).slice(0, 4)
        .map(a => `<span class="amenity-tag">${a}</span>`).join('');
      const bp = (r.boarding_points || [])[0];
      const dp = (r.dropping_points || [])[0];
      const points = (bp || dp)
        ? `<div class="bus-points muted small">Boards ${bp ? bp.name + ' ' + bp.time : '—'} · Drops ${dp ? dp.name : '—'}</div>`
        : '';
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
          ${points}
          <div class="bus-cancel muted small">Cancel up to 24h before for a 90% refund</div>
        </div>
        <div class="bus-side">
          <span class="bus-rating">★ ${r.rating}</span>
          <div class="bus-fare">${rupee(r.fare)}<small> / seat</small></div>
          <div class="bus-seats-left" data-seats-left="${r.id}">Checking seats…</div>
          <button class="select-seat-btn" onclick="App.selectBus(${i})">Select seats</button>
        </div>
      </div>`;
    }).join('');

    loadSeatsLeft();
  }

  // Turn the "no buses" dead-end into a recovery surface: real routes as chips.
  function renderEmptyResults() {
    const { from, to } = state.search;
    const seen = new Set();
    const chips = [];
    for (const r of state.activeRoutes) {
      const key = r.source_city + '→' + r.destination_city;
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push(`<button type="button" class="route-chip"
        onclick="App.quickSearch('${r.source_city}','${r.destination_city}')">
        ${r.source_city} → ${r.destination_city}
        <span class="route-chip-fare">${rupee(r.fare)}</span></button>`);
      if (chips.length >= 8) break;
    }
    const chipHtml = chips.length
      ? `<p>Here are routes we run right now:</p><div class="popular-chips center">${chips.join('')}</div>`
      : '';
    return `<div class="empty-state">
      <h3>We don't run ${from} → ${to} yet</h3>
      ${chipHtml}
      <p class="muted small" style="margin-top:18px">Want this route? <a href="#" onclick="App.openHelp();return false;">Tell us</a> and we'll notify you when it opens.</p>
    </div>`;
  }

  // Fetch booked-seat counts per visible route and fill in the "N seats left"
  // badges. Best-effort and non-blocking — the list already rendered.
  async function loadSeatsLeft() {
    await Promise.all(state.filtered.map(async (r) => {
      try {
        const seats = await sbRpc('booked_seats', { p_route_id: r.id, p_journey_date: state.search.date });
        const booked = Array.isArray(seats) ? seats.length : 0;
        r._seatsLeft = Math.max(0, Number(r.total_seats || 0) - booked);
      } catch (_) { r._seatsLeft = null; }
      const el = document.querySelector(`[data-seats-left="${r.id}"]`);
      if (!el) return;
      if (r._seatsLeft == null) { el.textContent = ''; return; }
      if (r._seatsLeft === 0) { el.textContent = 'Sold out'; el.className = 'bus-seats-left sold-out'; return; }
      const urgent = r._seatsLeft <= 5;
      el.textContent = `${r._seatsLeft} seat${r._seatsLeft === 1 ? '' : 's'} left`;
      el.className = 'bus-seats-left' + (urgent ? ' urgent' : '');
    }));
  }

  function onPriceInput() {
    const v = $('f-price').value;
    $('f-price-val').textContent = Number(v) >= 2000 ? 'Up to ₹2,000+' : 'Up to ' + rupee(v);
  }

  // Build the amenity checkboxes from the amenities actually present in results.
  function renderAmenityFilters() {
    const wrap = $('amenity-options');
    if (!wrap) return;
    const set = new Set();
    state.allRoutes.forEach(r => (r.amenities || []).forEach(a => set.add(a)));
    const opts = [...set].sort();
    wrap.innerHTML = opts.length
      ? opts.map(a => `<label><input type="checkbox" class="f-amenity" value="${a}" onchange="App.applyFilters()"> ${a}</label>`).join('')
      : '<span class="muted small">No amenity data</span>';
  }

  function applyFilters() {
    const types = [...document.querySelectorAll('.f-type:checked')].map(c => c.value);
    const times = [...document.querySelectorAll('.f-time:checked')].map(c => c.value);
    const amens = [...document.querySelectorAll('.f-amenity:checked')].map(c => c.value);
    const maxPrice = Number(($('f-price') || {}).value || 1e9);
    const minRating = Number((document.querySelector('.f-rating:checked') || {}).value || 0);
    const sortBy = ($('sort-by') || {}).value || 'departure';

    let rows = state.allRoutes.filter(r => {
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
      // amenities: route must offer every selected amenity
      if (amens.length && !amens.every(a => (r.amenities || []).includes(a))) return false;
      if (Number(r.fare) > maxPrice && maxPrice < 2000) return false;
      if (Number(r.rating) < minRating) return false;
      return true;
    });

    rows.sort((a, b) => {
      switch (sortBy) {
        case 'price-asc':  return a.fare - b.fare;
        case 'price-desc': return b.fare - a.fare;
        case 'duration':   return durationMinutes(a.duration) - durationMinutes(b.duration);
        case 'rating':     return b.rating - a.rating;
        case 'seats':      return (b._seatsLeft ?? -1) - (a._seatsLeft ?? -1);
        default:           return a.departure_time.localeCompare(b.departure_time);
      }
    });

    state.filtered = rows;
    renderResults();
  }

  /* ---------------- Seat selection ---------------- */
  async function selectBus(i) {
    state.route = state.filtered[i];
    state.selected = [];
    await releaseHold();                   // free any prior holds before re-reading availability
    showSeatSkeleton(state.route);         // show the seat shell immediately
    try {
      // which seats are already booked for this route on this date?
      const seats = await sbRpc('booked_seats', {
        p_route_id: state.route.id,
        p_journey_date: state.search.date
      });
      state.bookedSeats = Array.isArray(seats) ? seats : [];
      buildSeatLayout();
      renderSeatMap();
      renderBoardingDropping();
      updateSeatSummary();
    } catch (err) {
      console.error(err);
      toast('Could not load seats. Please try again.', true);
      backToResults();
    }
  }

  // Build seat objects based on bus_type. Returns {decks:[{name, rows:[[seat...]]}]}
  function buildSeatLayout() {
    const r = state.route;
    const bt = r.bus_type.toLowerCase();
    const isSleeper = bt.includes('sleeper');
    // Ladies seats are data-driven: a route may carry a `ladies_seats` array of
    // seat ids. When absent, there are simply no ladies seats (and the legend is
    // hidden) — no more advertising a state that can never occur.
    state.ladiesSeats = new Set(Array.isArray(r.ladies_seats) ? r.ladies_seats : []);
    state.activeDeck = 0;            // default to the first (Lower) deck
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
      ladies: state.ladiesSeats ? state.ladiesSeats.has(id) : false,
      booked: state.bookedSeats.includes(id)
    };
  }

  // Render a single deck's seats (used for the active deck or a single-deck bus).
  function renderDeck(deck, withTitle) {
    const rowsHtml = deck.rows.map(row => {
      const cells = row.map(seat => {
        const cls = ['seat'];
        if (deck.sleeper) cls.push('sleeper');
        if (seat.ladies) cls.push('ladies');
        const selected = !seat.booked && state.selected.includes(seat.id);
        if (seat.booked) cls.push('booked');
        else if (selected) cls.push('selected');
        // Status conveyed by text + icon (::after), not colour alone.
        const status = seat.booked ? 'booked' : (selected ? 'selected' : 'available');
        const label = `Seat ${seat.label}${seat.ladies ? ', ladies' : ''}, ${rupee(state.route.fare)}, ${status}`;
        const onclick = seat.booked ? '' : `onclick="App.toggleSeat('${seat.id}')"`;
        const spacer = seat._right ? '<span class="aisle-spacer" aria-hidden="true"></span>' : '';
        return `${spacer}<button type="button" class="${cls.join(' ')}" data-seat="${seat.id}"
          ${seat.booked ? 'disabled aria-disabled="true"' : `aria-pressed="${selected}"`}
          aria-label="${label}" title="${label}" ${onclick}>${seat.label}</button>`;
      }).join('');
      return `<div class="deck-row">${cells}</div>`;
    }).join('');
    const steer = deck.sleeper ? '' : '<div class="deck-row" style="justify-content:flex-end"><span class="steering">🛞</span></div>';
    const title = withTitle ? `<div class="deck-title">${deck.name}</div>` : '';
    return `<div class="deck">${title}${steer}<div class="deck-grid">${rowsHtml}</div></div>`;
  }

  function renderSeatMap() {
    // Only show the "Ladies" legend if this bus actually has ladies seats.
    const hasLadies = state.layout.some(d => d.rows.some(row => row.some(s => s.ladies)));
    const ll = $('legend-ladies');
    if (ll) ll.hidden = !hasLadies;

    const decks = state.layout;
    const multi = decks.length > 1;
    if (state.activeDeck == null || state.activeDeck >= decks.length) state.activeDeck = 0;

    const map = $('seat-map');
    if (multi) {
      // One deck at a time, switchable with tabs (e.g. Lower Deck / Upper Deck).
      const tabs = `<div class="deck-tabs" role="tablist" aria-label="Choose deck">` + decks.map((d, i) => {
        const n = d.rows.reduce((a, r) => a + r.filter(s => !s.booked).length, 0);
        return `<button type="button" class="deck-tab${i === state.activeDeck ? ' active' : ''}"
          role="tab" aria-selected="${i === state.activeDeck}" onclick="App.switchDeck(${i})">
          ${d.name}<span class="deck-tab-count">${n} free</span></button>`;
      }).join('') + `</div>`;
      map.innerHTML = tabs + renderDeck(decks[state.activeDeck], false);
    } else {
      map.innerHTML = decks.map(d => renderDeck(d, false)).join('');
    }
  }

  function switchDeck(i) {
    state.activeDeck = i;
    renderSeatMap();
  }

  function toggleSeat(id) {
    const i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1);
    else {
      if (state.selected.length >= 6) { toast('Max 6 seats per booking', true); return; }
      state.selected.push(id);
    }
    renderSeatMap();        // optimistic
    updateSeatSummary();
    syncHold();             // reserve on the server (reconciles conflicts)
  }

  /* -------- Seat hold (server-backed, with a visible countdown) --------
     Each selection holds the seats server-side via hold_seats() so a second
     buyer can't reach payment for the same berth; booked_seats unions live
     holds. hold_seats clears and re-inserts THIS token's holds, so it reports
     only seats taken by *others* — no self-greying. */
  const HOLD_MS = 8 * 60 * 1000;
  const HOLD_MINUTES = 8;

  function newHoldToken() {
    return 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // Serialize hold calls so rapid toggles don't race on the same token.
  let holdQueue = Promise.resolve();
  function syncHold() {
    holdQueue = holdQueue.then(doSyncHold).catch(() => {});
    return holdQueue;
  }

  async function doSyncHold() {
    if (!state.selected.length) { await releaseHold(); return; }
    if (!state.holdToken) state.holdToken = newHoldToken();
    try {
      const res = await sbRpc('hold_seats', {
        p_route_id: state.route.id,
        p_journey_date: state.search.date,
        p_seats: state.selected,
        p_token: state.holdToken,
        p_minutes: HOLD_MINUTES
      });
      const conflicts = (res && res.conflicts) || [];
      if (conflicts.length) {
        state.bookedSeats = [...new Set([...state.bookedSeats, ...conflicts])];
        state.selected = state.selected.filter(s => !conflicts.includes(s));
        buildSeatLayout(); renderSeatMap(); updateSeatSummary();
        toast('Seat ' + conflicts.join(', ') + ' was just taken — please choose another.', true);
      }
      if (state.selected.length) startHold(); else stopHold();
    } catch (err) {
      // Degrade gracefully: keep the visual timer even if the hold RPC failed.
      console.warn('hold_seats failed (keeping client timer):', err);
      if (state.selected.length) startHold();
    }
  }

  // Release this session's server holds (and stop the countdown).
  async function releaseHold() {
    stopHold();
    const token = state.holdToken;
    state.holdToken = null;
    if (!token) return;
    try {
      // release_seats returns void (204) — fetch directly to avoid JSON parsing.
      await fetch(REST + '/rpc/release_seats', {
        method: 'POST', headers: HEADERS, body: JSON.stringify({ p_token: token })
      });
    } catch (_) { /* best-effort; holds also auto-expire */ }
  }

  function startHold() {
    if (!state.holdTimer) {
      state.holdExpiresAt = Date.now() + HOLD_MS;
      tickHold();
      state.holdTimer = setInterval(tickHold, 1000);
    }
    $('hold-timer').hidden = false;
  }

  function tickHold() {
    const left = state.holdExpiresAt - Date.now();
    if (left <= 0) { expireHold(); return; }
    const m = Math.floor(left / 60000);
    const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
    $('hold-timer').textContent = `⏳ Seats held for ${m}:${s} — finish before the timer ends`;
    const sh = $('sab-hold');
    if (sh) sh.textContent = `⏳ ${m}:${s}`;
  }

  function stopHold() {
    if (state.holdTimer) { clearInterval(state.holdTimer); state.holdTimer = null; }
    state.holdExpiresAt = 0;
    const t = $('hold-timer');
    if (t) { t.hidden = true; t.textContent = ''; }
    const sh = $('sab-hold');
    if (sh) sh.textContent = '';
  }

  function expireHold() {
    releaseHold();
    state.selected = [];
    renderSeatMap();
    updateSeatSummary();
    toast('Your seat hold expired — please select your seats again.', true);
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
    // mirror into the mobile sticky action bar
    const sab = $('sab-summary');
    if (sab) sab.textContent = n ? `${n} seat${n > 1 ? 's' : ''} · ${rupee(total)}` : 'Select your seats';
    const sabBtn = $('sab-continue');
    if (sabBtn) sabBtn.disabled = n === 0;
  }

  /* ---------------- Passenger details ---------------- */
  // Gate the booking behind a verified sign-in. Browsing and seat selection
  // stay anonymous; the moment we collect passengers we require a verified
  // email, so every ticket is tied to an identity the buyer can sign back into.
  function toPassengerDetails() {
    if (!state.selected.length) return;
    ensureSignedIn(proceedToPassengerDetails);
  }

  async function proceedToPassengerDetails() {
    if (!state.selected.length) return;

    // Refresh the server hold before collecting details. hold_seats re-reserves
    // this token's seats and returns only those grabbed by *others* — so a clash
    // is caught here (cheap) rather than after the whole form at Pay Now.
    try {
      const res = await sbRpc('hold_seats', {
        p_route_id: state.route.id, p_journey_date: state.search.date,
        p_seats: state.selected, p_token: state.holdToken || (state.holdToken = newHoldToken()),
        p_minutes: HOLD_MINUTES
      });
      const conflicts = (res && res.conflicts) || [];
      if (conflicts.length) {
        state.bookedSeats = [...new Set([...state.bookedSeats, ...conflicts])];
        state.selected = state.selected.filter(s => !conflicts.includes(s));
        buildSeatLayout(); renderSeatMap(); updateSeatSummary();
        if (state.selected.length) startHold(); else stopHold();
        toast('Seat ' + conflicts.join(', ') + ' was just taken — choose another. Your other seats are still held.', true);
        return;
      }
    } catch (_) { /* non-blocking: fall through to the form */ }

    const fields = $('passenger-fields');
    fields.innerHTML = state.selected.map((seat, i) => {
      const isLadies = state.ladiesSeats && state.ladiesSeats.has(seat);
      const genderField = isLadies
        ? `<select data-pax="gender" data-seat="${seat}"><option value="F">Female</option></select>
           <span class="ladies-note">♀ Ladies seat — female travellers only</span>`
        : `<select data-pax="gender" data-seat="${seat}">
             <option value="M">Male</option><option value="F">Female</option><option value="O">Other</option>
           </select>`;
      return `
      <div class="passenger-block">
        <h4>Passenger ${i + 1}<span class="seat-badge">Seat ${seat}${isLadies ? ' ♀' : ''}</span></h4>
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
            ${genderField}
          </div>
        </div>
      </div>`;
    }).join('');

    // Tie the ticket to the verified identity: prefill + lock the contact email.
    const ce = $('contact-email');
    if (state.user && state.user.email) {
      ce.value = state.user.email;
      ce.readOnly = true;
      ce.classList.add('locked');
    }

    const total = state.selected.length * Number(state.route.fare);
    $('passenger-total').textContent = rupee(total);
    $('passenger-breakdown').innerHTML = fareBreakdownHtml(state.selected.length, state.route.fare);
    showView('view-passenger');
  }

  /* ---------------- Checkout sign-in (email OTP) ---------------- */
  // Ensure there's a verified session, then run `cb`. If not signed in, open the
  // auth modal and defer `cb` until verification succeeds.
  async function ensureSignedIn(cb) {
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session && session.user) { state.user = session.user; cb(); return; }
    } catch (_) { /* fall through to the modal */ }
    state.afterAuth = cb;
    openAuthModal();
  }

  function openAuthModal() {
    $('auth-email').value = (state.user && state.user.email) || '';
    $('auth-email-form').hidden = false;
    $('auth-code-form').hidden = true;
    $('auth-overlay').hidden = false;
    setTimeout(() => $('auth-email').focus(), 50);
  }

  function cancelAuth() {
    $('auth-overlay').hidden = true;
    state.afterAuth = null;
  }

  function authBackToEmail() {
    $('auth-email-form').hidden = false;
    $('auth-code-form').hidden = true;
  }

  async function checkoutSendCode(e) {
    if (e) e.preventDefault();
    const email = $('auth-email').value.trim();
    if (!email) return;
    overlay(true, 'Sending your code…');
    try {
      const { error } = await sbClient.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      state.pendingEmail = email;
      $('auth-email-echo').textContent = email;
      $('auth-code').value = '';
      $('auth-email-form').hidden = true;
      $('auth-code-form').hidden = false;
      setTimeout(() => $('auth-code').focus(), 50);
    } catch (err) {
      console.error(err);
      toast('Could not send code: ' + err.message, true);
    } finally {
      overlay(false);
    }
  }

  async function checkoutVerifyCode(e) {
    if (e) e.preventDefault();
    const token = $('auth-code').value.trim();
    const email = state.pendingEmail;
    if (!token || !email) return;
    overlay(true, 'Verifying…');
    try {
      const { data, error } = await sbClient.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      state.user = data.user;
      $('auth-overlay').hidden = true;
      toast('Signed in as ' + email);
      const cb = state.afterAuth;
      state.afterAuth = null;
      if (cb) cb();
    } catch (err) {
      console.error(err);
      toast('Invalid or expired code. Please try again.', true);
    } finally {
      overlay(false);
    }
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
    $('pay-breakdown').innerHTML = fareBreakdownHtml(state.selected.length, state.route.fare);
    $('pay-cancel-policy').innerHTML = preCancelPolicyHtml(state.route, state.search.date);
    $('pay-now-btn').textContent = 'Pay ' + rupee(total);
    showView('view-payment');
  }

  function generatePNR() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = 'MS';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  async function confirmBooking() {
    // Defensive: never write a booking without a verified identity.
    if (!state.user || !state.user.email) {
      ensureSignedIn(confirmBooking);
      return;
    }
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
      // always the verified sign-in email, so the buyer can retrieve the ticket
      contact_email: (state.user && state.user.email) || $('contact-email').value.trim(),
      contact_phone: $('contact-phone').value.trim(),
      total_fare: total,
      status: 'CONFIRMED'
    };

    $('pay-now-btn').disabled = true;
    overlay(true, 'Processing payment…');
    try {
      // The DB trigger (prevent_double_booking) is the authoritative guard: it
      // rejects the insert if any seat was CONFIRMED by someone else, even past
      // a client race, and consumes our holds on success.
      await sbInsert('bus_bookings', booking);
      await releaseHold();
      state.booking = booking;
      rememberBooking(booking);
      renderTicket(state.booking);
      showView('view-ticket');
      $('pay-now-btn').textContent = 'Pay Now';
      toast('Booking confirmed! PNR ' + state.booking.pnr);
      sendTicketEmail(state.booking);   // email the e-ticket (updates status line)
    } catch (err) {
      console.error(err);
      // 23505 / "already booked" => a seat was taken at the last moment.
      const msg = String(err && err.message || '');
      if (/already booked|duplicate|23505/i.test(msg)) {
        toast('One of your seats was just taken — please pick again.', true);
        try {
          const fresh = await sbRpc('booked_seats', { p_route_id: r.id, p_journey_date: state.search.date });
          state.bookedSeats = Array.isArray(fresh) ? fresh : [];
        } catch (_) {}
        buildSeatLayout(); renderSeatMap(); updateSeatSummary();
        showView('view-seats');
      } else {
        toast('Something went wrong and your booking didn’t go through. You were not charged — please try again, or call 1800-200-1234.', true);
      }
    } finally {
      overlay(false);
      $('pay-now-btn').disabled = false;
    }
  }

  // Keep a local breadcrumb so a returning anonymous buyer can recover the
  // ticket (My Bookings prefill / "find by PNR") even before any email arrives.
  function rememberBooking(b) {
    try {
      const list = JSON.parse(localStorage.getItem('ms_recent_bookings') || '[]');
      list.unshift({ pnr: b.pnr, email: b.contact_email, date: b.journey_date,
        route: b.source_city + ' → ' + b.destination_city });
      localStorage.setItem('ms_recent_bookings', JSON.stringify(list.slice(0, 10)));
    } catch (_) { /* storage may be unavailable; non-critical */ }
  }

  // Email the e-ticket via the send-ticket Edge Function. Non-blocking for the
  // booking, but we now reflect the real outcome in a status line with a Resend
  // control, so a silent failure never strands the buyer without a ticket.
  async function sendTicketEmail(b) {
    const el = $('ticket-email-status');
    if (el) { el.className = 'email-status sending'; el.textContent = 'Emailing your ticket to ' + b.contact_email + '…'; }
    try {
      const { error } = await sbClient.functions.invoke('send-ticket', { body: { booking: b } });
      if (error) throw error;
      if (el) { el.className = 'email-status ok'; el.textContent = '✓ Ticket emailed to ' + b.contact_email; }
    } catch (err) {
      console.warn('Ticket email failed (booking still confirmed):', err);
      if (el) {
        el.className = 'email-status fail';
        el.innerHTML = `We couldn't email your ticket to ${b.contact_email}. `
          + `<button type="button" class="link-btn" onclick="App.resendTicket()">Resend</button> `
          + `or download it below.`;
      }
    }
  }

  function resendTicket() {
    if (state.booking) sendTicketEmail(state.booking);
  }

  // Copy the PNR to the clipboard for safe-keeping.
  function copyPNR() {
    const pnr = state.booking && state.booking.pnr;
    if (!pnr) return;
    const done = () => toast('PNR ' + pnr + ' copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(pnr).then(done).catch(done);
    } else { done(); }
  }

  // Download an .ics calendar invite for the journey (departure → arrival).
  function addToCalendar() {
    const b = state.booking;
    if (!b) return;
    const pad = (n) => String(n).padStart(2, '0');
    const toICS = (dateStr, timeStr) => {
      const t = /^\d{1,2}:\d{2}/.test(timeStr) ? timeStr : '00:00';
      const [h, m] = t.split(':');
      return dateStr.replace(/-/g, '') + 'T' + pad(h) + pad(m) + '00';
    };
    const dt = toICS(b.journey_date, b.departure_time);
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MS Travels//Booking//EN', 'BEGIN:VEVENT',
      'UID:' + b.pnr + '@mstravels', 'DTSTART:' + dt,
      'SUMMARY:MS Travels — ' + b.source_city + ' to ' + b.destination_city + ' (PNR ' + b.pnr + ')',
      'DESCRIPTION:Seats ' + (b.seats || []).join(', ') + '. Reach the boarding point 15 min early.',
      'LOCATION:' + ((b.boarding_point && b.boarding_point.name) || b.source_city),
      'END:VEVENT', 'END:VCALENDAR'
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'MS-Travels-' + b.pnr + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // Prefill the search with the reverse trip and jump to the home search.
  function bookReturn() {
    const b = state.booking;
    if (!b) { goHome(); return; }
    goHome();
    $('from-city').value = b.destination_city;
    $('to-city').value = b.source_city;
    $('journey-date').value = todayStr(0);
    toast('Pick your return date and search');
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
          <div><div class="label">Status</div><div class="val" style="color:${b.status === 'CANCELLED' ? 'var(--red)' : 'var(--green)'}">${b.status}</div></div>
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

        <div class="pt-stamp ${b.status === 'CANCELLED' ? 'cancelled' : ''}">${b.status === 'CANCELLED' ? '✕' : '✓'} ${b.status || 'CONFIRMED'}</div>

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

  // Lazy-load the PDF/QR/barcode libraries on first use. They are ~0.5MB and
  // only needed at download time, so we keep them off every other screen.
  const PDF_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
    'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js'
  ];
  let pdfLibsPromise = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }
  function ensurePdfLibs() {
    if (typeof window.html2canvas !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
      return Promise.resolve();
    }
    if (!pdfLibsPromise) pdfLibsPromise = Promise.all(PDF_LIBS.map(loadScript));
    return pdfLibsPromise;
  }

  // Generate a PDF of the ticket and download it. We render the ticket to a
  // canvas, then place it on an A4 page scaled to FIT (so nothing is clipped).
  async function downloadTicket() {
    const b = state.booking;
    if (!b) { toast('No ticket to download', true); return; }
    const filename = `MS-Travels-Ticket-${b.pnr || 'ticket'}.pdf`;

    overlay(true, 'Generating your ticket PDF…');
    try {
      await ensurePdfLibs();
    } catch (err) {
      console.error(err);
      overlay(false);
      toast('Could not load the PDF tools — opening print view instead.', true);
      window.print();
      return;
    }

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

  /* ---------------- My Bookings (email one-time-code login) ---------------- */

  // Open the My Bookings area. If already signed in, go straight to the list.
  async function openMyBookings() {
    showView('view-mybookings');
    overlay(true, 'Loading…');
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session && session.user) {
        state.user = session.user;
        await loadMyBookings();
      } else {
        showAuthStep('email');
      }
    } catch (err) {
      console.error(err);
      showAuthStep('email');
    } finally {
      overlay(false);
    }
  }

  // Toggle which of the three login steps is visible.
  function showAuthStep(step) {
    $('mb-email-step').hidden = step !== 'email';
    $('mb-code-step').hidden  = step !== 'code';
    $('mb-list-step').hidden  = step !== 'list';
  }

  // Step 1 — email the user a one-time code.
  async function sendCode(e) {
    if (e) e.preventDefault();
    const email = $('mb-email').value.trim();
    if (!email) return;
    overlay(true, 'Sending your code…');
    try {
      const { error } = await sbClient.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true }
      });
      if (error) throw error;
      state.pendingEmail = email;
      $('mb-email-echo').textContent = email;
      $('mb-code').value = '';
      showAuthStep('code');
      toast('Code sent to ' + email);
    } catch (err) {
      console.error(err);
      toast('Could not send code: ' + err.message, true);
    } finally {
      overlay(false);
    }
  }

  // Step 2 — verify the code and open the session.
  async function verifyCode(e) {
    if (e) e.preventDefault();
    const token = $('mb-code').value.trim();
    const email = state.pendingEmail;
    if (!token || !email) return;
    overlay(true, 'Verifying…');
    try {
      const { data, error } = await sbClient.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw error;
      state.user = data.user;
      toast('Signed in');
      await loadMyBookings();
    } catch (err) {
      console.error(err);
      toast('Invalid or expired code. Please try again.', true);
    } finally {
      overlay(false);
    }
  }

  function backToEmail() { showAuthStep('email'); }

  async function signOut() {
    await sbClient.auth.signOut();
    state.user = null;
    state.myBookings = [];
    state.booking = null;
    // unlock the checkout contact email for the next (possibly different) user
    const ce = $('contact-email');
    if (ce) { ce.readOnly = false; ce.classList.remove('locked'); ce.value = ''; }
    showAuthStep('email');
    toast('Signed out');
  }

  // Fetch the signed-in user's bookings (RLS returns only their own rows).
  async function loadMyBookings() {
    showAuthStep('list');
    $('mb-user-email').textContent = (state.user && state.user.email) || '';
    $('mb-bookings').innerHTML = '<p class="muted">Loading your tickets…</p>';
    $('mb-detail').innerHTML = '';
    try {
      const { data, error } = await sbClient
        .from('bus_bookings')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      state.myBookings = data || [];
      renderMyBookingsList();
    } catch (err) {
      console.error(err);
      $('mb-bookings').innerHTML =
        `<div class="empty-state"><p>Could not load your tickets.<br><span class="muted small">${err.message}</span></p></div>`;
    }
  }

  function renderMyBookingsList() {
    const list = state.myBookings;
    if (!list.length) {
      $('mb-bookings').innerHTML =
        `<div class="empty-state"><h3>No tickets yet</h3><p>Bookings made with this email will appear here.</p></div>`;
      return;
    }
    $('mb-bookings').innerHTML = list.map(b => {
      const cancelled = b.status === 'CANCELLED';
      return `<div class="mb-card${cancelled ? ' is-cancelled' : ''}">
        <div class="mb-card-main">
          <div class="mb-route">${b.source_city} → ${b.destination_city}</div>
          <div class="mb-meta">${prettyDate(b.journey_date)} · ${b.departure_time} · ${(b.seats || []).length} seat(s)</div>
          <div class="mb-sub muted">PNR ${b.pnr} · ${b.operator}</div>
        </div>
        <div class="mb-card-side">
          <span class="mb-status ${cancelled ? 'cancelled' : 'confirmed'}">${cancelled ? '🔴 Cancelled' : '🟢 Upcoming'}</span>
          <button class="primary-btn" onclick="App.viewMyBooking('${b.pnr}')">View</button>
        </div>
      </div>`;
    }).join('');
  }

  // Open one ticket from the list.
  function viewMyBooking(pnr) {
    const b = state.myBookings.find(x => x.pnr === pnr);
    if (!b) return;
    state.booking = b;
    renderMyTicket(b);
    $('mb-detail').scrollIntoView({ behavior: 'smooth' });
  }

  /* ---------------- Cancellation ---------------- */

  // Combine journey date + departure time into a Date for the trip's start.
  function departureDate(b) {
    const time = (b.departure_time && /^\d{1,2}:\d{2}/.test(b.departure_time)) ? b.departure_time : '00:00';
    return new Date(b.journey_date + 'T' + time + ':00');
  }

  // Tiered refund policy based on how long before departure the booking is cancelled.
  function cancellationInfo(b) {
    const total = Number(b.total_fare) || 0;
    const hours = (departureDate(b) - new Date()) / 36e5;
    let pct;
    if (hours >= 24)      pct = 90;   // > 1 day before: 10% charge
    else if (hours >= 12) pct = 70;
    else if (hours >= 4)  pct = 50;
    else                  pct = 0;    // < 4h before / departed: no refund
    const refund = Math.round(total * pct / 100);
    return { hours, pct, total, refund, charge: total - refund, departed: hours <= 0 };
  }

  // Render the selected ticket into the detail area, with download + cancel.
  function renderMyTicket(b) {
    renderTicket(b);
    let notice = '';
    const buttons = [`<button class="primary-btn" onclick="App.downloadTicket()">⬇ Download Ticket (PDF)</button>`];

    if (b.status === 'CANCELLED') {
      const refundTxt = (b.refund_amount != null) ? ' Refund of ' + rupee(b.refund_amount) + ' is being processed.' : '';
      notice = `<div class="cancel-note">This booking has been cancelled.${refundTxt}</div>`;
    } else {
      const info = cancellationInfo(b);
      if (info.departed) {
        notice = `<p class="muted small cancel-info">This journey has already departed — the booking can no longer be cancelled.</p>`;
      } else {
        buttons.push(`<button class="danger-btn" onclick="App.cancelBooking()">Cancel Booking</button>`);
      }
    }

    const actions = `<div class="cancel-box">${buttons.join('')}</div>`;
    $('mb-detail').innerHTML = '<h3 class="mb-detail-title">Ticket details</h3>'
      + $('ticket-card').outerHTML + notice + actions;
  }

  // Show the refund breakdown and ask the user to confirm.
  function cancelBooking() {
    const b = state.booking;
    if (!b || b.status !== 'CONFIRMED') return;
    const info = cancellationInfo(b);
    $('mb-detail').innerHTML = `
      <div class="cancel-confirm side-card">
        <h3>Cancel this booking?</h3>
        <p class="muted small">PNR ${b.pnr} · ${b.source_city} → ${b.destination_city} · ${prettyDate(b.journey_date)} · ${b.departure_time}</p>
        <div class="refund-rows">
          <div class="fare-row"><span>Total Paid</span><span>${rupee(info.total)}</span></div>
          <div class="fare-row"><span>Cancellation Charge (${100 - info.pct}%)</span><span>− ${rupee(info.charge)}</span></div>
          <div class="fare-row total"><span>Refund Amount</span><span>${rupee(info.refund)}</span></div>
        </div>
        <p class="muted small">This is a demo — no real money was taken, so this refund is simulated. This action cannot be undone.</p>
        <div class="cancel-box">
          <button class="ghost-btn" onclick="App.keepBooking()">Keep My Booking</button>
          <button class="danger-btn" onclick="App.confirmCancel()">Yes, Cancel &amp; Refund</button>
        </div>
      </div>`;
  }

  // User backed out of the cancellation — restore the ticket view.
  function keepBooking() {
    if (state.booking) renderMyTicket(state.booking);
  }

  // Commit the cancellation through the authenticated client (RLS enforces
  // that a user can only cancel their own booking).
  async function confirmCancel() {
    const b = state.booking;
    if (!b || b.status !== 'CONFIRMED') return;
    overlay(true, 'Cancelling your booking…');
    try {
      // Refund is computed server-side from the server clock + stored fare — the
      // browser never decides the amount (cancellationInfo is preview only).
      const { data, error } = await sbClient.rpc('cancel_booking', { p_pnr: b.pnr });
      if (error) throw error;
      const updated = Array.isArray(data) ? data[0] : data;
      if (!updated) throw new Error('No row returned');
      state.booking = updated;
      const idx = state.myBookings.findIndex(x => x.pnr === b.pnr);
      if (idx >= 0) state.myBookings[idx] = updated;
      renderMyBookingsList();
      renderMyTicket(updated);
      toast('Booking cancelled. Refund ' + rupee(updated.refund_amount || 0) + ' initiated.');
    } catch (err) {
      console.error(err);
      toast('We couldn’t cancel this booking just now. Please try again, or call 1800-200-1234.', true);
    } finally {
      overlay(false);
    }
  }

  /* ---------------- Navigation ---------------- */
  function goHome() { releaseHold(); showView('view-hero'); }
  function backToResults() { releaseHold(); showView('view-results'); }
  function backToSeats() { showView('view-seats'); }
  function openHelp() { showView('view-help'); }

  /* -------- Mobile filters bottom sheet -------- */
  // mode = 'sort' shows only the sort control; 'filter' shows the filter groups.
  function openFilters(mode) {
    const f = $('filters');
    f.classList.remove('mode-sort', 'mode-filter');
    f.classList.add(mode === 'sort' ? 'mode-sort' : 'mode-filter');
    $('filters-sheet-title').textContent = mode === 'sort' ? 'Sort by' : 'Filter';
    f.classList.add('open');
    f.scrollTop = 0;
    $('filters-backdrop').hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closeFilters() {
    const f = $('filters');
    f.classList.remove('open', 'mode-sort', 'mode-filter');
    $('filters-backdrop').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  /* ---------------- Expose ---------------- */
  window.App = {
    search, setDate, swapCities, applyFilters,
    quickSearch, daysToWeekend, onPriceInput, openFilters, closeFilters, pickDate, renderAmenityFilters,
    checkoutSendCode, checkoutVerifyCode, cancelAuth, authBackToEmail,
    selectBus, switchDeck, toggleSeat, toPassengerDetails, toPayment, confirmBooking,
    printTicket, downloadTicket, copyPNR, addToCalendar, bookReturn, resendTicket,
    openMyBookings, sendCode, verifyCode, backToEmail, signOut, viewMyBooking,
    cancelBooking, confirmCancel, keepBooking,
    goHome, backToResults, backToSeats, openHelp, skipToContent
  };

  document.addEventListener('DOMContentLoaded', init);
})();
