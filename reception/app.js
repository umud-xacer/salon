const API = 'http://localhost:8000';
const token = localStorage.getItem('token');
const role  = localStorage.getItem('role');

if(!token || !['reception','admin','superadmin'].includes(role)){
  window.location.href = '/login/';
}

document.getElementById('hUser').textContent = localStorage.getItem('full_name') || 'Reception';

let calDate = new Date();
let _payId = null, _payMethod = 'cash', _soldProducts = [], _inventory = [];

// ─── Date ──────────────────────────────────────────────────────────────────────
function fmtDate(d){
  const m=['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtMoney(n){if(!n||n===0)return'0';if(n>=1000000)return(n/1000000).toFixed(1)+' mln';if(n>=1000)return Math.round(n/1000)+'K';return Math.round(n)+''}
function today(){return calDate.toISOString().split('T')[0];}
document.getElementById('dateLbl').textContent = fmtDate(calDate);

function authH(){return{'Authorization':'Bearer '+token,'Content-Type':'application/json'};}

// ─── Tab Navigation ───────────────────────────────────────────────────────────
const TABS=['queue','new','masters','clients'];
function showTab(t){
  TABS.forEach(x=>{
    document.getElementById('tab-'+x).classList.toggle('active',x===t);
    document.getElementById('nav-'+x).classList.toggle('active',x===t);
  });
  if(t==='queue') loadQueue();
  if(t==='new'){loadSelects();}
  if(t==='masters') loadMasters();
  if(t==='clients') loadClients();
}

function prevDay(){calDate.setDate(calDate.getDate()-1);document.getElementById('dateLbl').textContent=fmtDate(calDate);loadQueue();}
function nextDay(){calDate.setDate(calDate.getDate()+1);document.getElementById('dateLbl').textContent=fmtDate(calDate);loadQueue();}

// ─── Queue ────────────────────────────────────────────────────────────────────
async function loadQueue(){
  const r = await fetch(`${API}/api/appointments/?date=${today()}`,{headers:authH()});
  if(r.status===401){logout();return;}
  const appts = await r.json();

  // Stats
  const total   = appts.length;
  const pending = appts.filter(a=>a.status==='pending').length;
  const inChair = appts.filter(a=>a.status==='confirmed').length;
  const paid    = appts.filter(a=>a.is_paid).length;
  const unpaid  = appts.filter(a=>a.status==='completed'&&!a.is_paid).length;

  document.getElementById('qStats').innerHTML=`
    <div class="stat-card"><div style="font-size:20px">📅</div><div class="stat-val">${total}</div><div class="stat-lbl">Jami</div></div>
    <div class="stat-card"><div style="font-size:20px">⏳</div><div class="stat-val" style="color:var(--yellow)">${pending}</div><div class="stat-lbl">Kutmoqda</div></div>
    <div class="stat-card"><div style="font-size:20px">💺</div><div class="stat-val" style="color:var(--blue)">${inChair}</div><div class="stat-lbl">Kresloda</div></div>
    <div class="stat-card"><div style="font-size:20px">⚠️</div><div class="stat-val" style="color:var(--red)">${unpaid}</div><div class="stat-lbl">To'lov kutmoqda</div></div>
    <div class="stat-card"><div style="font-size:20px">✅</div><div class="stat-val" style="color:var(--green)">${paid}</div><div class="stat-lbl">To'langan</div></div>
  `;

  const el = document.getElementById('queueList');
  if(!appts.length){el.innerHTML='<div class="empty">📅 Bu kunda bronlar yo\'q</div>';return;}

  el.innerHTML = appts.map((a,i)=>{
    // Status logic
    let cls='pending', badge='', actions='';
    if(a.is_paid){
      cls='paid';
      badge=`<span class="badge bg-green">✅ To'langan • ${a.payment_method||'naqd'}</span>`;
    } else if(a.status==='completed'){
      cls='waiting-pay';
      badge='<span class="badge bg-red">💳 To\'lov kutilmoqda</span>';
      actions=`<button class="btn btn-sm btn-pay" onclick="openPayModal(${a.id},${JSON.stringify(a).replace(/"/g,'&quot;')})">💳 To'lov</button>`;
    } else if(a.status==='confirmed'){
      cls='confirmed';
      badge='<span class="badge bg-blue">💺 Kresloda</span>';
      actions=`<button class="btn btn-sm btn-pay" onclick="openPayModal(${a.id},${JSON.stringify(a).replace(/"/g,'&quot;')})">💳 To'lov</button>
               <button class="btn btn-sm btn-red" onclick="patchStatus(${a.id},'cancelled')">❌ Kelmadi</button>`;
    } else if(a.status==='cancelled'){
      cls=''; badge='<span class="badge bg-red">❌ Kelmadi</span>';
    } else {
      badge='<span class="badge bg-yellow">⏳ Kutmoqda</span>';
      actions=`<button class="btn btn-sm btn-green" onclick="checkIn(${a.id})">🟢 Keldi</button>
               <button class="btn btn-sm btn-red" onclick="patchStatus(${a.id},'cancelled')">❌ Kelmadi</button>`;
    }
    const checkedIn = a.checked_in_at ? `<span style="font-size:10px;color:var(--green)">✅ Keldi: ${a.checked_in_at}</span>` : '';
    const paidAt = a.paid_at ? `<span style="font-size:10px;color:var(--cyan)">💳 ${a.paid_at}</span>` : '';
    return `<div class="qcard ${cls}">
      <div class="q-num">${String(i+1).padStart(2,'0')}</div>
      <div class="q-time">${a.appt_time||'—'}</div>
      <div class="q-info">
        <div class="q-client">${a.client_name} ${badge}</div>
        <div class="q-detail">✂ ${a.service||'—'} · 👩‍💼 ${a.master||'—'} · 💰 ${fmtMoney(a.price)} so'm ${checkedIn} ${paidAt}</div>
        ${a.final_price&&a.final_price!==a.price ? `<div style="font-size:11px;color:var(--green)">Yakuniy: ${fmtMoney(a.final_price)} so'm</div>` : ''}
      </div>
      <div class="q-actions">${actions}</div>
    </div>`;
  }).join('');
}

async function checkIn(id){
  const r = await fetch(`${API}/api/appointments/${id}/checkin`,{method:'PATCH',headers:authH()});
  const d = await r.json();
  showToast(d.message||'✅ Check-in amalga oshirildi','success');
  loadQueue();
}
async function patchStatus(id,status){
  await fetch(`${API}/api/appointments/${id}/status?status=${status}`,{method:'PATCH',headers:authH()});
  showToast(status==='cancelled'?'❌ Kelmadi deb belgilandi':'✅ Status yangilandi','success');
  loadQueue();
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
let _payAppt = null;

async function openPayModal(id, appt){
  _payId = id; _payAppt = appt; _soldProducts = []; _payMethod = 'cash';
  document.querySelectorAll('.pay-method').forEach(m=>m.classList.toggle('active',m.dataset.m==='cash'));
  document.getElementById('payDiscount').value = 0;
  document.getElementById('payNote').value = '';
  document.getElementById('payProductPicker').style.display = 'none';
  document.getElementById('soldProducts').innerHTML = '';

  document.getElementById('payInfo').innerHTML = `
    <div style="font-size:15px;font-weight:700;margin-bottom:8px">${appt.client_name}</div>
    <div style="font-size:13px;color:var(--muted)">✂ ${appt.service||'—'} · 👩‍💼 ${appt.master||'—'}</div>
    <div style="font-size:18px;font-weight:800;color:var(--blue);margin-top:8px">${fmtMoney(appt.price)} so'm</div>
  `;

  // Inventoryni yuklash
  try{
    const r = await fetch(`${API}/api/inventory/`,{headers:authH()});
    _inventory = await r.json();
    document.getElementById('ppProduct').innerHTML = _inventory.map(i=>`<option value="${i.id}" data-price="${i.price}" data-name="${i.name}">${i.name} (${i.qty} ${i.unit}) — ${fmtMoney(i.price)} so'm</option>`).join('');
  }catch(e){}

  calcTotal();
  document.getElementById('payModal').classList.add('open');
}

function selectMethod(el, m){
  _payMethod = m;
  document.querySelectorAll('.pay-method').forEach(x=>x.classList.remove('active'));
  el.classList.add('active');
}

function openAddProduct(){
  const el = document.getElementById('payProductPicker');
  el.style.display = el.style.display==='none' ? 'block' : 'none';
}

function addProduct(){
  const sel = document.getElementById('ppProduct');
  const qty = parseFloat(document.getElementById('ppQty').value)||1;
  if(!sel.value) return;
  const opt = sel.options[sel.selectedIndex];
  const price = parseFloat(opt.dataset.price)||0;
  const name  = opt.dataset.name||opt.text;
  const id    = parseInt(sel.value);
  const exist = _soldProducts.find(p=>p.id===id);
  if(exist){ exist.qty += qty; }
  else { _soldProducts.push({id,name,qty,price}); }
  renderSoldProducts();
  calcTotal();
  document.getElementById('payProductPicker').style.display='none';
}

function removeProduct(i){
  _soldProducts.splice(i,1);
  renderSoldProducts();
  calcTotal();
}

function renderSoldProducts(){
  document.getElementById('soldProducts').innerHTML = _soldProducts.map((p,i)=>`
    <div class="sold-item">
      <span>${p.name} × ${p.qty}</span>
      <span>${fmtMoney(p.price*p.qty)} so'm <button onclick="removeProduct(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;margin-left:8px">✕</button></span>
    </div>`).join('') || '<div style="font-size:12px;color:var(--muted);padding:6px">Mahsulot qo\'shilmagan</div>';
}

function calcTotal(){
  const base = _payAppt ? (_payAppt.price||0) : 0;
  const prodsTotal = _soldProducts.reduce((s,p)=>s+p.price*p.qty,0);
  const discount = parseFloat(document.getElementById('payDiscount').value)||0;
  const total = Math.max(0, base + prodsTotal - discount);
  document.getElementById('totalBox').innerHTML = `
    <div class="lbl">Xizmat: ${fmtMoney(base)} + Mahsulot: ${fmtMoney(prodsTotal)} - Chegirma: ${fmtMoney(discount)}</div>
    <div class="val">${fmtMoney(total)} so'm</div>
    <div class="lbl" style="margin-top:4px">${_payMethod==='cash'?'💵 Naqd':_payMethod==='card'?'💳 Karta':_payMethod==='click'?'📱 Click':'💚 Payme'}</div>
  `;
}

async function confirmPay(){
  if(!_payId) return;
  const discount = parseFloat(document.getElementById('payDiscount').value)||0;
  const note = document.getElementById('payNote').value;
  try{
    const r = await fetch(`${API}/api/appointments/${_payId}/pay`,{
      method:'POST', headers:authH(),
      body: JSON.stringify({payment_method:_payMethod, discount, products:_soldProducts, note})
    });
    const d = await r.json();
    if(r.ok){
      closeModal('payModal');
      showToast(d.message,'success');
      loadQueue();
    } else {
      showToast(d.detail||'Xato','error');
    }
  }catch(e){showToast('Server xatosi','error');}
}

// ─── New Booking ──────────────────────────────────────────────────────────────
async function loadSelects(){
  const [svcs, staff] = await Promise.all([
    fetch(`${API}/api/services/`,{headers:authH()}).then(r=>r.json()),
    fetch(`${API}/api/staff/`,{headers:authH()}).then(r=>r.json()),
  ]);
  document.getElementById('b-svc').innerHTML = svcs.map(s=>`<option value="${s.name}">${s.name} — ${fmtMoney(s.price)} so'm</option>`).join('');
  document.getElementById('b-mstr').innerHTML = staff.map(s=>`<option value="${s.name}">${s.name}</option>`).join('');
  if(!document.getElementById('b-date').value)
    document.getElementById('b-date').value = today();
}

async function createBooking(){
  const client  = document.getElementById('b-client').value.trim();
  const phone   = document.getElementById('b-phone').value.trim();
  const service = document.getElementById('b-svc').value;
  const master  = document.getElementById('b-mstr').value;
  const date    = document.getElementById('b-date').value;
  const time    = document.getElementById('b-time').value;
  const note    = document.getElementById('b-note').value;
  if(!client||!service||!master||!date||!time){showToast('⚠ Barcha * maydonlarni to\'ldiring','error');return;}
  try{
    const r = await fetch(`${API}/api/appointments/`,{
      method:'POST', headers:authH(),
      body:JSON.stringify({client_name:client,client_phone:phone,service,master,appt_date:date,appt_time:time,note,source:'reception'})
    });
    const d = await r.json();
    if(r.ok){
      showToast('✅ Bron muvaffaqiyatli qo\'shildi!','success');
      document.getElementById('b-client').value='';
      document.getElementById('b-phone').value='';
      document.getElementById('b-note').value='';
      showTab('queue');
    } else showToast(d.detail||'Xato','error');
  }catch(e){showToast('Server xatosi','error');}
}

// ─── Masters Grid ─────────────────────────────────────────────────────────────
async function loadMasters(){
  const [staff, appts] = await Promise.all([
    fetch(`${API}/api/staff/`,{headers:authH()}).then(r=>r.json()),
    fetch(`${API}/api/appointments/?date=${today()}`,{headers:authH()}).then(r=>r.json()),
  ]);
  const COLORS=['#8B5CF6','#F43F5E','#F59E0B','#14B8A6','#EC4899','#3B82F6','#10B981'];

  document.getElementById('masterGrid').innerHTML = staff.map((s,i)=>{
    const c=COLORS[i%COLORS.length];
    const myAppts = appts.filter(a=>a.master&&a.master.includes(s.name.split(' ')[0]));
    const busy = myAppts.some(a=>['pending','confirmed'].includes(a.status));
    const done = myAppts.filter(a=>a.is_paid).length;
    const current = myAppts.find(a=>a.status==='confirmed');
    return `<div class="mcard ${busy?'busy':'free'}">
      <div class="mcard-av" style="background:${c}25;color:${c}">${s.name[0]}</div>
      <div class="mcard-name">${s.name.split(' ')[0]}</div>
      <div class="mcard-role">${s.role}</div>
      <span class="badge ${busy?'bg-blue':'bg-green'}">${busy?'🔵 Band':'🟢 Bo\'sh'}</span>
      <div class="mcard-time" style="margin-top:6px">✅ ${done} ta tugadi</div>
      ${current?`<div style="font-size:10px;color:var(--blue);margin-top:3px">💺 ${current.client_name}</div>`:''}
    </div>`;
  }).join('');

  // Timeline
  const hours=['09','10','11','12','13','14','15','16','17','18','19','20'];
  const tlEl = document.getElementById('timeline');
  tlEl.innerHTML = `<div class="tl-grid">
    <div class="tl-row"><div class="tl-master"></div>
      <div class="tl-slots">${hours.map(h=>`<div class="tl-slot" style="color:var(--muted);background:none;border:none;font-size:10px">${h}:00</div>`).join('')}</div>
    </div>
    ${staff.map((s,i)=>{
      const c=COLORS[i%COLORS.length];
      const myAppts=appts.filter(a=>a.master&&a.master.includes(s.name.split(' ')[0]));
      const slots=hours.map(h=>{
        const a=myAppts.find(x=>x.appt_time&&x.appt_time.startsWith(h+':'));
        if(!a) return `<div class="tl-slot free" title="${h}:00 — Bo'sh"></div>`;
        const cls=a.is_paid?'done':a.status==='confirmed'?'busy':'';
        return `<div class="tl-slot ${cls}" title="${a.client_name}: ${a.service}">${a.is_paid?'✓':'●'}</div>`;
      }).join('');
      return `<div class="tl-row">
        <div class="tl-master" style="color:${c}">${s.name.split(' ')[0]}</div>
        <div class="tl-slots">${slots}</div>
      </div>`;
    }).join('')}
  </div>`;
}

// ─── Clients ──────────────────────────────────────────────────────────────────
let _allClients = [];
async function loadClients(){
  const r = await fetch(`${API}/api/clients/`,{headers:authH()});
  _allClients = await r.json();
  renderClients(_allClients);
}
function filterClients(){
  const q = document.getElementById('cSearch').value.toLowerCase();
  renderClients(_allClients.filter(c=>c.name.toLowerCase().includes(q)||c.phone?.includes(q)));
}
function renderClients(list){
  document.getElementById('clientTbl').innerHTML = list.map(c=>`<tr>
    <td style="font-weight:600">${c.name}</td>
    <td style="color:var(--muted);font-size:12px">${c.phone||'—'}</td>
    <td><span class="badge bg-blue">${c.visits} marta</span></td>
    <td style="color:var(--yellow);font-weight:600">${Math.round(c.bonus||0)} ball</td>
    <td><button class="btn btn-sm btn-green" onclick="bronClient('${c.name}','${c.phone}')">📅 Bron</button></td>
  </tr>`).join('') || `<tr><td colspan="5" class="empty">Mijozlar yo'q</td></tr>`;
}
function bronClient(name,phone){
  document.getElementById('b-client').value=name;
  document.getElementById('b-phone').value=phone;
  showTab('new');
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function closeModal(id){document.getElementById(id).classList.remove('open');}
function showToast(msg,type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg;t.className=`toast ${type} show`;
  setTimeout(()=>t.classList.remove('show'),3500);
}
function logout(){localStorage.clear();window.location.href='/login/';}

// Auto-refresh har 30 soniyada
setInterval(()=>{
  if(document.getElementById('tab-queue').classList.contains('active')) loadQueue();
  if(document.getElementById('tab-masters').classList.contains('active')) loadMasters();
}, 30000);

// Boshlash
loadQueue();
