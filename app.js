// ===================== CONFIG =====================
const API = 'http://localhost:8000/api';
const COLORS = ['#8B5CF6','#F43F5E','#F59E0B','#14B8A6','#EC4899','#3B82F6','#10B981'];
let currentPage = 'dashboard';
let calDate = new Date();
let editingId = null;

// ===================== AUTH GUARD (Protected Routes) =====================
(function checkAuth(){
  const token = localStorage.getItem('token');
  const role  = localStorage.getItem('role');
  if(!token){
    window.location.href = '/login/';
    return;
  }
  // Rolga qarab to'g'ri sahifaga yo'naltirish
  if(role === 'master'){
    window.location.href = '/ustalar/';
    return;
  }
  if(role === 'reception'){
    window.location.href = '/reception/';
    return;
  }
  if(role === 'superadmin'){
    window.location.href = '/superadmin/';
    return;
  }
  // Token yaroqliligini backend orqali tekshirish
  fetch(API + '/auth/verify', {
    headers: {'Authorization': 'Bearer ' + token}
  }).then(r => {
    if(!r.ok) {
      localStorage.clear();
      sessionStorage.clear();
      window.location.href = '/login/';
    }
  }).catch(() => {});
  // Sidebarni foydalanuvchi nomi bilan to'ldirish
  const fullName = localStorage.getItem('full_name') || 'Admin';
  const nameEl = document.getElementById('sidebarName');
  if(nameEl) nameEl.textContent = fullName.split(' ')[0];
  const avatarEl = document.getElementById('sidebarAvatar');
  if(avatarEl) avatarEl.textContent = (fullName[0] || 'A').toUpperCase();
})();

// ===================== API HELPERS =====================
async function api(path, method='GET', body=null) {
  const token = localStorage.getItem('token');
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? 'Bearer ' + token : '',
    }
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const r = await fetch(API + path, opts);
    if (r.status === 401) {
      localStorage.clear();
      window.location.href = '/login/';
      return;
    }
    if (!r.ok) {
      const err = await r.json().catch(()=>({detail:'Xato'}));
      if(r.status === 403 && err.detail === 'subscription_expired') {
        showSubscriptionExpiredPage();
        throw new Error('Obuna muddati tugagan');
      }
      throw new Error(err.detail || 'Server xatosi');
    }
    return r.status === 204 ? null : r.json();
  } catch(e) {
    showToast('❌ ' + e.message, 'error');
    throw e;
  }
}

// ─── Obuna tugagan — faqat to'lov sahifasi ─────
async function showSubscriptionExpiredPage() {
  if(document.getElementById('expiredOverlay')) return;
  // Tariflarni yuklash
  let tariffsHtml = '<p style="color:var(--text-muted)">Yuklanmoqda...</p>';
  try {
    const token = localStorage.getItem('token');
    const r = await fetch(API + '/billing/tariffs', {headers:{'Authorization':'Bearer '+token}});
    const tariffs = await r.json();
    tariffsHtml = tariffs.map(t => `
      <div style="background:rgba(255,255,255,.03);border:1px solid var(--card-border);border-radius:14px;padding:20px;text-align:center;min-width:200px;flex:1">
        <div style="font-size:14px;font-weight:700;margin-bottom:8px">${t.name}</div>
        <div style="font-size:24px;font-weight:800;color:var(--primary);margin-bottom:4px">${Number(t.price).toLocaleString()}</div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:14px">so'm / ${t.duration_days} kun</div>
        <button onclick="makePayment(${t.id},'click')" style="width:100%;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#8B5CF6,#EC4899);color:#fff;font-weight:700;cursor:pointer;font-size:13px;margin-bottom:6px">💳 Click</button>
        <button onclick="makePayment(${t.id},'payme')" style="width:100%;padding:10px;border:none;border-radius:10px;background:linear-gradient(135deg,#00BFFF,#3B82F6);color:#fff;font-weight:700;cursor:pointer;font-size:13px">💳 Payme</button>
      </div>
    `).join('');
  } catch(e) {}

  const overlay = document.createElement('div');
  overlay.id = 'expiredOverlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="max-width:700px;width:100%;text-align:center">
      <div style="font-size:60px;margin-bottom:16px">⏳</div>
      <h1 style="font-size:24px;font-weight:800;margin-bottom:8px">Obuna Muddati Tugagan</h1>
      <p style="color:var(--text-muted);margin-bottom:24px;font-size:14px">Tizimdan foydalanish uchun obunangizni uzaytiring. To'lov qilingach tizim avtomatik faollashadi.</p>
      <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;margin-bottom:24px">${tariffsHtml}</div>
      <button onclick="localStorage.clear();window.location.href='/login/'" style="padding:10px 24px;border:1px solid var(--card-border);border-radius:10px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:13px">🚪 Chiqish</button>
      <div id="paymentStatus" style="margin-top:16px;font-size:13px"></div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function makePayment(tariffId, provider) {
  const statusEl = document.getElementById('paymentStatus');
  if(statusEl) statusEl.innerHTML = '<span style="color:#F59E0B">⏳ To\'lov yaratilmoqda...</span>';
  try {
    const token = localStorage.getItem('token');
    const h = {'Content-Type':'application/json','Authorization':'Bearer '+token};
    const r1 = await fetch(API+'/billing/create-payment',{method:'POST',headers:h,body:JSON.stringify({tariff_id:tariffId,provider})});
    const d1 = await r1.json();
    if(!d1.ok) { if(statusEl) statusEl.innerHTML=`<span style="color:#F43F5E">${d1.detail||'Xato'}</span>`; return; }
    // Sandbox: darhol tasdiqlash
    const r2 = await fetch(API+d1.confirm_url,{method:'POST',headers:h});
    const d2 = await r2.json();
    if(d2.ok) {
      if(statusEl) statusEl.innerHTML=`<span style="color:#10B981">✅ ${d2.message}</span>`;
      setTimeout(()=>{ document.getElementById('expiredOverlay')?.remove(); location.reload(); }, 2000);
    } else {
      if(statusEl) statusEl.innerHTML=`<span style="color:#F43F5E">${d2.detail||'Xato'}</span>`;
    }
  } catch(e) { if(statusEl) statusEl.innerHTML=`<span style="color:#F43F5E">❌ ${e.message}</span>`; }
}

// ===================== NAVIGATION =====================
let currentRole = 'admin';
let currentKabinetStaff = null; // Hozir ochiq kabinet ustasi

async function switchRole(role) {
  currentRole = role;
  document.getElementById('adminMenu').style.display = role==='admin' ? '' : 'none';
  document.getElementById('ustaMenu').style.display = role==='usta' ? '' : 'none';
  document.getElementById('roleAdmin').classList.toggle('active', role==='admin');
  document.getElementById('roleUsta').classList.toggle('active', role==='usta');
  if (role==='admin') {
    document.getElementById('sidebarName').textContent = 'Admin';
    document.getElementById('sidebarRoleLabel').textContent = 'Salon Boshqaruvchi';
    document.getElementById('sidebarAvatar').textContent = 'A';
    navigate('dashboard');
  } else {
    // Usta tanlash modali
    openUstaSelector();
  }
}

async function openUstaSelector() {
  const staff = await api('/staff/');
  const list = staff.map(s => `
    <div class="usta-select-item" onclick="loginAsUsta(${s.id},'${s.name}','${s.role}','${COLORS[staff.indexOf(s)%COLORS.length]}')">
      <div class="usta-select-av" style="background:${COLORS[staff.indexOf(s)%COLORS.length]}25;color:${COLORS[staff.indexOf(s)%COLORS.length]}">${s.name[0]}</div>
      <div>
        <div style="font-size:14px;font-weight:600">${s.name}</div>
        <div style="font-size:12px;color:var(--text-muted)">${s.role}</div>
      </div>
      <div style="margin-left:auto;font-size:12px;color:var(--primary-light)">→ Kirish</div>
    </div>`).join('');
  document.getElementById('ustaSelectorList').innerHTML = list;
  openModal('ustaSelectorModal');
}

function loginAsUsta(id, name, role, color) {
  closeModal('ustaSelectorModal');
  document.getElementById('sidebarName').textContent = name.split(' ')[0]+' '+name.split(' ')[1]?.[0]+'.';
  document.getElementById('sidebarRoleLabel').textContent = role;
  document.getElementById('sidebarAvatar').textContent = name[0];
  document.getElementById('sidebarAvatar').style.background = color+'25';
  document.getElementById('sidebarAvatar').style.color = color;
  openKabinet(id, name, role, null, null, null, color);
}

function openKabinet(id, name, role, percent, salary, kpi, color) {
  currentKabinetStaff = {id, name, role, percent, salary, kpi, color};
  navigate('kabinet');
}

function openAssign(id, name, kpi, salary, percent) {
  document.getElementById('assign-staff-id').value = id;
  document.getElementById('assign-staff-name').textContent = name;
  document.getElementById('assign-kpi').value = kpi;
  document.getElementById('assign-salary').value = salary;
  document.getElementById('assign-percent').value = percent;
  document.getElementById('assign-advance').value = 0;
  openModal('assignModal');
}

async function saveAssign() {
  const id = document.getElementById('assign-staff-id').value;
  const kpi = parseFloat(document.getElementById('assign-kpi').value)||80;
  const salary = parseFloat(document.getElementById('assign-salary').value)||0;
  const percent = parseFloat(document.getElementById('assign-percent').value)||30;
  const advance = parseFloat(document.getElementById('assign-advance').value)||0;
  // KPI va maosh yangilash
  const staff = (await api('/staff/')).find(s=>s.id==id);
  if (staff) {
    await api(`/staff/${id}`,'PUT',{...staff, kpi, salary, percent});
    if (advance>0) {
      await api('/finance/','POST',{type:'expense', category:'Avans', amount:advance, note:`${staff.name} ga avans`, fin_date:today()});
    }
  }
  closeModal('assignModal');
  showToast('✅ Usta ma\'lumotlari yangilandi!','success');
  renderTeam();
}

function navigate(page) {
  // Barcha page larni yashirish
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));

  // Kabinet alohida — main ni yashirish kerak
  const mainContent = document.getElementById('mainContent');
  if (page === 'kabinet') {
    mainContent.style.display = 'none';
  } else {
    mainContent.style.display = '';
  }

  const el = document.getElementById('page-'+page);
  if (el) el.classList.add('active');
  const activeNav = document.querySelector(`[data-page="${page}"]`);
  if (activeNav) activeNav.classList.add('active');
  currentPage = page;

  const titles = {dashboard:'Navbatlar & Bron', team:'Xodimlar & Ustalar', services:'Xizmatlar & Mahsulot', crm:'Mijozlar Bazasi (CRM)', finance:'Moliyaviy Tahlil', kabinet:'Mening Kabinetim', settings:'Sozlamalar', logs:'Aktivlik Tarixi'};
  document.getElementById('pageTitle').textContent = titles[page] || page;
  const addLabels = {dashboard:'+ Yangi Bron', team:'+ Usta Qo\'shish', services:'+ Qo\'shish', crm:'+ Mijoz Qo\'shish', finance:'+ Kirim/Chiqim', kabinet:'', settings:'', logs:''};
  document.getElementById('addNewBtn').textContent = addLabels[page] || '';
  document.getElementById('addNewBtn').style.display = (page === 'kabinet' || page === 'settings' || page === 'logs') ? 'none' : '';

  renderPage(page);
}

function openAddModal() {
  const map = {dashboard:'bronModal', team:'staffModal', services:'serviceModal', crm:'clientModal'};
  if (map[currentPage]) { editingId=null; openModal(map[currentPage]); }
}

function renderPage(page) {
  if (page==='dashboard') renderDashboard();
  if (page==='team') renderTeam();
  if (page==='services') renderServices();
  if (page==='crm') renderCRM();
  if (page==='finance') renderFinance();
  if (page==='kabinet') renderKabinet();
  if (page==='settings') renderSettings();
  if (page==='logs') loadActivityLogs();
}

// ===================== DASHBOARD =====================
async function renderDashboard() {
  const dateStr = calDate.toISOString().split('T')[0];
  document.getElementById('calDateLabel').textContent = formatDateUz(calDate);

  const [appts, stats] = await Promise.all([
    api(`/appointments?date=${dateStr}`),
    api('/dashboard/stats')
  ]);

  document.getElementById('stat-today').textContent = stats.today_bookings;
  document.getElementById('stat-masters').textContent = stats.active_staff;
  document.getElementById('stat-revenue').textContent = fmtMoney(stats.today_income);
  document.getElementById('stat-clients').textContent = stats.total_clients;
  document.getElementById('todayCount').textContent = appts.length;

  renderTimeline(appts);
  renderAppointmentsList(appts);
  renderMastersStatus(appts);
}

function renderTimeline(appts) {
  const hours = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00'];
  document.getElementById('timelineContainer').innerHTML = hours.map(h => {
    const a = appts.find(x => x.appt_time && x.appt_time.startsWith(h.split(':')[0]+':'));
    return `<div class="timeline-slot">
      <div class="timeline-time">${h}</div>
      <div class="timeline-line ${a?'has-appt':''}"></div>
      ${a ? `<div class="timeline-appt"><div class="appt-name">${a.client_name}</div><div class="appt-service">${a.service} • ${a.master}</div></div>`
           : `<div class="timeline-empty"><span>Bo'sh</span></div>`}
    </div>`;
  }).join('');
}

function renderAppointmentsList(appts) {
  const el = document.getElementById('appointmentsList');
  if (!appts.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">📅</div><p>Bugun bron yo\'q</p></div>'; return; }
  el.innerHTML = appts.map(a => `
    <div class="appt-card ${a.status}" id="appt-${a.id}">
      <div class="appt-avatar">${a.client_name[0]}</div>
      <div class="appt-info">
        <div class="appt-client">${a.client_name} <span class="appt-source ${a.source}">${a.source==='bot'?'🤖 Bot':'👤 Admin'}</span></div>
        <div class="appt-meta">${a.service} • ${a.master}</div>
      </div>
      <div class="appt-time-badge">${a.appt_time}</div>
      ${a.status!=='completed'
        ? `<button class="appt-status-btn complete" onclick="completeAppt(${a.id})">✓</button>`
        : `<button class="appt-status-btn completed">✓ Tugadi</button>`}
      <button class="btn-danger" style="font-size:11px;padding:4px 8px" onclick="deleteAppt(${a.id})">🗑</button>
    </div>`).join('');
}

async function completeAppt(id) {
  await api(`/appointments/${id}/status?status=completed`, 'PATCH');
  showToast('✅ Xizmat tugadi!', 'success');
  renderDashboard();
}

async function deleteAppt(id) {
  if (!confirm('Bronni o\'chirishni tasdiqlaysizmi?')) return;
  await api(`/appointments/${id}`, 'DELETE');
  showToast('🗑 Bron o\'chirildi', 'error');
  renderDashboard();
}

async function renderMastersStatus(appts) {
  const staff = await api('/staff/');
  document.getElementById('mastersStatus').innerHTML = staff.map((s,i) => {
    const busy = appts.some(a=>a.master===s.name.split(' ')[0] && a.status!=='completed');
    const color = COLORS[i%COLORS.length];
    return `<div class="master-status-card">
      <div class="master-status-avatar" style="background:${color}20;color:${color}">${s.name[0]}</div>
      <div class="master-status-name">${s.name.split(' ')[0]}</div>
      <div class="master-status-role">${s.role}</div>
      <span class="status-pill ${busy?'busy':'free'}">${busy?'🔴 Band':'🟢 Bo\'sh'}</span>
    </div>`;
  }).join('');
}

function prevDay() { calDate.setDate(calDate.getDate()-1); renderDashboard(); }
function nextDay() { calDate.setDate(calDate.getDate()+1); renderDashboard(); }

// ===================== TEAM =====================
async function renderTeam() {
  const staff = await api('/staff/');
  const todayAppts = await api(`/appointments?date=${today()}`);

  const avgKPI = staff.length ? Math.round(staff.reduce((s,x)=>s+x.kpi,0)/staff.length) : 0;
  document.getElementById('stat-totalStaff').textContent = staff.length;
  document.getElementById('stat-avgKPI').textContent = avgKPI+'%';
  document.getElementById('stat-totalSalary').textContent = fmtMoney(staff.reduce((s,x)=>s+x.salary,0));
  document.getElementById('stat-todayTasks').textContent = todayAppts.length;

  document.getElementById('staffGrid').innerHTML = staff.map((s,i) => {
    const color     = COLORS[i%COLORS.length];

    const myAppts   = todayAppts.filter(a => a.master && a.master.includes(s.name.split(' ')[0]));
    const busyCount = myAppts.filter(a=>a.status!=='completed'&&a.status!=='cancelled').length;
    const doneCount = myAppts.filter(a=>a.status==='completed').length;
    // User info async — placeholder, will be filled after
    return `<div class="staff-card" id="staff-card-${s.id}">
      <div class="staff-card-top">
        <div class="staff-avatar" style="background:${color}25;color:${color}">${s.name[0]}</div>
        <div style="flex:1">
          <div class="staff-name">${s.name}</div>
          <span class="staff-role-badge">${s.role}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
          <span style="font-size:11px;background:${busyCount?'rgba(59,130,246,0.15)':'rgba(16,185,129,0.15)'};color:${busyCount?'var(--primary-light)':'var(--teal)'};padding:3px 8px;border-radius:6px">${busyCount?'🔵 '+busyCount+' ta band':'🟢 Bo\'sh'}</span>
          <span style="font-size:11px;color:var(--text-muted)">✅ ${doneCount} ta tugadi</span>
        </div>
      </div>
      <div id="uinfo-${s.id}" style="margin-top:8px"><div style="font-size:11px;color:var(--text-muted);padding:4px">🔄 Login yuklanmoqda...</div></div>
      <div class="staff-stats">
        <div class="staff-stat"><div class="staff-stat-val">${s.percent}%</div><div class="staff-stat-lbl">Foiz</div></div>
        <div class="staff-stat"><div class="staff-stat-val">${fmtMoney(s.salary)}</div><div class="staff-stat-lbl">Maosh</div></div>
        <div class="staff-stat"><div class="staff-stat-val" style="color:${s.kpi>=85?'var(--teal)':s.kpi>=70?'var(--gold)':'var(--rose)'}">${s.kpi}%</div><div class="staff-stat-lbl">KPI</div></div>
      </div>
      <div class="kpi-bar"><div class="kpi-fill" style="width:${s.kpi}%"></div></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
        <span style="font-size:11px;color:var(--text-muted)">📞 ${s.phone||'—'}</span>
      </div>
      <div id="ubtns-${s.id}" style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button class="btn-primary" style="flex:1;font-size:12px;padding:8px" onclick="openKabinet(${s.id},'${s.name}','${s.role}',${s.percent},${s.salary},${s.kpi},'${color}')">🏠 Kabinet</button>
        <button style="background:rgba(245,158,11,0.15);color:var(--gold);border:1px solid rgba(245,158,11,0.25);border-radius:10px;padding:8px 10px;cursor:pointer;font-size:12px;font-weight:600" onclick="openAssign(${s.id},'${s.name}',${s.kpi},${s.salary},${s.percent})">⚙️</button>
        <button class="btn-ghost" onclick="editStaff(${s.id})">✏️</button>
        <button class="btn-danger" onclick="deleteStaff(${s.id},'${s.name}')">🗑</button>
      </div>
    </div>`;
  }).join('');

  // Login ma'lumotlarini async yuklash va kartalarni yangilash
  staff.forEach(async (s) => {
    try {
      const u = await fetch(`${API}/staff/${s.id}/user-info`, {
        headers: {'Authorization': 'Bearer ' + localStorage.getItem('token')}
      }).then(r => r.json());

      const infoEl = document.getElementById(`uinfo-${s.id}`);
      const btnsEl = document.getElementById(`ubtns-${s.id}`);
      if (!infoEl || !btnsEl) return;
      const color = COLORS[staff.indexOf(s) % COLORS.length];

      if (u.has_account) {
        infoEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:9px">
          <span>🔑</span>
          <span style="font-size:13px;font-weight:700;color:var(--primary-light)">${u.username}</span>
          <span style="margin-left:auto;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700;background:${u.is_active?'rgba(16,185,129,0.15)':'rgba(244,63,94,0.15)'};color:${u.is_active?'var(--teal)':'#F43F5E'}">${u.is_active?'🟢 Faol':'🔴 Bloklangan'}</span>
        </div>`;
        const blockBtn = u.is_active
          ? `<button style="background:rgba(244,63,94,0.12);color:#F43F5E;border:1px solid rgba(244,63,94,0.3);border-radius:9px;padding:7px 10px;cursor:pointer;font-size:11px;font-weight:700" onclick="blockStaff(${s.id},'${s.name}')">🔒 Bloklash</button>`
          : `<button style="background:rgba(16,185,129,0.12);color:var(--teal);border:1px solid rgba(16,185,129,0.3);border-radius:9px;padding:7px 10px;cursor:pointer;font-size:11px;font-weight:700" onclick="unblockStaff(${s.id},'${s.name}')">🔓 Faollashtirish</button>`;
        btnsEl.insertAdjacentHTML('beforeend', blockBtn);
        if (!u.is_active) document.getElementById(`staff-card-${s.id}`).style.opacity = '0.65';
      } else {
        infoEl.innerHTML = `<div style="padding:6px 10px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;font-size:11px;color:var(--gold)">⚠ Login yaratilmagan</div>`;
      }
    } catch(e) {}
  });
}

async function deleteStaff(id, name) {
  const msg = `"${name||'Xodim'}" ni o'chirasizmi?\n\nTavsiya: "Bloklash" tugmasi xavfsizroq — ma'lumotlar saqlanib qoladi.`;
  if (!confirm(msg)) return;
  await api(`/staff/${id}`, 'DELETE');
  showToast('🗑 Xodim o\'chirildi', 'error');
  renderTeam();
}

async function editStaff(id) {

  const staff = (await api('/staff/')).find(x=>x.id===id);
  if (!staff) return;
  editingId = id;
  document.getElementById('staff-name').value = staff.name;
  document.getElementById('staff-phone').value = staff.phone||'';
  document.getElementById('staff-role').value = staff.role||'Sartarosh';
  document.getElementById('staff-percent').value = staff.percent||30;
  document.getElementById('staff-salary').value = staff.salary||0;
  document.getElementById('staff-start').value = staff.start_date||'';
  document.getElementById('staff-bio').value = staff.bio||'';
  document.getElementById('staff-highlights').value = staff.highlights||'';
  document.getElementById('staff-experience').value = staff.experience||0;
  // Skills checkboxlarini to'ldirish
  const staffSkills = (staff.skills||'').split(',').map(s=>s.trim());
  document.querySelectorAll('#skillsCheckGrid input').forEach(cb => {
    cb.checked = staffSkills.includes(cb.value);
  });
  openModal('staffModal');
}

// ===================== SERVICES =====================
async function renderServices() {
  const [services, inventory] = await Promise.all([api('/services/'), api('/inventory/')]);
  const catIcons = {Soch:'💇',Manikyur:'💅',Pedikyur:'🦶',Makiyaj:'💄',Kosmetologiya:'✨',Massaj:'💆',Boshqa:'⭐'};

  document.getElementById('servicesList').innerHTML = services.map(s=>`
    <div class="service-item">
      <div class="service-cat-icon">${catIcons[s.category]||'⭐'}</div>
      <div style="flex:1"><div class="service-name">${s.name}</div><div class="service-cat">${s.category} • ${s.duration} daqiqa</div></div>
      <div class="service-price">${fmtMoney(s.price)} so'm</div>
      <button class="btn-danger" onclick="deleteSvc(${s.id})">🗑</button>
    </div>`).join('');

  document.getElementById('inventoryList').innerHTML = inventory.map(i=>{
    const low = i.qty <= i.min_qty;
    return `<div class="service-item">
      <div class="service-cat-icon">🧴</div>
      <div style="flex:1"><div class="service-name">${i.name}</div><div class="service-cat">${i.category} ${low?'<span class="low-badge">⚠ Kam qoldi</span>':''}</div></div>
      <div class="inv-qty ${low?'low':'ok'}">${i.qty} ${i.unit}</div>
      <div class="service-price" style="margin-left:12px">${fmtMoney(i.price)}</div>
      <button class="btn-danger" onclick="deleteInv(${i.id})">🗑</button>
    </div>`;
  }).join('');
}

function switchServiceTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c=>c.classList.remove('active'));
  document.getElementById('tab-'+tab).classList.add('active');
  if (event && event.target) event.target.classList.add('active');
  if (tab === 'master-inv') loadMasterInv();
}

async function deleteSvc(id) { await api(`/services/${id}`,'DELETE'); showToast('🗑 Xizmat o\'chirildi','error'); renderServices(); }
async function deleteInv(id) { await api(`/inventory/${id}`,'DELETE'); showToast('🗑 Mahsulot o\'chirildi','error'); renderServices(); }

// ===== MASTER INVENTORY (Admin) =====
let _masterInvProducts = [];

async function loadMasterInv() {
  const [items, alerts, analytics] = await Promise.all([
    api('/master-inventory/'),
    api('/master-inventory/low-stock'),
    api('/master-inventory/analytics'),
  ]);

  // Alerts
  const alertBox = document.getElementById('lowStockAlerts');
  if (alerts.length) {
    alertBox.innerHTML = `<div style="background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);border-radius:14px;padding:14px 18px;margin-bottom:16px">
      <div style="font-size:13px;font-weight:700;color:#F43F5E;margin-bottom:8px">⚠ Kam qolgan materiallar</div>
      ${alerts.map(a=>`<div style="font-size:12px;color:var(--text-muted);padding:4px 0">
        <strong>${a.master_name}</strong>da <strong>${a.product_name}</strong>: ${a.remaining} ${a.unit} qoldi 
        <span style="color:#F43F5E">(Min: ${a.min_qty})</span>
      </div>`).join('')}
    </div>`;
  } else {
    alertBox.innerHTML = '';
  }

  // Jadval
  const tbl = document.getElementById('masterInvTable');
  if (!items.length) {
    tbl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted)">Hali hech qanday material tarqatilmagan</div>';
  } else {
    tbl.innerHTML = `<table class="data-table">
      <thead><tr>
        <th>Usta</th><th>Mahsulot</th><th>Berilgan</th><th>Ishlatilgan</th><th>Qolgan</th><th>Holat</th>
      </tr></thead>
      <tbody>${items.map(i=>{
        const low = i.remaining_qty <= i.min_qty;
        const pct = i.given_qty > 0 ? Math.round(i.used_qty/i.given_qty*100) : 0;
        return `<tr>
          <td><strong>${i.master_name}</strong></td>
          <td>${i.product_name}</td>
          <td>${i.given_qty} ${i.unit}</td>
          <td>${i.used_qty} ${i.unit} <span style="font-size:11px;color:var(--text-muted)">(${pct}%)</span></td>
          <td style="font-weight:700;color:${low?'#F43F5E':'#10B981'}">${i.remaining_qty} ${i.unit}</td>
          <td>${low?'<span style="background:rgba(244,63,94,0.15);color:#F43F5E;padding:3px 10px;border-radius:8px;font-size:11px">⚠ Kam</span>':'<span style="background:rgba(16,185,129,0.12);color:#10B981;padding:3px 10px;border-radius:8px;font-size:11px">✓ Yaxshi</span>'}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  }

  // Analytics
  const aEl = document.getElementById('masterInvAnalytics');
  if (analytics.length) {
    const maxUsed = Math.max(...analytics.map(a=>a.total_used), 1);
    aEl.innerHTML = `<div style="padding:8px 0">${analytics.map((a,i)=>`
      <div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid rgba(59,130,246,0.07)">
        <div style="font-size:18px;font-weight:800;color:var(--text-muted);min-width:24px">${i+1}</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:600;margin-bottom:4px">${a.master_name}</div>
          <div style="height:6px;background:rgba(255,255,255,0.05);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${Math.round(a.total_used/maxUsed*100)}%;background:linear-gradient(90deg,#3B82F6,#06B6D4);border-radius:3px"></div>
          </div>
        </div>
        <div style="font-size:14px;font-weight:700;color:var(--primary-light)">${a.total_used} dona</div>
      </div>`).join('')}
    </div>`;
  }

  loadInvLogs();
}

async function loadInvLogs() {
  const logs = await api('/master-inventory/logs?limit=30');
  const el = document.getElementById('invLogsTable');
  if (!logs.length) { el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-muted)">Loglar yo\'q</div>'; return; }
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Sana</th><th>Usta</th><th>Mahsulot</th><th>Amal</th><th>Miqdor</th><th>Izoh</th></tr></thead>
    <tbody>${logs.map(l=>`<tr>
      <td style="font-size:12px">${l.log_date||''}</td>
      <td>${l.master_name}</td>
      <td>${l.product_name}</td>
      <td>${l.action==='given'?'<span style="color:#10B981">↓ Berildi</span>':l.action==='used'?'<span style="color:#F59E0B">→ Ishlatildi</span>':'<span style="color:#60A5FA">← Qaytarildi</span>'}</td>
      <td style="font-weight:700">${l.quantity}</td>
      <td style="font-size:12px;color:var(--text-muted)">${l.note||''}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function openDistributeModal() {
  const [staff, products] = await Promise.all([api('/staff/'), api('/inventory/')]);
  _masterInvProducts = products;
  document.getElementById('dist-master').innerHTML = staff.map(s=>`<option value="${s.id}">${s.name}</option>`).join('');
  document.getElementById('dist-product').innerHTML = products.map(p=>`<option value="${p.id}">${p.name} (${p.qty} ${p.unit})</option>`).join('');
  showProductStock();
  openModal('distributeModal');
}

function showProductStock() {
  const sel = document.getElementById('dist-product');
  const pid = parseInt(sel.value);
  const prod = _masterInvProducts.find(p=>p.id===pid);
  if (prod) {
    const low = prod.qty <= prod.min_qty;
    document.getElementById('dist-stock-info').innerHTML = 
      `Asosiy sklad: <strong style="color:${low?'#F43F5E':'#10B981'}">${prod.qty} ${prod.unit}</strong>${low?' ⚠ Kam qoldi':''}`;
  }
}

async function saveDistribute() {
  const master_id = document.getElementById('dist-master').value;
  const product_id = document.getElementById('dist-product').value;
  const qty = parseFloat(document.getElementById('dist-qty').value)||0;
  const note = document.getElementById('dist-note').value;
  if (!qty || qty <= 0) { showToast('⚠ Miqdorni kiriting!','error'); return; }
  try {
    const res = await api(`/master-inventory/distribute?master_id=${master_id}&product_id=${product_id}&quantity=${qty}&note=${encodeURIComponent(note)}`, 'POST');
    closeModal('distributeModal');
    showToast(`✅ ${res.message}`, 'success');
    renderServices();
    loadMasterInv();
  } catch(e) {
    showToast('❌ ' + (e.message||'Xato!'), 'error');
  }
}

// ===================== CRM =====================
async function renderCRM() {
  const clients = await api('/clients/');
  document.getElementById('stat-totalClients').textContent = clients.length;
  document.getElementById('stat-loyalClients').textContent = clients.filter(c=>c.visits>=5).length;
  document.getElementById('stat-bonusPool').textContent = Math.round(clients.reduce((s,c)=>s+c.bonus,0));
  document.getElementById('stat-botClients').textContent = clients.filter(c=>c.source==='bot').length;
  renderClientsList(clients);
}

function renderClientsList(clients) {
  const el = document.getElementById('clientsTable');
  if (!clients.length) { el.innerHTML = '<div class="empty-state"><div class="empty-icon">👤</div><p>Mijozlar topilmadi</p></div>'; return; }
  el.innerHTML = clients.map((c,i)=>{
    const color = COLORS[i%COLORS.length];
    return `<div class="client-row">
      <div class="client-av" style="background:${color}25;color:${color}">${c.name[0]}</div>
      <div style="flex:1.2"><div class="client-name">${c.name}</div><div class="client-phone">${c.phone}</div></div>
      <div class="client-prefs">${c.prefs||'—'}</div>
      <div class="client-visits"><div class="client-visits-val">${c.visits}</div><div class="client-visits-lbl">Tashrif</div></div>
      <span class="bonus-pill">🎁 ${Math.round(c.bonus)} ball</span>
      <span class="source-icon">${c.source==='bot'?'🤖':'👤'}</span>
      <button class="btn-ghost" onclick="editClient(${c.id})">✏️</button>
      <button class="btn-ghost" onclick="bronClient('${c.name}','${c.phone}')">📅 Bron</button>
      <button class="btn-danger" onclick="deleteClient(${c.id})">🗑</button>
    </div>`;
  }).join('');
}

async function filterClients() {
  const q = document.getElementById('clientSearch').value.toLowerCase();
  const all = await api('/clients/');
  renderClientsList(all.filter(c=>c.name.toLowerCase().includes(q)||c.phone.includes(q)));
}

function bronClient(name, phone) {
  document.getElementById('bron-name').value = name;
  document.getElementById('bron-phone').value = phone;
  navigate('dashboard');
  openModal('bronModal');
}

async function deleteClient(id) {
  if (!confirm('Mijozni o\'chirishni tasdiqlaysizmi?')) return;
  await api(`/clients/${id}`,'DELETE');
  showToast('🗑 Mijoz o\'chirildi','error'); renderCRM();
}

async function editClient(id) {
  const all = await api('/clients/');
  const c = all.find(x=>x.id===id); if(!c) return;
  editingId = id;
  document.getElementById('client-name').value = c.name;
  document.getElementById('client-phone').value = c.phone;
  document.getElementById('client-prefs').value = c.prefs||'';
  document.getElementById('client-birthday').value = c.birthday||'';
  document.getElementById('client-note').value = c.note||'';
  openModal('clientModal');
}

// ===================== FINANCE =====================
let _kpiPeriod = 'month';

async function renderFinance() {
  const [items, summary, smartStats, staff] = await Promise.all([
    api('/finance/'),
    api('/finance/summary'),
    api('/finance/smart-stats'),
    api('/staff/'),
  ]);

  // Stats
  document.getElementById('stat-monthRevenue').textContent = fmtMoney(summary.month.income);
  document.getElementById('stat-monthExpense').textContent = fmtMoney(summary.month.expense);
  document.getElementById('stat-netProfit').textContent = fmtMoney(summary.month.net);
  document.getElementById('stat-profitMargin').textContent = summary.month.income > 0
    ? Math.round(summary.month.net / summary.month.income * 100) + '%' : '0%';

  // Usta select (kirim formasi uchun)
  const finMaster = document.getElementById('finMaster');
  if (finMaster) {
    finMaster.innerHTML = '<option value="">— Usta tanlanmagan —</option>' +
      staff.map(s => `<option value="${s.name.split(' ')[0]}">${s.name}</option>`).join('');
  }

  // KPI filter uchun usta select
  const kpiFilt = document.getElementById('kpiMasterFilter');
  if (kpiFilt && staff.length) {
    kpiFilt.innerHTML = '<option value="">Barchasi</option>' +
      staff.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }

  // Kategoriyalarni dinamik yuklash
  await loadFinanceCategories();
  await loadExpenseButtons();

  // 3 Aqlli vidjet
  renderSmartWidgets(smartStats);

  // Tranzaksiyalar
  document.getElementById('financeList').innerHTML = items.slice(0, 20).map(f => {
    const masterHint = f.note && staff.find(s => f.note.includes(s.name.split(' ')[0]));
    const pct = masterHint ? `(${masterHint.percent || 30}%)` : '';
    return `<div class="fin-item">
      <div class="fin-icon ${f.type}">${f.type === 'income' ? '📈' : '📉'}</div>
      <div style="flex:1">
        <div class="fin-cat">${f.category} ${masterHint ? `<span style="color:var(--primary-light);font-size:11px">• ${masterHint.name.split(' ')[0]} ${pct}</span>` : ''}</div>
        <div class="fin-note">${f.note || ''}</div>
      </div>
      <div style="text-align:right">
        <div class="fin-amount ${f.type}">${f.type === 'income' ? '+' : '-'}${fmtMoney(f.amount)}</div>
        <div class="fin-date">${f.fin_date}</div>
      </div>
      <button class="btn-danger" style="font-size:11px;padding:4px 8px" onclick="deleteFin(${f.id})">🗑</button>
    </div>`;
  }).join('');

  renderChart(items);
}

// ─── Dinamik kategoriyalar ─────
async function loadFinanceCategories() {
  const sel = document.getElementById('finCategory');
  if(!sel) return;
  const finType = document.getElementById('finType')?.value || 'income';
  const catType = finType === 'income' ? 'finance_income' : 'finance_expense';
  try {
    const cats = await api(`/admin/categories?cat_type=${catType}`);
    sel.innerHTML = cats.map(c => `<option value="${c.name}">${c.icon} ${c.name}</option>`).join('');
  } catch(e) {
    sel.innerHTML = '<option>Boshqa</option>';
  }
}

async function loadExpenseButtons() {
  const container = document.getElementById('expCatButtons');
  if(!container) return;
  try {
    const cats = await api('/admin/categories?cat_type=expense_operational');
    container.innerHTML = cats.map((c, i) =>
      `<button class="btn-ghost expense-cat-btn${i===0?' active':''}" onclick="setExpCat(this,'${c.name}')" style="font-size:12px;padding:6px 12px;border-radius:20px;border:1px solid var(--card-border)">${c.icon} ${c.name}</button>`
    ).join('');
    if(cats.length > 0) {
      document.getElementById('expCategory').value = cats[0].name;
    }
  } catch(e) {}
}

// finType o'zgarganda kategoriyalarni yangilash
document.addEventListener('DOMContentLoaded', () => {
  const finTypeEl = document.getElementById('finType');
  if(finTypeEl) finTypeEl.addEventListener('change', loadFinanceCategories);
});

// ─── Kategoriya boshqarish modali ─────
let _currentCatTab = 'finance_income';

function openCategoryManager() {
  _currentCatTab = 'finance_income';
  openModal('categoryModal');
  loadCatManagerList();
}

function switchCatTab(type, btn) {
  _currentCatTab = type;
  document.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  loadCatManagerList();
}

async function loadCatManagerList() {
  const el = document.getElementById('catManagerList');
  try {
    const cats = await api(`/admin/categories?cat_type=${_currentCatTab}`);
    if(!cats.length) { el.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Kategoriya yo\'q</div>'; return; }
    el.innerHTML = cats.map(c => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--card-border)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">${c.icon}</span>
        <span style="font-weight:600;font-size:14px">${c.name}</span>
      </div>
      <button class="btn-danger" style="font-size:11px;padding:4px 10px;border-radius:8px" onclick="deleteCategory(${c.id})">🗑 O'chirish</button>
    </div>`).join('');
  } catch(e) { el.innerHTML = '<div style="color:var(--text-muted);padding:20px">Yuklanmadi</div>'; }
}

async function addNewCategory() {
  const name = document.getElementById('catNewName').value.trim();
  const icon = document.getElementById('catNewIcon').value.trim() || '📁';
  if(!name) { showToast('⚠ Kategoriya nomini kiriting!', 'error'); return; }
  try {
    const res = await api('/admin/categories', 'POST', { type: _currentCatTab, name, icon });
    showToast('✅ ' + res.message, 'success');
    document.getElementById('catNewName').value = '';
    document.getElementById('catNewIcon').value = '';
    loadCatManagerList();
    loadFinanceCategories();
    loadExpenseButtons();
  } catch(e) { showToast('❌ Xato', 'error'); }
}

async function deleteCategory(id) {
  if(!confirm('Bu kategoriyani o\'chirmoqchimisiz?')) return;
  try {
    const res = await api(`/admin/categories/${id}`, 'DELETE');
    showToast(res.message, 'success');
    loadCatManagerList();
    loadFinanceCategories();
    loadExpenseButtons();
  } catch(e) { showToast('❌ Xato', 'error'); }
}

function renderSmartWidgets(s) {
  const el = document.getElementById('smartWidgets');
  if (!el) return;
  const effColor = s.mat_efficiency < 10 ? '#10B981' : s.mat_efficiency < 20 ? '#F59E0B' : '#F43F5E';
  el.innerHTML = `
    <div class="smart-widget">
      <div class="sw-icon" style="background:rgba(245,158,11,0.12);color:#F59E0B">⭐</div>
      <div class="sw-body">
        <div class="sw-label">Eng daromadli usta</div>
        <div class="sw-value">${s.best_staff?.name?.split(' ')[0] || '—'}</div>
        <div class="sw-sub">${fmtMoney(s.best_staff?.income || 0)} so'm (oy)</div>
      </div>
    </div>
    <div class="smart-widget">
      <div class="sw-icon" style="background:rgba(244,63,94,0.12);color:${effColor}">📉</div>
      <div class="sw-body">
        <div class="sw-label">Material samaradorligi</div>
        <div class="sw-value" style="color:${effColor}">${s.mat_efficiency}%</div>
        <div class="sw-sub">${fmtMoney(s.mat_expenses)} so'm xomashyo (oy)</div>
      </div>
    </div>
    <div class="smart-widget">
      <div class="sw-icon" style="background:rgba(59,130,246,0.12);color:#60A5FA">💰</div>
      <div class="sw-body">
        <div class="sw-label">To'lanishi kerak</div>
        <div class="sw-value" style="color:#60A5FA">${fmtMoney(s.pending_salaries)}</div>
        <div class="sw-sub">Ustalar oylik jamg'armasi</div>
      </div>
    </div>`;
}

// ===== KPI DASHBOARD =====
async function switchFinTab(tab) {
  document.querySelectorAll('.services-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#page-finance .tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('fintab-' + tab).classList.add('active');
  if (event && event.target) event.target.classList.add('active');
  if (tab === 'kpi') loadKpiDashboard();
}

async function setKpiPeriod(period, btn) {
  _kpiPeriod = period;
  document.querySelectorAll('.kpi-period-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const labels = {today:'Bugungi', week:'Haftalik', month:'Oylik', all:'Barcha davr'};
  const el = document.getElementById('kpiPeriodLabel');
  if (el) el.textContent = labels[period];
  await loadKpiDashboard();
}

async function loadKpiDashboard() {
  const masterId = document.getElementById('kpiMasterFilter')?.value || '';
  const url = `/finance/kpi-dashboard?period=${_kpiPeriod}${masterId ? '&master_id=' + masterId : ''}`;
  const data = await api(url);

  // Summary cards
  const t = data.totals;
  document.getElementById('kpiSummary').innerHTML = `
    <div class="kpi-sum-card">
      <div class="kpi-sum-label">💰 Jami tushum</div>
      <div class="kpi-sum-val green">${fmtMoney(t.total_income)} so'm</div>
    </div>
    <div class="kpi-sum-card">
      <div class="kpi-sum-label">👷 Usta ulushi</div>
      <div class="kpi-sum-val rose">${fmtMoney(t.usta_share_total)} so'm</div>
    </div>
    <div class="kpi-sum-card">
      <div class="kpi-sum-label">🧴 Material xarajat</div>
      <div class="kpi-sum-val gold">${fmtMoney(t.mat_cost_total)} so'm</div>
    </div>
    <div class="kpi-sum-card">
      <div class="kpi-sum-label">🏢 Umumiy xarajat</div>
      <div class="kpi-sum-val rose">${fmtMoney(t.global_expenses)} so'm</div>
    </div>
    <div class="kpi-sum-card" style="border-color:rgba(16,185,129,0.3)">
      <div class="kpi-sum-label">💎 Sof salon foydasi</div>
      <div class="kpi-sum-val green" style="font-size:22px">${fmtMoney(t.net_salon_profit)} so'm</div>
    </div>`;

  // Jadval
  const rows = data.rows;
  if (!rows.length) {
    document.getElementById('kpiTable').innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Ma\'lumot yo\'q</div>';
    return;
  }

  const maxIncome = Math.max(...rows.map(r => r.total_income), 1);

  document.getElementById('kpiTable').innerHTML = `
    <table class="data-table kpi-table">
      <thead><tr>
        <th>Usta</th><th>KPI %</th><th>Jami tushum</th>
        <th>Usta ulushi</th><th>Material</th><th>Salon foydasi</th><th>To'lanmagan</th>
      </tr></thead>
      <tbody>${rows.map(r => {
        const profitPct = r.total_income > 0 ? Math.round(r.salon_profit / r.total_income * 100) : 0;
        const incomeW = Math.round(r.total_income / maxIncome * 100);
        return `<tr>
          <td>
            <div style="font-weight:700">${r.name}</div>
            <div style="font-size:11px;color:var(--text-muted)">${r.role}</div>
            <div style="margin-top:4px;height:3px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden">
              <div style="height:100%;width:${incomeW}%;background:linear-gradient(90deg,#3B82F6,#06B6D4)"></div>
            </div>
          </td>
          <td>
            <div style="font-weight:700;color:${r.kpi>=80?'#10B981':'#F59E0B'}">${r.kpi}%</div>
            <div style="font-size:11px;color:var(--text-muted)">${r.percent}% ulush</div>
          </td>
          <td style="font-weight:700;color:#10B981">${fmtMoney(r.total_income)} so'm</td>
          <td>
            <div style="font-weight:600;color:#F43F5E">${fmtMoney(r.usta_share)} so'm</div>
            <div style="font-size:11px;color:var(--text-muted)">${r.percent}% stavka</div>
          </td>
          <td style="color:#F59E0B">${fmtMoney(r.mat_cost)} so'm</td>
          <td>
            <div style="font-weight:700;color:${r.salon_profit>0?'#10B981':'#F43F5E'}">${fmtMoney(r.salon_profit)} so'm</div>
            <div style="font-size:11px;color:var(--text-muted)">${profitPct}% marg</div>
          </td>
          <td style="color:#60A5FA;font-weight:600">${fmtMoney(r.pending_salary)} so'm</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function deleteFin(id) {
  await api(`/finance/${id}`, 'DELETE');
  showToast('🗑 O\'chirildi', 'error'); renderFinance();
}

function renderChart(items) {
  const days = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
  // Haqiqiy ma'lumotlar bo'yicha
  const dayData = days.map(() => ({inc: 0, exp: 0}));
  const now = new Date();
  items.forEach(f => {
    try {
      const d = new Date(f.fin_date);
      const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
      if(d >= weekAgo) {
        const di = (d.getDay() + 6) % 7; // Du=0
        if(f.type === 'income') dayData[di].inc += f.amount;
        else dayData[di].exp += f.amount;
      }
    } catch(e) {}
  });
  const max = Math.max(...dayData.map(d => Math.max(d.inc, d.exp)), 100000);
  document.getElementById('chartBars').innerHTML = days.map((d, i) => {
    const ih = Math.round(dayData[i].inc / max * 120) || 2;
    const eh = Math.round(dayData[i].exp / max * 120) || 2;
    return `<div class="chart-bar-group">
      <div style="display:flex;gap:3px;align-items:flex-end;height:130px">
        <div class="chart-bar income-bar" style="height:${ih}px;flex:1" title="${fmtMoney(dayData[i].inc)}"></div>
        <div class="chart-bar expense-bar" style="height:${eh}px;flex:1" title="${fmtMoney(dayData[i].exp)}"></div>
      </div>
      <div class="chart-label">${d}</div>
    </div>`;
  }).join('');
}

// ─── Kommunal xarajatlar ─────
function setExpCat(btn, cat) {
  document.querySelectorAll('.expense-cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('expCategory').value = cat;
}

async function addExpense() {
  const category = document.getElementById('expCategory').value;
  const amount = parseFloat(document.getElementById('expAmount').value);
  const expDate = document.getElementById('expDate').value || today();
  const note = document.getElementById('expNote').value.trim();
  if(!amount || amount <= 0) { showToast('⚠ Summani kiriting!', 'error'); return; }
  try {
    await api('/finance/', 'POST', {
      type: 'expense', category, amount,
      note: note || category, fin_date: expDate
    });
    document.getElementById('expAmount').value = '';
    document.getElementById('expNote').value = '';
    showToast('✅ Xarajat kiritildi!', 'success');

    // Aqlli ogohlantirish — o'tgan oyga solishtirish
    try {
      const summary = await api('/finance/summary');
      const alertEl = document.getElementById('expenseAlert');
      if(summary.month.expense > summary.month.income * 0.4 && alertEl) {
        alertEl.style.display = '';
        alertEl.innerHTML = `⚠️ <b>Diqqat!</b> Bu oydagi xarajatlar daromadning ${Math.round(summary.month.expense / summary.month.income * 100)}% ni tashkil qilmoqda. Xarajatlarni nazorat qiling!`;
      }
    } catch(e) {}

    renderFinance();
  } catch(e) { showToast('❌ Xato', 'error'); }
}

function setChartPeriod(p) {
  // Hozircha chart period almashtirish (visual feedback)
  const wb = document.getElementById('chartWeekBtn');
  const mb = document.getElementById('chartMonthBtn');
  if(wb) wb.style.background = p === 'week' ? 'rgba(139,92,246,0.2)' : '';
  if(mb) mb.style.background = p === 'month' ? 'rgba(139,92,246,0.2)' : '';
  renderFinance();
}

// ─── Hisobotlarni yuklab olish ─────
function exportReport(format, period) {
  const token = localStorage.getItem('token');
  const url = `${API}/finance/export?format=${format}&period=${period}`;
  // Download link yaratish
  const a = document.createElement('a');
  a.href = url;
  a.download = `hisobot_${period}.${format === 'excel' ? 'csv' : 'html'}`;
  // Token bilan fetch qilib download
  fetch(url, { headers: { 'Authorization': 'Bearer ' + token } })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`✅ ${format.toUpperCase()} hisobot yuklab olindi!`, 'success');
    })
    .catch(() => showToast('❌ Yuklab olishda xato', 'error'));
}

async function addFinance() {
  const type = document.getElementById('finType').value;
  const category = document.getElementById('finCategory').value;
  const amount = parseFloat(document.getElementById('finAmount').value);
  const masterVal = document.getElementById('finMaster')?.value || '';
  const noteInput = document.getElementById('finNote').value;
  const note = masterVal ? `${noteInput} [${masterVal}]` : noteInput;
  if (!amount || amount <= 0) { showToast('⚠ Summani kiriting!', 'error'); return; }
  await api('/finance/', 'POST', { type, category, amount, note, fin_date: today() });
  document.getElementById('finAmount').value = '';
  document.getElementById('finNote').value = '';
  showToast('✅ Saqlandi!', 'success');
  renderFinance();
}

// ===================== MODALS =====================
function openModal(id) {
  if (id==='bronModal') populateBronSelects();
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  editingId = null;
}

function openStaffModal() { editingId=null; openModal('staffModal'); }
function openServiceModal() { editingId=null; openModal('serviceModal'); }
function openInventoryModal() { editingId=null; openModal('inventoryModal'); }
function openClientModal() { editingId=null; openModal('clientModal'); }

async function populateBronSelects() {
  const [services, staff] = await Promise.all([api('/services/'), api('/staff/')]);
  document.getElementById('bron-service').innerHTML = services.map(s=>`<option>${s.name}</option>`).join('');
  document.getElementById('bron-master').innerHTML = staff.map(s=>`<option>${s.name.split(' ')[0]}</option>`).join('');
  if (!document.getElementById('bron-date').value) document.getElementById('bron-date').value = today();
}

async function saveBron() {
  const name = document.getElementById('bron-name').value.trim();
  const phone = document.getElementById('bron-phone').value.trim();
  const service = document.getElementById('bron-service').value;
  const master = document.getElementById('bron-master').value;
  const appt_date = document.getElementById('bron-date').value;
  const appt_time = document.getElementById('bron-time').value;
  const note = document.getElementById('bron-note').value;
  const isBot = document.getElementById('bron-bot-source').checked;
  if (!name||!phone) { showToast('⚠ Ism va telefon kerak!','error'); return; }

  try {
    await api('/appointments/','POST',{client_name:name, client_phone:phone, service, master, appt_date, appt_time, note, source:isBot?'bot':'admin', status:'pending'});
    closeModal('bronModal');
    document.getElementById('bron-name').value='';
    document.getElementById('bron-phone').value='';
    document.getElementById('bron-note').value='';
    document.getElementById('bron-bot-source').checked=false;
    showToast('✅ Bron saqlandi!','success');
    renderDashboard();
  } catch(e) {}
}

async function saveStaff() {
  const name       = document.getElementById('staff-name').value.trim();
  const phone      = document.getElementById('staff-phone').value.trim();
  const role       = document.getElementById('staff-role').value;
  const percent    = parseFloat(document.getElementById('staff-percent').value)||30;
  const salary     = parseFloat(document.getElementById('staff-salary').value)||0;
  const start_date = document.getElementById('staff-start').value;
  const bio        = document.getElementById('staff-bio').value.trim();
  const highlights = document.getElementById('staff-highlights').value.trim();
  const experience = parseInt(document.getElementById('staff-experience').value)||0;
  const username   = document.getElementById('staff-username').value.trim();
  const password   = document.getElementById('staff-password').value.trim();
  const user_role  = document.getElementById('staff-user-role').value;
  const checked    = [...document.querySelectorAll('#skillsCheckGrid input:checked')];
  const skills     = checked.map(c=>c.value).join(',');

  if (!name) { showToast('⚠ Ism kerak!','error'); return; }

  if (editingId) {
    // Tahrirlash — oddiy PUT
    const data = {name, phone, role, percent, salary, start_date, kpi:80, bio, highlights, experience, skills};
    await api(`/staff/${editingId}`,'PUT',data);
    closeModal('staffModal');
    showToast('✅ Saqlandi!','success');
    renderTeam();
    return;
  }

  // Yangi xodim — User bilan birga yaratish
  const data = {name, phone, role, percent, salary, start_date, kpi:80, bio, experience, skills, username, password, user_role};
  const res = await fetch(`${BASE_URL}/api/staff/create-with-user`, {
    method: 'POST',
    headers: {'Authorization':'Bearer '+localStorage.getItem('token'), 'Content-Type':'application/json'},
    body: JSON.stringify(data),
  });
  const d = await res.json();
  if (!res.ok) { showToast('❌ ' + (d.detail||'Xato'), 'error'); return; }

  closeModal('staffModal');
  renderTeam();

  // Credentials modalni ko'rsatish
  const cred = d.credentials;
  document.getElementById('cred-username').textContent = cred.username;
  document.getElementById('cred-password').textContent = cred.password;
  document.getElementById('cred-role').textContent     = user_role === 'master' ? '💈 Master' : '📋 Reception';
  window._lastCred = cred;
  document.getElementById('credModal').classList.add('active');
  showToast('✅ ' + d.message, 'success');
}

function copyCreds() {
  const c = window._lastCred;
  if (!c) return;
  const txt = `SalonPro Login Ma'lumotlari\nLogin: ${c.username}\nParol: ${c.password}\nHavola: ${c.login_url}`;
  navigator.clipboard.writeText(txt).then(()=>showToast('📋 Nusxa olindi!','success'));
}

function printCreds() {
  const c = window._lastCred;
  if (!c) return;
  const w = window.open('','_blank','width=400,height=300');
  w.document.write(`<html><body style="font-family:monospace;padding:20px">
    <h3>SalonPro — Login Ma'lumotlari</h3>
    <hr>
    <p><b>Login:</b> ${c.username}</p>
    <p><b>Parol:</b> ${c.password}</p>
    <p><b>Havola:</b> <a href="${c.login_url}">${c.login_url}</a></p>
    <hr>
    <small>Bu ma'lumotlarni xavfsiz saqlang!</small>
  </body></html>`);
  w.print();
}

async function blockStaff(id, name) {
  if (!confirm(`"${name}" ning kirish huquqini bloklamoqchimisiz?`)) return;
  const res = await fetch(`${BASE_URL}/api/staff/${id}/block`, {
    method: 'PATCH',
    headers: {'Authorization':'Bearer '+localStorage.getItem('token')},
  });
  const d = await res.json();
  showToast(d.message||'Bloklandi', res.ok?'success':'error');
  renderTeam();
}

async function unblockStaff(id, name) {
  const res = await fetch(`${BASE_URL}/api/staff/${id}/unblock`, {
    method: 'PATCH',
    headers: {'Authorization':'Bearer '+localStorage.getItem('token')},
  });
  const d = await res.json();
  showToast(d.message||'Faollashtirildi', res.ok?'success':'error');
  renderTeam();
}



async function saveClient() {
  const name = document.getElementById('client-name').value.trim();
  const phone = document.getElementById('client-phone').value.trim();
  const prefs = document.getElementById('client-prefs').value;
  const birthday = document.getElementById('client-birthday').value;
  const note = document.getElementById('client-note').value;
  if (!name||!phone) { showToast('⚠ Ism va telefon kerak!','error'); return; }
  const data = {name, phone, prefs, birthday, note, visits:0, bonus:0, source:'admin'};
  if (editingId) await api(`/clients/${editingId}`,'PUT',data);
  else await api('/clients/','POST',data);
  closeModal('clientModal');
  showToast('✅ Saqlandi!','success'); renderCRM();
}

async function saveService() {
  const name = document.getElementById('svc-name').value.trim();
  const category = document.getElementById('svc-cat').value;
  const price = parseFloat(document.getElementById('svc-price').value)||0;
  const duration = parseInt(document.getElementById('svc-duration').value)||60;
  if (!name) { showToast('⚠ Nom kerak!','error'); return; }
  await api('/services/','POST',{name, category, price, duration});
  closeModal('serviceModal');
  showToast('✅ Xizmat qo\'shildi!','success'); renderServices();
}

async function saveInventory() {
  const name = document.getElementById('inv-name').value.trim();
  const category = document.getElementById('inv-cat').value;
  const qty = parseFloat(document.getElementById('inv-qty').value)||0;
  const unit = document.getElementById('inv-unit').value;
  const min_qty = parseFloat(document.getElementById('inv-min').value)||3;
  const price = parseFloat(document.getElementById('inv-price').value)||0;
  if (!name) { showToast('⚠ Nom kerak!','error'); return; }
  await api('/inventory/','POST',{name, category, qty, unit, min_qty, price});
  closeModal('inventoryModal');
  showToast('✅ Mahsulot qo\'shildi!','success'); renderServices();
}

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(o=>{
  o.addEventListener('click', e=>{ if(e.target===o) closeModal(o.id); });
});

// ===================== UTILS =====================
function today() { return new Date().toISOString().split('T')[0]; }

function fmtMoney(n) {
  if (!n) return '0';
  if (n>=1000000) return (n/1000000).toFixed(1)+' mln';
  if (n>=1000) return (n/1000).toFixed(0)+' K';
  return Math.round(n).toString();
}

function formatDateUz(d) {
  const months = ['Yanvar','Fevral','Mart','Aprel','May','Iyun','Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function showToast(msg, type='success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(()=>t.classList.remove('show'), 3000);
}

async function resetAllData() {
  if (!confirm('Demo ma\'lumotlarni qayta yuklashni tasdiqlaysizmi?')) return;
  await api('/seed','POST');
  showToast('✅ Demo ma\'lumotlar yuklandi!','success');
  renderPage(currentPage);
}

// ===================== KABINET =====================
const DEMO_SCHEDULE = [
  {time:'09:00', client:'Malika Yusupova', service:"Soch bo'yash (qizil)", status:'completed', note:'Mijoz vaqtida keldi'},
  {time:'11:00', client:'Sarvinoz Karimova', service:'Soch kesish + pleyok', status:'confirmed', note:''},
  {time:'13:30', client:'Feruza Tosheva', service:"Soch bo'yash (blond)", status:'pending', note:"Rang namunasi olish kerak"},
  {time:'15:00', client:'Zulfiya Rahimova', service:'Soch to\'lqinlash', status:'pending', note:''},
];

const DEMO_MATERIALS = [
  {icon:'🎨', name:"Qizil soch bo'yog'i", qty:'2 dona', used:1},
  {icon:'🧴', name:'Schwarzkopf shampun', qty:'8 dona', used:0},
  {icon:'✨', name:"Bo'yash oksidanti 6%", qty:'3 dona', used:1},
  {icon:'🧪', name:'Soch konditsioner', qty:'5 dona', used:0},
];

const DEMO_REVIEWS = [
  {name:'Malika Y.', color:'#3B82F6', stars:'★★★★★', text:"Dilnoza opa har safar zo'r qiladi! Rangim aniq chiqqan, vaqtida tugatdi. Rahmat!", date:'Bugun'},
  {name:'Sarvinoz K.', color:'#10B981', stars:'★★★★★', text:'Juda professional, soch kesish juda yaxshi chiqdi. Albatta qayta kelaman!', date:'Kecha'},
  {name:'Nodira B.', color:'#F59E0B', stars:'★★★★☆', text:"Xizmat yaxshi, lekin biroz kutdim. Umuman yaxshi usta.", date:"3 kun oldin"},
  {name:'Hulkar M.', color:'#8B5CF6', stars:'★★★★★', text:"Eng yaxshi usta! Har 2 haftada kelaman, doim xursand qaytaman.", date:"1 hafta oldin"},
];

async function renderKabinet() {
  const todayStr = new Date().toISOString().split('T')[0];
  const staff = currentKabinetStaff;

  // Hero qismini yangilash
  if (staff) {
    document.getElementById('kabinetAvatar').textContent = staff.name[0];
    document.getElementById('kabinetAvatar').style.color = staff.color || '#60A5FA';
    document.getElementById('kabinetName').textContent = staff.name;
    document.getElementById('kabinetRole').textContent = staff.role;
    // masterSelect ni yangilash
    const sel = document.getElementById('masterSelect');
    if (sel) {
      for (let opt of sel.options) {
        if (opt.value === staff.name) { opt.selected = true; break; }
      }
    }
    // KPI label
    if (staff.kpi) document.getElementById('kb-rating').textContent = (4.3 + staff.kpi/200).toFixed(1);
    if (staff.percent) document.getElementById('kb-myShare').style.cssText = '';
  }

  // DB dan ushbu ustaning bronlarini olish
  const masterFirstName = staff?.name?.split(' ')[0] || '';
  const allAppts = await api(`/appointments?date=${todayStr}`).catch(()=>[]);
  const myAppts = masterFirstName
    ? allAppts.filter(a => a.master && a.master.includes(masterFirstName))
    : [];
  const schedule = myAppts.length ? myAppts : DEMO_SCHEDULE;

  // Stats
  const completed = schedule.filter(a=>a.status==='completed').length;
  const totalEarn = completed * 120000 + (schedule.length - completed) * 80000;
  const percent = staff?.percent || 35;
  document.getElementById('kb-todayCount').textContent = schedule.length;
  document.getElementById('kb-todayEarn').textContent = fmtMoney(totalEarn) + ' so\'m';
  document.getElementById('kb-myShare').textContent = fmtMoney(totalEarn * percent / 100) + ' so\'m';
  document.getElementById('kb-myShare').closest('.stat-info').querySelector('.stat-label').textContent = `Mening ulushim (${percent}%)`;
  document.getElementById('kb-schedCount').textContent = schedule.length;

  // Schedule
  const statColors = {completed:'var(--teal)', confirmed:'var(--primary)', pending:'var(--gold)', cancelled:'var(--rose)'};
  const statLabels = {completed:'✅ Tugadi', confirmed:'🔵 Tasdiqlandi', pending:'⏳ Kutilmoqda', cancelled:'❌ Kelmadi'};
  document.getElementById('kabinetSchedule').innerHTML = schedule.map((a,i) => `
    <div class="schedule-item ${a.status==='completed'?'completed-item':a.status==='cancelled'?'missed-item':''}">
      <div class="sched-time">${a.appt_time || a.time}</div>
      <div>
        <div class="sched-client">${a.client_name || a.client}</div>
        <div class="sched-service">${a.service} ${a.note?'• '+a.note:''}</div>
      </div>
      <div class="sched-status">
        <select onchange="updateSchedStatus(${i},this.value,${a.id||0})" style="color:${statColors[a.status]}">
          <option value="pending" ${a.status==='pending'?'selected':''}>⏳ Kutilmoqda</option>
          <option value="confirmed" ${a.status==='confirmed'?'selected':''}>🔵 Boshlandi</option>
          <option value="completed" ${a.status==='completed'?'selected':''}>✅ Tugadi</option>
          <option value="cancelled" ${a.status==='cancelled'?'selected':''}>❌ Kelmadi</option>
        </select>
      </div>
    </div>`).join('');

  // Materials
  document.getElementById('kabinetMaterials').innerHTML = DEMO_MATERIALS.map(m=>`
    <div class="material-item">
      <div class="mat-icon">${m.icon}</div>
      <div class="mat-name">${m.name}</div>
      <div class="mat-qty">${m.qty}</div>
      ${m.used ? `<span style="font-size:11px;background:rgba(16,185,129,0.15);color:var(--teal);padding:3px 8px;border-radius:6px">✓ ${m.used} ta ishlatildi</span>` : ''}
      <button class="mat-use-btn" onclick="useMaterial('${m.name}')">Ishlatdim</button>
    </div>`).join('');

  // Reviews
  document.getElementById('kabinetReviews').innerHTML = DEMO_REVIEWS.map(r=>`
    <div class="review-item">
      <div class="review-header">
        <div class="review-av" style="background:${r.color}20;color:${r.color}">${r.name[0]}</div>
        <div><div style="font-size:13px;font-weight:600">${r.name}</div><div style="font-size:11px;color:var(--text-muted)">${r.date}</div></div>
        <div class="review-stars">${r.stars}</div>
      </div>
      <div class="review-text">${r.text}</div>
    </div>`).join('');
}

async function updateSchedStatus(idx, status, id) {
  if (id) await api(`/appointments/${id}/status?status=${status}`,'PATCH').catch(()=>{});
  showToast(status==='completed'?'✅ Xizmat tugadi!':status==='cancelled'?'❌ Mijoz kelmadi':' Holat yangilandi','success');
}

function useMaterial(name) {
  showToast(`✅ "${name}" ishlatildi deb belgilandi`,'success');
}

function sendMatRequest() {
  const v = document.getElementById('matRequest').value.trim();
  if (!v) { showToast('⚠ Material nomini kiriting!','error'); return; }
  document.getElementById('matRequest').value = '';
  showToast(`📦 Admin ga so'rov yuborildi: "${v}"`,'success');
}

function changeKabinetMaster(name) {
  const initials = {
    'Dilnoza Xasanova':{letter:'D',color:'#3B82F6',role:"Soch bo'yash ustasi",phone:'+998 90 111 11 11',kpi:'88%'},
    'Nasiba Mirzayeva':{letter:'N',color:'#10B981',role:'Manikyur ustasi',phone:'+998 90 222 22 22',kpi:'92%'},
    'Kamola Ergasheva':{letter:'K',color:'#8B5CF6',role:'Kosmetolog',phone:'+998 90 333 33 33',kpi:'75%'},
    'Shahlo Tursunova':{letter:'S',color:'#F59E0B',role:'Vizajist',phone:'+998 90 444 44 44',kpi:'85%'},
  };
  const d = initials[name] || initials['Dilnoza Xasanova'];
  document.getElementById('kabinetAvatar').textContent = d.letter;
  document.getElementById('kabinetAvatar').style.color = d.color;
  document.getElementById('kabinetName').textContent = name;
  document.getElementById('kabinetRole').textContent = d.role;
  document.getElementById('kb-rating').textContent = (4.5 + Math.random()*0.5).toFixed(1);
  renderKabinet();
}

const BASE_URL = 'http://localhost:8000';

// ===================== LOGOUT =====================
async function doLogout() {
  if(!confirm('Tizimdan chiqmoqchimisiz?')) return;
  // Backend ga logout so'rovi — aktivlik logiga yoziladi
  try {
    await api('/auth/logout', 'POST');
  } catch(e) {}
  localStorage.clear();
  sessionStorage.clear();
  showToast('👋 Tizimdan muvaffaqiyatli chiqdingiz', 'success');
  setTimeout(() => { window.location.href = '/login/'; }, 600);
}

// ===================== SETTINGS =====================
async function renderSettings() {
  const fullName = localStorage.getItem('full_name') || 'Admin';
  const role = localStorage.getItem('role') || 'admin';
  const tkn = localStorage.getItem('token');

  document.getElementById('settingsAvatar').textContent = fullName[0] || 'A';
  document.getElementById('settingsFullName').textContent = fullName;
  document.getElementById('settingsRole').textContent = role;
  document.getElementById('set-fullname').value = fullName;

  try {
    const me = await api('/auth/me');
    document.getElementById('settingsUsername').textContent = '@' + (me.username || 'admin');
    document.getElementById('sysUsername').textContent = me.username || '—';
    document.getElementById('sysRole').textContent = me.role || '—';
    document.getElementById('sysSalonId').textContent = me.salon_id || '—';
  } catch(e) {}

  // Jonli token taymeri
  startTokenTimer();

  // Salon sozlamalarini olish
  try {
    const salon = await api('/admin/salon-settings');
    document.getElementById('set-salon-name').value = salon.name || '';
    document.getElementById('set-salon-phone').value = salon.phone || '';
    document.getElementById('set-salon-address').value = salon.address || '';
    document.getElementById('salonPlanBadge').textContent = (salon.plan || 'basic').toUpperCase();
    const wh = (salon.work_hours || '09:00-20:00').split('-');
    document.getElementById('set-work-start').value = wh[0] || '09:00';
    document.getElementById('set-work-end').value = wh[1] || '20:00';
    // Bot fields
    const btEl = document.getElementById('set-bot-token');
    const ciEl = document.getElementById('set-chat-id');
    if(btEl) btEl.value = salon.bot_token || '';
    if(ciEl) ciEl.value = salon.admin_chat_id || '';
    const badge = document.getElementById('botStatusBadge');
    if(badge) {
      if(salon.bot_token && salon.admin_chat_id) {
        badge.textContent = '✅ Ulangan';
        badge.style.background = 'rgba(16,185,129,0.2)';
        badge.style.color = '#10B981';
      } else {
        badge.textContent = '❌ Ulanmagan';
        badge.style.background = 'var(--text-muted)';
      }
    }
  } catch(e) {}

  // Xodimlar ro'yxatini yuklash (parol reset uchun)
  loadStaffUsersForReset();
}

// ─── Jonli token taymeri ─────
let _tokenTimerInterval = null;
function startTokenTimer() {
  if(_tokenTimerInterval) clearInterval(_tokenTimerInterval);
  const tkn = localStorage.getItem('token');
  if(!tkn) return;
  try {
    const payload = JSON.parse(atob(tkn.split('.')[1]));
    const expMs = payload.exp * 1000;
    function updateTimer() {
      const now = Date.now();
      const diff = expMs - now;
      const el = document.getElementById('sysTokenExp');
      if(!el) return;
      if(diff <= 0) { el.textContent = '⏰ Muddati o\'tgan!'; el.style.color = '#F43F5E'; return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      el.textContent = `${h}s ${String(m).padStart(2,'0')}d ${String(s).padStart(2,'0')}s`;
      el.style.color = h > 2 ? '#10B981' : h > 0 ? '#F59E0B' : '#F43F5E';
    }
    updateTimer();
    _tokenTimerInterval = setInterval(updateTimer, 1000);
  } catch(e) {
    const el = document.getElementById('sysTokenExp');
    if(el) el.textContent = '—';
  }
}

// ─── Bot sozlamalarini saqlash ─────
async function saveBotSettings() {
  const bot_token = document.getElementById('set-bot-token').value.trim();
  const admin_chat_id = document.getElementById('set-chat-id').value.trim();
  try {
    const res = await api('/admin/salon-settings', 'PUT', { bot_token, admin_chat_id });
    showToast('✅ Bot sozlamalari saqlandi', 'success');
    renderSettings();
  } catch(e) { showToast('❌ Xato yuz berdi', 'error'); }
}

// ─── Telegram testlash ─────
async function testTelegram() {
  try {
    const res = await api('/admin/test-telegram', 'POST');
    showToast('✅ ' + res.message, 'success');
  } catch(e) {
    showToast('❌ Test xabari yuborilmadi. Token va Chat ID ni tekshiring!', 'error');
  }
}

// ─── Xodimlar ro'yxati (parol reset uchun) ─────
async function loadStaffUsersForReset() {
  const sel = document.getElementById('set-staff-user');
  const listEl = document.getElementById('salonUsersList');
  if(!sel) return;
  try {
    const users = await api('/admin/salon-users');
    // Dropdown uchun faqat admin bo'lmagan userlar
    const staffUsers = users.filter(u => u.role !== 'admin' && u.role !== 'superadmin');
    sel.innerHTML = staffUsers.length
      ? staffUsers.map(u => `<option value="${u.id}">${u.full_name || u.username} (@${u.username}) — ${u.role}</option>`).join('')
      : '<option value="">Xodim topilmadi</option>';
    // Barcha foydalanuvchilar jadvalini ko'rsatish
    if(listEl) {
      const roleIcons = {admin:'👑',master:'👩‍💼',reception:'🛎'};
      const roleColors = {admin:'#F59E0B',master:'#8B5CF6',reception:'#3B82F6'};
      listEl.innerHTML = users.map(u => `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--card-border)">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:${roleColors[u.role]||'#64748b'}22;display:flex;align-items:center;justify-content:center;font-size:16px">${roleIcons[u.role]||'👤'}</div>
          <div>
            <div style="font-weight:600;font-size:13px">${u.full_name || u.username}</div>
            <div style="font-size:11px;color:var(--text-muted)">@${u.username} · ${u.role}</div>
          </div>
        </div>
        <span style="font-size:11px;padding:3px 8px;border-radius:12px;background:${u.is_active?'rgba(16,185,129,0.15)':'rgba(244,63,94,0.15)'};color:${u.is_active?'#10B981':'#F43F5E'}">${u.is_active?'✅ Faol':'🔴 Blok'}</span>
      </div>`).join('');
    }
  } catch(e) {
    sel.innerHTML = '<option value="">Yuklanmadi</option>';
    if(listEl) listEl.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:16px">Yuklanmadi</div>';
  }
}

function toggleAddUserForm() {
  const f = document.getElementById('addUserForm');
  f.style.display = f.style.display === 'none' ? '' : 'none';
}

async function createNewUser() {
  const full_name = document.getElementById('nu-fullname').value.trim();
  const username = document.getElementById('nu-username').value.trim();
  const password = document.getElementById('nu-password').value;
  const role = document.getElementById('nu-role').value;
  if(!username || !password) { showToast('⚠ Username va parol kerak!', 'error'); return; }
  if(password.length < 6) { showToast('⚠ Parol kamida 6 belgi!', 'error'); return; }
  try {
    const res = await api('/admin/create-user', 'POST', { username, password, full_name, role });
    showToast('✅ ' + res.message, 'success');
    document.getElementById('nu-fullname').value = '';
    document.getElementById('nu-username').value = '';
    document.getElementById('nu-password').value = '';
    document.getElementById('addUserForm').style.display = 'none';
    loadStaffUsersForReset();
  } catch(e) { showToast('❌ Xato: ' + (e.message || 'Yaratilmadi'), 'error'); }
}

// ─── Xodim parolini yangilash ─────
async function resetStaffPassword() {
  const userId = document.getElementById('set-staff-user').value;
  const newPass = document.getElementById('set-staff-new-pass').value;
  if(!userId) { showToast('⚠ Xodimni tanlang!', 'error'); return; }
  if(!newPass || newPass.length < 6) { showToast('⚠ Parol kamida 6 belgi!', 'error'); return; }
  try {
    const res = await api('/admin/reset-staff-password', 'POST', { user_id: parseInt(userId), new_password: newPass });
    document.getElementById('set-staff-new-pass').value = '';
    showToast('✅ ' + res.message, 'success');
  } catch(e) { showToast('❌ Xato yuz berdi', 'error'); }
}

async function saveProfile() {
  const fullName = document.getElementById('set-fullname').value.trim();
  if (!fullName) { showToast('⚠ Ismni kiriting!', 'error'); return; }
  try {
    const res = await api('/admin/profile', 'PUT', { full_name: fullName });
    localStorage.setItem('full_name', fullName);
    document.getElementById('sidebarName').textContent = fullName.split(' ')[0];
    document.getElementById('settingsFullName').textContent = fullName;
    document.getElementById('settingsAvatar').textContent = fullName[0];
    document.getElementById('sidebarAvatar').textContent = fullName[0];
    showToast('✅ ' + res.message, 'success');
  } catch(e) {}
}

async function changePassword() {
  const oldPass = document.getElementById('set-old-pass').value;
  const newPass = document.getElementById('set-new-pass').value;
  const confirmPass = document.getElementById('set-confirm-pass').value;
  if (!oldPass || !newPass) { showToast('⚠ Barcha maydonlarni to\'ldiring!', 'error'); return; }
  if (newPass.length < 6) { showToast('⚠ Yangi parol kamida 6 belgi bo\'lishi kerak!', 'error'); return; }
  if (newPass !== confirmPass) { showToast('⚠ Yangi parollar mos kelmayapti!', 'error'); return; }
  try {
    const res = await api('/admin/change-password', 'POST', { old_password: oldPass, new_password: newPass });
    document.getElementById('set-old-pass').value = '';
    document.getElementById('set-new-pass').value = '';
    document.getElementById('set-confirm-pass').value = '';
    showToast('✅ ' + res.message, 'success');
  } catch(e) {}
}

async function saveSalonSettings() {
  const name = document.getElementById('set-salon-name').value.trim();
  const phone = document.getElementById('set-salon-phone').value.trim();
  const address = document.getElementById('set-salon-address').value.trim();
  const workStart = document.getElementById('set-work-start').value;
  const workEnd = document.getElementById('set-work-end').value;
  const work_hours = `${workStart}-${workEnd}`;
  try {
    const res = await api('/admin/salon-settings', 'PUT', { name, phone, address, work_hours });
    showToast('✅ ' + res.message, 'success');
  } catch(e) {}
}


// ===================== NOTIFICATIONS =====================
let _notifData = [];

async function loadNotifications() {
  try {
    const [notifs, unread] = await Promise.all([
      api('/admin/notifications'),
      api('/admin/notifications/unread-count'),
    ]);
    _notifData = notifs;
    // Unread dot ko'rsatish
    const dot = document.getElementById('notifDot');
    if (dot) {
      if (unread.count > 0) {
        dot.style.display = '';
        dot.textContent = unread.count > 9 ? '9+' : unread.count;
      } else {
        dot.style.display = 'none';
      }
    }
    renderNotifList(notifs);
  } catch(e) {}
}

function renderNotifList(notifs) {
  const el = document.getElementById('notifList');
  if (!el) return;
  if (!notifs.length) {
    el.innerHTML = '<div class="notif-empty">🔔 Bildirishnomalar yo\'q</div>';
    return;
  }
  el.innerHTML = notifs.slice(0, 20).map(n => {
    const typeClass = n.type || 'info';
    const timeAgo = getTimeAgo(n.created_at);
    return `<div class="notif-item ${n.is_read ? '' : 'unread'}" onclick="markNotifRead(${n.id},'${n.link || ''}')">
      <div class="notif-icon ${typeClass}">${n.icon || '🔔'}</div>
      <div style="flex:1">
        <div class="notif-title">${n.title}</div>
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${timeAgo}</div>
      </div>
      ${!n.is_read ? '<div style="width:8px;height:8px;background:var(--primary);border-radius:50%;flex-shrink:0;margin-top:4px"></div>' : ''}
    </div>`;
  }).join('');
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Hozirgina';
    if (diff < 3600) return Math.floor(diff / 60) + ' daqiqa oldin';
    if (diff < 86400) return Math.floor(diff / 3600) + ' soat oldin';
    if (diff < 604800) return Math.floor(diff / 86400) + ' kun oldin';
    return d.toLocaleDateString('uz');
  } catch(e) { return dateStr; }
}

async function markNotifRead(id, link) {
  try { await api(`/admin/notifications/${id}/read`, 'PATCH'); } catch(e) {}
  if (link) { closeNotifPanel(); navigate(link); }
  loadNotifications();
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const isHidden = panel.style.display === 'none';
  panel.style.display = isHidden ? 'block' : 'none';
  if (isHidden) loadNotifications();
}

function closeNotifPanel() {
  document.getElementById('notifPanel').style.display = 'none';
}

async function clearNotifs() {
  try {
    await api('/admin/notifications/clear', 'DELETE');
    showToast('🗑 Bildirishnomalar tozalandi', 'success');
    loadNotifications();
  } catch(e) {}
}

async function markAllNotifsRead() {
  try {
    await api('/admin/notifications/read-all', 'POST');
    showToast('✅ Barcha bildirishnomalar o\'qildi', 'success');
    loadNotifications();
  } catch(e) {}
}


// ===================== ACTIVITY LOGS =====================
let _activityLogs = [];

async function loadActivityLogs() {
  try {
    const logs = await api('/admin/activity-logs?limit=100');
    _activityLogs = logs;
    renderActivityLogs(logs);
  } catch(e) {
    document.getElementById('activityLogsTable').innerHTML =
      '<div style="padding:32px;text-align:center;color:var(--text-muted)">Loglarni yuklashda xatolik</div>';
  }
}

function filterLogs() {
  const actionFilter = document.getElementById('logFilterAction')?.value || '';
  const userFilter = (document.getElementById('logFilterUser')?.value || '').toLowerCase();
  let filtered = _activityLogs;
  if (actionFilter) filtered = filtered.filter(l => l.action === actionFilter);
  if (userFilter) filtered = filtered.filter(l =>
    (l.full_name || '').toLowerCase().includes(userFilter) ||
    (l.username || '').toLowerCase().includes(userFilter)
  );
  renderActivityLogs(filtered);
}

function renderActivityLogs(logs) {
  const el = document.getElementById('activityLogsTable');
  document.getElementById('logsCount').textContent = logs.length + ' ta yozuv';

  if (!logs.length) {
    el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted)"><div style="font-size:40px;margin-bottom:12px;opacity:0.3">📋</div>Aktivlik tarixi bo\'sh</div>';
    return;
  }

  const actionLabels = {
    login: '🔑 Kirdi', logout: '🚪 Chiqdi', create: '➕ Yaratdi',
    update: '✏️ Tahrirladi', delete: '🗑 O\'chirdi',
  };
  const actionIcons = {
    login: '🔑', logout: '🚪', create: '➕', update: '✏️', delete: '🗑',
  };

  el.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Vaqt</th><th>Foydalanuvchi</th><th>Rol</th>
      <th>Amal</th><th>Tavsif</th>
    </tr></thead>
    <tbody>${logs.map(l => {
      const dateStr = l.created_at ? formatLogDate(l.created_at) : '—';
      return `<tr>
        <td style="white-space:nowrap;font-size:12px;color:var(--text-muted)">${dateStr}</td>
        <td>
          <div style="font-weight:600;font-size:13px">${l.full_name || l.username || '—'}</div>
          <div style="font-size:11px;color:var(--text-muted)">@${l.username || '—'}</div>
        </td>
        <td><span class="log-role-badge ${l.role || 'admin'}">${l.role || '—'}</span></td>
        <td><span class="log-action-badge ${l.action}">${actionLabels[l.action] || l.action}</span></td>
        <td style="font-size:12px;max-width:300px">${l.description || '—'}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function formatLogDate(dateStr) {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Bugun ${time}`;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `Kecha ${time}`;
    return `${d.getDate()}.${String(d.getMonth()+1).padStart(2,'0')} ${time}`;
  } catch(e) { return dateStr; }
}


// ===================== SESSION SECURITY =====================
// Har 60 sekundda token yaroqliligini tekshirish
setInterval(async () => {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const exp = payload.exp * 1000;
    const now = Date.now();
    // Token muddati tugagan bo'lsa
    if (now >= exp) {
      localStorage.clear();
      sessionStorage.clear();
      showToast('⏰ Sessiya muddati tugadi, qayta kiring', 'error');
      setTimeout(() => { window.location.href = '/login/'; }, 1500);
    }
    // 30 daqiqa qolganda ogohlantirish
    else if (exp - now < 30 * 60 * 1000 && exp - now > 29 * 60 * 1000) {
      showToast('⚠ Sessiya 30 daqiqada tugaydi', 'error');
    }
  } catch(e) {}
}, 60000);

// Browser tab visible bo'lganda tekshirish
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    const token = localStorage.getItem('token');
    if (!token) {
      window.location.href = '/login/';
    }
  }
});

// ===================== NOTIF POLLING =====================
// Har 2 daqiqada bildirishnomalarni tekshirish
setInterval(() => {
  if (localStorage.getItem('token')) loadNotifications();
}, 120000);

// Har 5 daqiqada ombor kamligini tekshirish
setInterval(async () => {
  if (localStorage.getItem('token')) {
    try { await api('/admin/check-low-stock', 'POST'); } catch(e) {}
  }
}, 300000);


// ===================== REAL INIT =====================
document.getElementById('pageDate').textContent = formatDateUz(new Date());
navigate('dashboard');
// Bildirishnomalarni yuklash
setTimeout(() => loadNotifications(), 1000);
// Birinchi yuklanishda ombor kamligini tekshirish
setTimeout(async () => {
  try { await api('/admin/check-low-stock', 'POST'); } catch(e) {}
}, 3000);

