const API   = 'http://localhost:8000';
const token = localStorage.getItem('token');
const role  = localStorage.getItem('role');

if(!token){ window.location.href='/login/'; }

// Staff info
let STAFF = null;
let DASH  = null;

// ─── Utils ────────────────────────────────────────────────────────────────────
const months=['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
function fmtDate(d){d=d||new Date();return`${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;}
function fmtMoney(n){if(!n)return'0';if(n>=1000000)return(n/1e6).toFixed(1)+' mln';if(n>=1000)return Math.round(n/1000)+'K';return Math.round(n)+'';}
function authH(){return{'Authorization':'Bearer '+token,'Content-Type':'application/json'};}
async function apiGet(path){const r=await fetch(API+path,{headers:authH()});if(r.status===401){logout();}return r.ok?r.json():null;}
async function apiPost(path,body){const r=await fetch(API+path,{method:'POST',headers:authH(),body:JSON.stringify(body)});return{ok:r.ok,data:await r.json()};}
async function apiPatch(path){const r=await fetch(API+path,{method:'PATCH',headers:authH()});return{ok:r.ok,data:await r.json()};}

function showToast(msg,type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`toast ${type} show`;
  setTimeout(()=>t.classList.remove('show'),3500);
}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function logout(){localStorage.clear();window.location.href='/login/';}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
const TABS=['queue','earnings','inventory','timeline'];
function showTab(t){
  TABS.forEach(x=>{
    document.getElementById('tab-'+x).classList.toggle('active',x===t);
    document.getElementById('ntab-'+x).classList.toggle('active',x===t);
  });
  if(t==='earnings') renderEarnings();
  if(t==='inventory') loadInventory();
  if(t==='timeline') renderTimeline();
}

// ─── Header ───────────────────────────────────────────────────────────────────
document.getElementById('hDate').textContent=fmtDate(new Date());

// ─── Main Dashboard Load ──────────────────────────────────────────────────────
async function loadDashboard(){
  DASH = await apiGet('/api/master/dashboard');
  if(!DASH) return;
  STAFF = DASH.staff;

  // Header
  const name = STAFF.name.split(' ')[0];
  document.getElementById('hName').textContent=name;
  document.getElementById('hAv').textContent=STAFF.name[0];

  // KPI Cards
  document.getElementById('kpi-earn').textContent=fmtMoney(DASH.today.earnings)+' so\'m';
  document.getElementById('kpi-pct').textContent=`Xizmat: ${fmtMoney(DASH.today.income)} × ${STAFF.percent}%`;
  document.getElementById('kpi-clients').textContent=DASH.today.total_appts;
  document.getElementById('kpi-done').textContent=`✅ ${DASH.today.done} ta yakunlandi`;
  document.getElementById('kpi-rating').textContent=STAFF.rating||'5.0';
  const invAlerts = DASH.inventory.low_stock_count;
  document.getElementById('kpi-inv').textContent=invAlerts>0?invAlerts+' ta':' Yaxshi';
  document.getElementById('kpi-inv-lbl').textContent=invAlerts>0?'Materiallar kam qoldi!':'Hamma narsa yetarli';
  const invCard=document.getElementById('kpiInvCard');
  invCard.style.borderColor=invAlerts>0?'rgba(244,63,94,.4)':'rgba(16,185,129,.3)';

  // Today Stats sidebar
  const t=DASH.today;
  document.getElementById('todayStats').innerHTML=`
    <div class="mini-stat"><span class="ms-lbl">📅 Jami bronlar</span><span class="ms-val">${t.total_appts}</span></div>
    <div class="mini-stat"><span class="ms-lbl">✅ Yakunlangan</span><span class="ms-val" style="color:var(--green)">${t.done}</span></div>
    <div class="mini-stat"><span class="ms-lbl">⏳ Kutilayotgan</span><span class="ms-val" style="color:var(--blue)">${t.pending}</span></div>
    <div class="mini-stat"><span class="ms-lbl">💰 Xizmat tushumi</span><span class="ms-val" style="color:var(--teal)">${fmtMoney(t.income)} so'm</span></div>
    <div class="mini-stat"><span class="ms-lbl">💎 Mening ulushim</span><span class="ms-val" style="color:var(--green)">${fmtMoney(t.earnings)} so'm</span></div>
  `;

  // Inventory sidebar
  const invItems=DASH.inventory.items.slice(0,5);
  if(!invItems.length){
    document.getElementById('invSidebar').innerHTML='<div class="empty" style="padding:20px">Material biriktirilmagan</div>';
  } else {
    document.getElementById('invSidebar').innerHTML=invItems.map(i=>`
      <div class="inv-item">
        <div class="inv-bar-wrap" style="flex:1">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;font-weight:600">${i.name}</span>
            <span style="font-size:11px;color:${i.pct_left<20?'var(--red)':'var(--muted)'}">${i.remaining} ${i.unit}</span>
          </div>
          <div class="inv-bar-bg"><div class="inv-bar-fill ${i.pct_left<20?'inv-fill-low':'inv-fill-ok'}" style="width:${Math.min(i.pct_left,100)}%"></div></div>
        </div>
      </div>`).join('');
  }

  // Queue
  renderQueue(DASH.today.appointments);
}

// ─── Queue ────────────────────────────────────────────────────────────────────
function renderQueue(appts){
  const el=document.getElementById('queueList');
  if(!appts||!appts.length){el.innerHTML='<div class="empty">📅 Bugungi navbat yo\'q</div>';return;}

  el.innerHTML=appts.map((a,i)=>{
    let badge='',actions='';
    const st=a.status;
    if(a.is_paid){
      badge='<span class="badge b-green">✅ Yakunlandi</span>';
    } else if(st==='completed'){
      badge='<span class="badge b-red">💳 To\'lov kutilmoqda</span>';
    } else if(st==='confirmed'){
      badge='<span class="badge b-blue">💺 Kresloda</span>';
      actions=`<button class="btn btn-sm btn-green" onclick="completeAppt(${a.id})">✅ Yakunlash</button>`;
    } else if(st==='cancelled'){
      badge='<span class="badge b-red">❌ Kelmadi</span>';
    } else {
      badge='<span class="badge b-yellow">⏳ Kutmoqda</span>';
      actions=`<button class="btn btn-sm btn-blue" onclick="startAppt(${a.id})">🔵 Boshlash</button>`;
    }
    const timeAgo = a.checked_in_at?`<span style="font-size:10px;color:var(--green);margin-left:8px">Keldi: ${a.checked_in_at}</span>`:'';

    return `<div class="qcard status-${st}${a.is_paid?'':''}" id="qc-${a.id}">
      ${(st==='confirmed'&&!a.is_paid)?'<div class="q-progress"></div>':''}
      <div class="qcard-top">
        <div class="q-num">${String(i+1).padStart(2,'0')}</div>
        <div class="q-time">${a.appt_time||'—'}</div>
        <div class="q-info">
          <div class="q-client">${a.client_name} ${badge}${timeAgo}</div>
          <div class="q-detail">✂ ${a.service||'—'} · 💰 ${fmtMoney(a.price)} so'm</div>
        </div>
        <div class="q-actions">${actions}</div>
      </div>
    </div>`;
  }).join('');
}

async function startAppt(id){
  const r=await apiPatch(`/api/master/appointments/${id}/start`);
  if(r.ok){showToast(r.data.message,'success');loadDashboard();}
  else showToast(r.data.detail||'Xato','error');
}

async function completeAppt(id){
  const r=await apiPatch(`/api/appointments/${id}/status?status=completed`);
  if(r.ok){showToast('✅ Xizmat yakunlandi! Moliya yangilandi.','success');loadDashboard();}
  else showToast('Xato yuz berdi','error');
}

// ─── Earnings ─────────────────────────────────────────────────────────────────
function renderEarnings(){
  if(!DASH) return;
  const m=DASH.month;
  const pct=STAFF?.percent||30;

  document.getElementById('monthStats').innerHTML=`
    <div class="mini-stat" style="flex-direction:column;align-items:flex-start;gap:4px">
      <div class="ms-lbl">💰 Oylik Xizmat Tushumi</div>
      <div class="ms-val" style="color:var(--teal)">${fmtMoney(m.income)} so'm</div>
    </div>
    <div class="mini-stat" style="flex-direction:column;align-items:flex-start;gap:4px">
      <div class="ms-lbl">💎 Mening Ulushim (${pct}%)</div>
      <div class="ms-val" style="color:var(--green)">${fmtMoney(m.earnings)} so'm</div>
    </div>
    <div class="mini-stat" style="flex-direction:column;align-items:flex-start;gap:4px">
      <div class="ms-lbl">🏦 Oylik Maosh</div>
      <div class="ms-val" style="color:var(--blue)">${fmtMoney(m.salary)} so'm</div>
    </div>`;

  if(!m.records.length){
    document.getElementById('earningsTable').innerHTML='<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--muted)">Daromad tarixi yo\'q</td></tr>';
    return;
  }
  document.getElementById('earningsTable').innerHTML=m.records.map(r=>`<tr>
    <td style="color:var(--muted);font-size:12px">${r.date||'—'}</td>
    <td style="max-width:200px;font-size:12px">${(r.note||'').replace(/\[.*?\]/g,'').trim()}</td>
    <td style="font-weight:600;color:var(--teal)">${fmtMoney(r.amount)} so'm</td>
    <td style="font-weight:700;color:var(--green)">+${fmtMoney(r.earnings)} so'm</td>
  </tr>`).join('');
}

// ─── Inventory ────────────────────────────────────────────────────────────────
async function loadInventory(){
  const d=await apiGet('/api/master-inventory/');
  const logs=await apiGet('/api/master-inventory/logs?limit=20');
  if(!d) return;

  const staffId=STAFF?.id;
  const items=d.filter(i=>!staffId||i.master_id===staffId);

  if(!items.length){
    document.getElementById('invList').innerHTML='<div class="empty">Material biriktirilmagan</div>';
  } else {
    document.getElementById('invList').innerHTML=items.map(i=>`
      <div class="inv-item">
        <div style="font-size:20px">${i.remaining_qty<=i.min_qty?'⚠️':'🧴'}</div>
        <div class="inv-bar-wrap">
          <div style="display:flex;justify-content:space-between">
            <span style="font-size:13px;font-weight:600">${i.product_name}</span>
            <span style="font-size:12px;font-weight:700;color:${i.remaining_qty<=i.min_qty?'var(--red)':'var(--green)'}">${i.remaining_qty} / ${i.given_qty} ${i.unit}</span>
          </div>
          <div class="inv-bar-bg" style="margin-top:6px"><div class="inv-bar-fill ${i.remaining_qty<=i.min_qty?'inv-fill-low':'inv-fill-ok'}" style="width:${Math.min(i.given_qty>0?Math.round(i.remaining_qty/i.given_qty*100):0,100)}%"></div></div>
          <div style="display:flex;justify-content:space-between;margin-top:4px">
            <span style="font-size:10px;color:var(--muted)">Ishlatilgan: ${i.used_qty} ${i.unit}</span>
            ${i.remaining_qty<=i.min_qty?'<span style="font-size:10px;color:var(--red);font-weight:700">⚠ Kam qoldi!</span>':''}
          </div>
        </div>
      </div>`).join('');
  }

  // Populate modal select
  document.getElementById('matProd').innerHTML=items.map(i=>`<option value="${i.product_id}" data-master="${i.master_id}">${i.product_name} (${i.remaining_qty} ${i.unit} qoldi)</option>`).join('');

  // Logs
  if(!logs||!logs.length){
    document.getElementById('invLogs').innerHTML='<div class="empty">Loglar yo\'q</div>';
  } else {
    document.getElementById('invLogs').innerHTML=`<table class="etable">
      <thead><tr><th>Sana</th><th>Mahsulot</th><th>Amal</th><th>Miqdor</th></tr></thead>
      <tbody>${logs.map(l=>`<tr>
        <td style="font-size:11px;color:var(--muted)">${l.log_date||''}</td>
        <td style="font-size:12px">${l.product_name}</td>
        <td>${l.action==='used'?'<span style="color:var(--yellow)">→ Sarflandi</span>':'<span style="color:var(--green)">↓ Berildi</span>'}</td>
        <td style="font-weight:700">${l.quantity} ${l.unit||''}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  }
}

function openMatModal(){
  document.getElementById('matQty').value=1;
  document.getElementById('matNote').value='';
  document.getElementById('matModal').classList.add('open');
}

async function saveMat(){
  const pid=document.getElementById('matProd').value;
  const qty=parseFloat(document.getElementById('matQty').value)||1;
  const note=document.getElementById('matNote').value;
  const r=await fetch(`${API}/api/master/use-material?product_id=${pid}&qty=${qty}&note=${encodeURIComponent(note)}`,{method:'POST',headers:authH()});
  const d=await r.json();
  if(r.ok){closeModal('matModal');showToast(d.message,'success');loadInventory();}
  else showToast(d.detail||'Xato','error');
}

// ─── Timeline ─────────────────────────────────────────────────────────────────
function renderTimeline(){
  if(!DASH) return;
  const appts=DASH.today.appointments;
  const hrs=['09','10','11','12','13','14','15','16','17','18','19','20'];
  const el=document.getElementById('tlWrap');

  const hoursRow=hrs.map(h=>`<div class="tl-hr">${h}:00</div>`).join('');
  const slots=hrs.map(h=>{
    const a=appts.find(x=>x.appt_time&&x.appt_time.startsWith(h+':'));
    if(!a) return `<div class="tl-slot" title="${h}:00 — Bo'sh"></div>`;
    const cls=a.is_paid?'done':a.status==='confirmed'?'current':a.status==='completed'?'done':'busy';
    return `<div class="tl-slot ${cls}" title="${a.client_name}: ${a.service}">${a.is_paid?'✓':a.status==='confirmed'?'●':'○'}</div>`;
  }).join('');

  el.innerHTML=`
    <div style="padding-bottom:4px;color:var(--muted);font-size:12px;font-weight:600">📍 ${STAFF?.name||'Usta'}</div>
    <div class="tl-hours">${hoursRow}</div>
    <div class="tl-row">${slots}</div>
    <div style="display:flex;gap:16px;margin-top:12px;font-size:11px;color:var(--muted)">
      <span style="color:var(--green)">● Joriy/Faol</span>
      <span style="color:var(--teal)">✓ Yakunlangan</span>
      <span style="color:var(--blue)">○ Kutilayotgan</span>
    </div>`;
}

// ─── Auto refresh ─────────────────────────────────────────────────────────────
setInterval(()=>{
  if(document.getElementById('tab-queue').classList.contains('active')) loadDashboard();
},30000);

// ─── Init ─────────────────────────────────────────────────────────────────────
loadDashboard();
