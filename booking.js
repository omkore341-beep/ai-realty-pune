// booking.js - site-visit booking + SIMULATED token payment (buyer pages + admin table)
// Loaded BEFORE app.js (see index.html). Uses helpers from app.js ($, api, esc, toast, fullMoney, state, prop) at call time.

const bk = {
  propertyId: null, slots: null, date: null, slot: null, booking: null,
  step: 'pick',            // pick -> pay -> done
  method: 'UPI', timer: null,
  form: { name: '', email: '', phone: '' }
};
const BANKS = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Bank of Maharashtra'];

const to12 = t => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const fmtSlot = iso => new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
function dayParts(d) {
  const dt = new Date(d + 'T00:00:00+05:30');
  return {
    wd: dt.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }),
    dm: dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
  };
}
function bkReset() {
  clearInterval(bk.timer);
  Object.assign(bk, { slots: null, date: null, slot: null, booking: null, step: 'pick' });
}
function fmtCard(el) { el.value = el.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim(); }
function fmtExp(el) { let v = el.value.replace(/\D/g, '').slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2); el.value = v; }

/* ---------------- Buyer: page router ---------------- */
async function renderBook() {
  const p = state.current || prop(state.selectedId) || state.properties[0];
  if (!p) { $('#book').innerHTML = 'No properties found.'; return; }
  state.current = p;
  if (bk.propertyId !== p.property_id) { bkReset(); bk.propertyId = p.property_id; }
  if (bk.step === 'pay') return renderBookPay();
  if (bk.step === 'done') return renderBookDone();
  try {
    if (!bk.slots) bk.slots = await api(`/api/properties/${encodeURIComponent(p.property_id)}/slots`);
  } catch (e) { toast(e.message, 'err'); return; }

  const days = bk.slots.days;
  if (!bk.date || !days.find(d => d.date === bk.date)) bk.date = (days.find(d => d.slots.some(s => s.available)) || days[0]).date;
  const day = days.find(d => d.date === bk.date);
  const chosen = bk.slot ? fmtSlot(bk.slot) : null;

  $('#book').innerHTML = `
  <div><h1 class="text-3xl font-black">📅 Book a Site Visit</h1>
  <p class="muted mt-1">Pick a date and time, then pay a small token to confirm your slot. <b>Demo payment — no real money is charged.</b></p></div>
  <div class="grid xl:grid-cols-[1fr_380px] gap-5 mt-5">
    <div class="space-y-5">
      <div class="card p-5">
        <label class="text-xs font-bold text-slate-500">Property</label>
        <select class="input mt-1" onchange="state.selectedId=this.value;state.current=prop(this.value);renderBook()">
          ${state.properties.map(x => `<option value="${esc(x.property_id)}" ${x.property_id === p.property_id ? 'selected' : ''}>${esc(x.property_id)} — ${esc(x.property_name)} (${esc(x.location)})</option>`).join('')}
        </select>
      </div>
      <div class="card p-5">
        <h2 class="text-xl font-black">1. Choose a date</h2>
        <div class="flex gap-2 overflow-x-auto nav-scroll pb-1 mt-3">
          ${days.map(d => {
            const any = d.slots.some(s => s.available), dp = dayParts(d.date);
            return `<button type="button" ${any ? '' : 'disabled'} onclick="bkPickDate('${d.date}')"
              class="btn shrink-0 text-center disabled:opacity-40 disabled:cursor-not-allowed ${d.date === bk.date ? 'btn-primary' : ''}">
              <div class="text-xs">${dp.wd}</div><div class="font-black">${dp.dm}</div></button>`;
          }).join('')}
        </div>
      </div>
      <div class="card p-5">
        <h2 class="text-xl font-black">2. Choose a time <span class="text-sm font-semibold text-slate-400">(India time)</span></h2>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
          ${day.slots.map(s => `<button type="button" ${s.available ? '' : 'disabled'} onclick="bkPickSlot('${s.iso}')"
            class="btn disabled:opacity-40 disabled:cursor-not-allowed disabled:line-through ${s.iso === bk.slot ? 'btn-primary' : ''}">${to12(s.time)}</button>`).join('')}
        </div>
        <div class="text-xs muted mt-3">Struck-out times are already booked or too soon to arrange.</div>
      </div>
    </div>
    <aside>
      <form onsubmit="submitBooking(event)" class="card p-5 space-y-3 sticky top-40">
        <h2 class="text-xl font-black">3. Your details</h2>
        <input class="input" placeholder="Full name" required value="${esc(bk.form.name)}" oninput="bk.form.name=this.value">
        <input class="input" type="email" placeholder="Email" required value="${esc(bk.form.email)}" oninput="bk.form.email=this.value">
        <input class="input" type="tel" placeholder="Phone number" required value="${esc(bk.form.phone)}" oninput="bk.form.phone=this.value">
        <div class="rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm space-y-1">
          <div class="flex justify-between"><span class="muted">Property</span><b class="text-right">${esc(p.property_name)}</b></div>
          <div class="flex justify-between"><span class="muted">Visit slot</span><b class="text-right">${chosen ? esc(chosen) : '— not selected —'}</b></div>
          <div class="flex justify-between pt-2 border-t border-slate-200 mt-2"><span class="muted">Token to pay</span><b class="text-lg">${fullMoney(bk.slots.tokenAmount)}</b></div>
        </div>
        <button class="btn btn-primary w-full">Continue to payment →</button>
        <div class="text-xs muted">Your slot is held for ${bk.slots.holdMinutes} minutes while you pay.</div>
      </form>
    </aside>
  </div>`;
}
function bkPickDate(d) { bk.date = d; bk.slot = null; renderBook(); }
function bkPickSlot(iso) { bk.slot = iso; renderBook(); }

async function submitBooking(e) {
  e.preventDefault();
  if (!bk.slot) { toast('Please choose a time slot first.', 'err'); return; }
  try {
    bk.booking = await api('/api/bookings', { method: 'POST', body: JSON.stringify({ propertyId: bk.propertyId, slot: bk.slot, name: bk.form.name, email: bk.form.email, phone: bk.form.phone }) });
    bk.step = 'pay';
    renderBook();
  } catch (x) {
    toast(x.message, 'err');
    if (/slot|taken|available/i.test(x.message)) { bk.slots = null; bk.slot = null; renderBook(); } // refresh the slot list
  }
}

/* ---------------- Buyer: simulated payment page ---------------- */
function setPayMethod(m) { bk.method = m; renderBookPay(); }
function renderBookPay() {
  const b = bk.booking;
  const tab = (id, label) => `<button type="button" onclick="setPayMethod('${id}')" class="btn flex-1 ${bk.method === id ? 'btn-dark' : ''}">${label}</button>`;
  const panel = bk.method === 'UPI'
    ? `<div><label class="text-xs font-bold text-slate-500">UPI ID</label><input id="payUpi" class="input mt-1" placeholder="yourname@upi"></div>`
    : bk.method === 'CARD'
    ? `<div class="grid gap-3">
         <div><label class="text-xs font-bold text-slate-500">Card number</label><input id="payCard" class="input mt-1" inputmode="numeric" placeholder="1234 5678 9012 3456" oninput="fmtCard(this)"></div>
         <div class="grid grid-cols-2 gap-3">
           <div><label class="text-xs font-bold text-slate-500">Expiry (MM/YY)</label><input id="payExp" class="input mt-1" placeholder="08/29" oninput="fmtExp(this)"></div>
           <div><label class="text-xs font-bold text-slate-500">CVV</label><input id="payCvv" type="password" maxlength="4" inputmode="numeric" class="input mt-1" placeholder="•••"></div>
         </div>
         <div><label class="text-xs font-bold text-slate-500">Name on card</label><input id="payCardName" class="input mt-1" placeholder="As printed on card"></div>
       </div>`
    : `<div><label class="text-xs font-bold text-slate-500">Choose your bank</label><select id="payBank" class="input mt-1">${BANKS.map(x => `<option>${esc(x)}</option>`).join('')}</select></div>`;

  $('#book').innerHTML = `
  <div class="max-w-2xl mx-auto">
    <button class="btn text-sm" onclick="changeSlot()">← Change slot</button>
    <div class="card p-6 mt-4">
      <div class="flex justify-between items-start gap-3 flex-wrap">
        <div><h1 class="text-2xl font-black">Pay token to confirm</h1><p class="muted text-sm mt-1">Booking ${esc(b.booking_ref)}</p></div>
        <div class="pill !bg-amber-100 !text-amber-700">Slot held for <span id="holdLeft" class="ml-1">--:--</span></div>
      </div>
      <div class="rounded-xl bg-slate-50 border border-slate-200 p-4 mt-4 text-sm space-y-1">
        <div class="flex justify-between"><span class="muted">Property</span><b class="text-right">${esc(b.property_name)}</b></div>
        <div class="flex justify-between"><span class="muted">Visit</span><b class="text-right">${esc(fmtSlot(b.slot_start))}</b></div>
        <div class="flex justify-between"><span class="muted">Buyer</span><b class="text-right">${esc(b.buyer_name)}</b></div>
        <div class="flex justify-between pt-2 border-t border-slate-200 mt-2"><span class="muted">Token amount</span><b class="text-xl">${fullMoney(b.token_amount)}</b></div>
      </div>
      <div class="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs">
        🧪 <b>Demo payment.</b> No real money moves and nothing is charged. Use any details. A card number ending in <b>0000</b> simulates a declined payment.
      </div>
      <form onsubmit="payNow(event)" class="mt-4">
        <div class="flex gap-2">${tab('UPI', 'UPI')}${tab('CARD', 'Card')}${tab('NETBANKING', 'Net banking')}</div>
        <div class="mt-4">${panel}</div>
        <button id="payBtn" class="btn btn-primary w-full mt-5">Pay ${fullMoney(b.token_amount)}</button>
      </form>
    </div>
  </div>`;
  startHoldTimer();
}
function startHoldTimer() {
  clearInterval(bk.timer);
  const end = new Date(bk.booking.expires_at).getTime();
  const tick = () => {
    const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
    const el = $('#holdLeft');
    if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (s <= 0) {
      clearInterval(bk.timer);
      bkReset();
      if (state.page === 'book') { toast('Your slot hold expired. Please pick a slot again.', 'err'); renderBook(); }
    }
  };
  tick();
  bk.timer = setInterval(tick, 1000);
}
async function changeSlot() {
  const b = bk.booking;
  try { await api(`/api/bookings/${encodeURIComponent(b.booking_ref)}/release`, { method: 'POST', body: JSON.stringify({ email: b.buyer_email }) }); } catch (e) {}
  bkReset(); renderBook();
}
async function payNow(e) {
  e.preventDefault();
  const b = bk.booking; let last4 = '';
  if (bk.method === 'UPI') {
    const v = ($('#payUpi').value || '').trim();
    if (!/^[\w.\-]{2,}@[A-Za-z]{2,}$/.test(v)) { toast('Enter a valid UPI ID like name@upi.', 'err'); return; }
  } else if (bk.method === 'CARD') {
    const n = ($('#payCard').value || '').replace(/\s/g, '');
    if (!/^\d{16}$/.test(n)) { toast('Enter a 16-digit card number.', 'err'); return; }
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test($('#payExp').value.trim())) { toast('Enter expiry as MM/YY.', 'err'); return; }
    if (!/^\d{3,4}$/.test($('#payCvv').value)) { toast('Enter a valid CVV.', 'err'); return; }
    if (!$('#payCardName').value.trim()) { toast('Enter the name on the card.', 'err'); return; }
    last4 = n.slice(-4); // only the last 4 digits ever leave this page
  }
  const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Processing…';
  try {
    const r = await api(`/api/bookings/${encodeURIComponent(b.booking_ref)}/pay`, { method: 'POST', body: JSON.stringify({ email: b.buyer_email, method: bk.method, last4 }) });
    clearInterval(bk.timer);
    bk.booking = r; bk.step = 'done';
    renderBook();
    toast('Payment successful. Visit confirmed!');
  } catch (x) {
    toast(x.message, 'err');
    if (/expired/i.test(x.message)) { bkReset(); renderBook(); }
    else { btn.disabled = false; btn.textContent = `Pay ${fullMoney(b.token_amount)}`; }
  }
}

/* ---------------- Buyer: receipt ---------------- */
function renderBookDone() {
  const b = bk.booking;
  $('#book').innerHTML = `
  <style>@media print{header,footer,.no-print{display:none!important}body{background:#fff}}</style>
  <div class="max-w-2xl mx-auto">
    <div class="card p-7">
      <div class="text-center">
        <div class="text-5xl">✅</div>
        <h1 class="text-3xl font-black mt-2">Site visit confirmed</h1>
        <p class="muted mt-1">Show this booking ID at the property.</p>
        <div class="inline-block mt-4 px-5 py-2 rounded-xl bg-slate-900 text-white text-xl font-black tracking-wider">${esc(b.booking_ref)}</div>
      </div>
      <div class="table-wrap mt-6"><table><tbody>
        ${[['Property', `${b.property_name} (${b.property_id || '—'})`], ['Visit slot', fmtSlot(b.slot_start) + ' (IST)'], ['Buyer', b.buyer_name], ['Phone', b.buyer_phone], ['Email', b.buyer_email],
           ['Token paid', fullMoney(b.token_amount)], ['Transaction ID', b.payment_ref], ['Paid at', new Date(b.paid_at).toLocaleString('en-IN')], ['Status', b.status]]
          .map(x => `<tr><td class="font-semibold">${esc(x[0])}</td><td>${esc(x[1])}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="text-xs muted mt-4">Demo receipt from a simulated payment. It is not a legal payment receipt and no money was charged.</div>
      <div class="flex gap-2 mt-5 no-print">
        <button class="btn btn-dark" onclick="window.print()">🖨️ Print receipt</button>
        <button class="btn" onclick="bkReset();renderBook()">Book another visit</button>
      </div>
    </div>
  </div>`;
}

/* ---------------- Admin: bookings table (called from renderAdmin in app.js) ---------------- */
function bkBadge(s) {
  const c = { CONFIRMED: '!bg-green-100 !text-green-700', PENDING_PAYMENT: '!bg-amber-100 !text-amber-700', COMPLETED: '!bg-blue-100 !text-blue-700', CANCELLED: '!bg-red-100 !text-red-700', EXPIRED: '!bg-slate-100 !text-slate-600' }[s] || '';
  return `<span class="pill ${c}">${esc(String(s).replace('_', ' '))}</span>`;
}
function bookingsAdminHtml(d) {
  const st = d.stats || {}, rows = d.bookings || [];
  const actions = b => {
    if (b.status === 'CONFIRMED') return `<button class="btn text-xs" onclick="adminBookingStatus('${b.id}','COMPLETED')">Mark visited</button> <button class="btn btn-danger text-xs" onclick="adminBookingStatus('${b.id}','CANCELLED')">Cancel + refund</button>`;
    if (b.status === 'PENDING_PAYMENT') return `<button class="btn btn-danger text-xs" onclick="adminBookingStatus('${b.id}','CANCELLED')">Cancel</button>`;
    return '<span class="muted text-xs">—</span>';
  };
  return `<div class="card p-5 mt-5">
    <h2 class="text-xl font-black">📅 Site Visits & Token Payments</h2>
    <p class="muted text-sm">Slots booked by buyers, token payment status, and actions. (Payments are simulated.)</p>
    <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
      ${[['Total bookings', st.total || 0], ['Confirmed visits', st.confirmed || 0], ['Awaiting payment', st.pending || 0], ['Token collected', fullMoney(st.collected || 0)]]
        .map(x => `<div class="metric"><div class="muted text-sm">${x[0]}</div><div class="text-2xl font-black">${x[1]}</div></div>`).join('')}
    </div>
    <div class="table-wrap mt-4"><table><thead><tr><th>Ref</th><th>Property</th><th>Buyer</th><th>Visit slot (IST)</th><th>Token</th><th>Payment</th><th>Status</th><th>Action</th></tr></thead><tbody>
    ${rows.length ? rows.map(b => `<tr>
      <td class="font-bold">${esc(b.booking_ref)}</td>
      <td>${esc(b.property_name || b.property_id)}<div class="text-xs muted">${esc(b.location || '')}</div></td>
      <td>${esc(b.buyer_name)}<div class="text-xs muted">${esc(b.buyer_phone)}<br>${esc(b.buyer_email)}</div></td>
      <td>${esc(fmtSlot(b.slot_start))}</td>
      <td>${fullMoney(b.token_amount)}</td>
      <td>${esc(b.payment_status)}${b.payment_ref ? `<div class="text-xs muted">${esc(b.payment_ref)}</div>` : ''}</td>
      <td>${bkBadge(b.status)}</td>
      <td class="whitespace-nowrap">${actions(b)}</td></tr>`).join('') : `<tr><td colspan="8" class="muted">No site visits booked yet.</td></tr>`}
    </tbody></table></div></div>`;
}
async function adminBookingStatus(id, status) {
  const msg = status === 'CANCELLED' ? 'Cancel this booking? If the token was paid it will be refunded (simulated).' : 'Mark this visit as completed?';
  if (!confirm(msg)) return;
  try {
    const r = await api(`/api/admin/bookings/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
    toast(r.refunded ? 'Booking cancelled and token refunded (simulated).' : 'Booking updated.');
    renderAdmin();
  } catch (x) { toast(x.message, 'err'); }
}
