import { db, auth } from "../api/firebase.js";
import { ref, get, onValue } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.0.0/firebase-auth.js";

let uid = null, deviceId = null, allStats = {}, selectedDate = '';

const $ = id => document.getElementById(id);
const set = (id, v) => { const el=$(id); if(el) el.textContent = v ?? '—'; };

function msToHM(ms) {
  if (!ms||ms<=0) return '—';
  const h=Math.floor(ms/3600000), m=Math.floor((ms%3600000)/60000);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
function secToHM(s) {
  if (!s||s<=0) return '—';
  const h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  if(h>0) return `${h}h ${m}m`;
  if(m>0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
function bytesToMB(b) { return b ? (b/1048576).toFixed(1)+' MB' : '0 MB'; }
function todayStr() { return new Date().toISOString().split('T')[0]; }

function showBanner(msg, type='warn') { $('bannerMsg').textContent=msg; $('banner').className=`banner show ${type}`; }
function hideBanner() { $('banner').className='banner'; }

function setAuthUI(user, devId) {
  const dot=$('authDot'), lbl=$('authLabel');
  if (user && devId) {
    dot.className='auth-dot ok'; lbl.textContent=`DEV: ${String(devId).slice(0,8)}…`;
    $('deviceMeta').textContent=`uid: ${String(user.uid).slice(0,8)}… · ${devId}`;
  } else if (user) {
    dot.className='auth-dot spin'; lbl.textContent=`uid: ${String(user.uid).slice(0,8)}…`;
  } else {
    dot.className='auth-dot err'; lbl.textContent='not signed in';
    $('deviceMeta').textContent='Not authenticated';
  }
}

async function getDeviceIdSafe() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async user => {
      if (!user) return reject('Not logged in');
      const snap = await get(ref(db, `users/${user.uid}/storeId`));
      resolve(snap.val());
    });
  });
}

function animateFills(selector, prop='width') {
  setTimeout(() => {
    document.querySelectorAll(selector).forEach((el,i) => {
      setTimeout(() => { el.style[prop]=(el.dataset.pct||0)+'%'; }, i*60+100);
    });
  }, 80);
}

/* ── KPIs ── */
function populateKPIs(d) {
  set('k-screen',    d.totalScreenTime || msToHM(d.totalScreenTimeMs));
  set('k-unlocks',   d.unlockCount ?? '—');
  set('k-session',   d.avgSessionMs ? msToHM(d.avgSessionMs) : '—');
  set('pickupVal',   d.firstPickup || '—');
  set('k-unlocks-d', d.peakHour!=null ? `Peak ${d.peakHour}:00` : 'Peak —');
  set('cs-apps',     d.appsUsedCount ?? '—');
  set('cs-top3',     (d.top3Apps||[]).join(' · ')||'—');
  if (d.battery) {
    const b=d.battery, rem=b.level||0, drn=Math.max(0,b.drainToday||0), unu=Math.max(0,100-rem-drn);
    set('k-battery',     b.drainToday!=null ? `${b.drainToday}%` : '—');
    set('k-battery-sub', `${b.startLevel??'—'}% → ${b.level??'—'}%`);
    set('k-battery-d',   `Temp ${b.temperatureC??'—'}°C · ${b.health||'—'}`);
    set('bat-level-big', b.level!=null ? `${b.level}%` : '—%');
    set('bat-start',     b.startLevel!=null ? `${b.startLevel}%` : '—');
    set('bat-drain',     b.drainToday!=null ? `−${b.drainToday}%` : '—');
    set('bat-status',    b.isCharging ? 'Charging' : (b.pluggedVia||'Unplugged'));
    set('bat-temp',      b.temperatureC!=null ? `${b.temperatureC}°C` : '—');
    set('bat-health',    b.health||'—');
    set('bat-bar-l',     `Start ${b.startLevel??'—'}%`);
    set('bat-bar-r',     `Now ${b.level??'—'}%`);
    set('bat-device',    d.deviceModel||'—');
    set('bat-ram',       d.ram ? `${d.ram} · SDK ${d.sdk||'—'}` : '—');
    $('batSegs').innerHTML=
      `<div class="bat-s" style="background:var(--teal);flex:${rem}"></div>`+
      `<div class="bat-s" style="background:var(--red);flex:${drn}"></div>`+
      `<div class="bat-s" style="background:var(--bg4);flex:${unu}"></div>`;
    const pr=$('bat-prog-rem'), pd=$('bat-prog-drn');
    if(pr){pr.style.width='0%'; setTimeout(()=>pr.style.width=rem+'%',300);}
    if(pd){pd.style.width='0%'; setTimeout(()=>pd.style.width=Math.round(drn/(b.startLevel||100)*100)+'%',300);}
  }
  if (d.calls) {
    const c=d.calls, total=c.total||0;
    set('k-calls',   c.total??'—');
    set('k-calls-d', `${c.missed??0} missed · ${c.outgoing??0} out`);
    set('call-in',   c.incoming??'—'); set('call-out',  c.outgoing??'—'); set('call-miss', c.missed??'—');
    set('call-dur',  c.totalDuration||secToHM(c.totalDurationSec));
    set('call-avg',  total>0&&c.totalDurationSec ? secToHM(Math.round(c.totalDurationSec/total)) : '—');
    set('cs-in',     c.incoming??'—'); set('cs-out', c.outgoing??'—'); set('cs-miss', c.missed??'—');
    set('cs-dur',    c.totalDuration||secToHM(c.totalDurationSec));
  }
  if (d.sms) {
    const s=d.sms;
    set('k-sms',        s.total??'—');
    set('k-sms-d',      `${s.received??0} recv · ${s.sent??0} sent`);
    set('cs-sms-recv',  s.received??'—'); set('cs-sms-sent', s.sent??'—'); set('cs-sms-draft', s.draft??'—');
  }
}

/* ── Hourly heat grid ── */
function buildHourlyHeat(d) {
  const hb=d.hourlyBuckets||{};
  const hrs=Array.from({length:19},(_,i)=>String(i+5));
  const maxO=Math.max(...hrs.map(h=>hb[h]?.opens||0),1);
  const maxU=Math.max(...hrs.map(h=>hb[h]?.unlocks||0),1);
  const maxS=Math.max(...hrs.map(h=>hb[h]?.screenMin||0),1);

  function mkCells(elId, key, maxV, col) {
    const el=$(elId); if(!el) return;
    el.innerHTML = hrs.map(h => {
      const v=hb[h]?.[key]||0, a=v>0 ? 0.15+(v/maxV)*0.85 : 0.07;
      const alpha=Math.round(a*255).toString(16).padStart(2,'0');
      const bg = v>0 ? col+alpha : 'var(--bg5)';
      return `<div class="hour-cell" style="background:${bg}" title="${h}:00 — ${v} ${key}"></div>`;
    }).join('');
  }
  mkCells('hg-opens',   'opens',     maxO, '#3d87f0');
  mkCells('hg-unlocks', 'unlocks',   maxU, '#0fb882');
  mkCells('hg-screen',  'screenMin', maxS, '#e8a020');

  const labEl=$('hg-labels');
  if(labEl) labEl.innerHTML=hrs.map(h=>{
    const n=parseInt(h), lbl=n===5?'5am':n===12?'12p':n>12?`${n-12}p`:`${n}a`;
    return `<div class="hour-lbl">${n%3===0?lbl:''}</div>`;
  }).join('');

  let peakH=null, peakO=0, peakU=0, peakS=0;
  hrs.forEach(h=>{ const o=hb[h]?.opens||0; if(o>peakO){peakO=o;peakH=h;} peakU=Math.max(peakU,hb[h]?.unlocks||0); peakS=Math.max(peakS,hb[h]?.screenMin||0); });
  if(d.peakHour!=null) peakH=String(d.peakHour);
  const ph=peakH!=null?parseInt(peakH):null;
  set('h-peak',         ph!=null ? `${ph>12?ph-12:ph}:00 ${ph>=12?'PM':'AM'}` : '—');
  set('h-peak-opens',   peakO||'—');
  set('h-peak-unlocks', peakU||'—');
  set('h-peak-screen',  peakS ? `${peakS} min` : '—');
}

/* ── Category split ── */
function buildCategoryList(d) {
  set('cat-total', d.totalScreenTime||msToHM(d.totalScreenTimeMs));
  const COLORS=['var(--blue)','var(--pink)','var(--teal)','var(--amber)','var(--purple)','var(--slate)'];
  const cats = d.categories
    ? Object.entries(d.categories).map(([name,ms])=>({name,ms})).sort((a,b)=>b.ms-a.ms)
    : [{name:'Social',pct:28},{name:'Video',pct:22},{name:'Messaging',pct:17},{name:'Browser',pct:12},{name:'Music',pct:8},{name:'Other',pct:13}];
  const totalMs = cats[0]?.ms!=null ? cats.reduce((s,c)=>s+(c.ms||0),0)||1 : 100;
  $('catList').innerHTML = cats.map((cat,i)=>{
    const pct = cat.pct!=null ? cat.pct : Math.round(cat.ms/totalMs*100);
    const col = COLORS[i%COLORS.length];
    return `<div class="cat-row">
      <span class="cat-dot" style="background:${col}"></span>
      <span class="cat-name">${cat.name}</span>
      <div class="cat-track"><div class="cat-fill" data-pct="${pct}" style="background:${col}"></div></div>
      <span class="cat-pct">${pct}%</span>
    </div>`;
  }).join('');
  animateFills('.cat-fill');
}

/* ── App list ── */
function buildAppList(apps) {
  if(!apps||!apps.length){$('appList').innerHTML='<div style="color:var(--t3);font-size:11px;padding:10px 0">No app data</div>';return;}
  const pal=[{bg:'#0d2e66',fg:'#3d87f0'},{bg:'#4b0f28',fg:'#d95b8e'},{bg:'#083624',fg:'#0fb882'},{bg:'#3d2000',fg:'#e8a020'},{bg:'#211555',fg:'#8b7ff5'}];
  const maxMs=apps[0]?.usageMs||1;
  $('appList').innerHTML=apps.map((a,i)=>{
    const pct=Math.round((a.usageMs||0)/maxMs*100), p=pal[i%pal.length];
    return `<div class="app-row">
      <span class="app-rank">${i+1}</span>
      <div class="app-ico" style="background:${p.bg};color:${p.fg}">${(a.appName||'??').substring(0,2).toUpperCase()}</div>
      <div class="app-info"><div class="app-name">${a.appName||'—'}</div><div class="app-pkg">${a.packageName||'—'}</div></div>
      <div class="bar-track"><div class="bar-fill" data-pct="${pct}" style="background:${p.fg}"></div></div>
      <div class="app-meta"><div class="app-dur">${a.usage||msToHM(a.usageMs)}</div><div class="app-opens">${a.launches||0} opens</div></div>
    </div>`;
  }).join('');
  animateFills('.bar-fill');
}

/* ── Data usage ── */
function buildDuList(du) {
  if(!du||!du.length){$('duList').innerHTML='<div style="color:var(--t3);font-size:11px;padding:10px 0">No data</div>';set('du-rx','—');set('du-tx','—');set('du-total','—');return;}
  const maxB=du[0].totalBytes||1; let rx=0,tx=0;
  $('duList').innerHTML=du.map(a=>{
    rx+=a.rxBytes||0; tx+=a.txBytes||0;
    const pct=Math.round((a.totalBytes||0)/maxB*100);
    return `<div class="du-row"><span class="du-name">${a.appName}</span><div class="du-track"><div class="du-fill" data-pct="${pct}"></div></div><span class="du-mb">${a.totalMB||bytesToMB(a.totalBytes)}</span></div>`;
  }).join('');
  set('du-rx', bytesToMB(rx)); set('du-tx', bytesToMB(tx)); set('du-total', bytesToMB(rx+tx));
  animateFills('.du-fill');
}

/* ── 7-day table ── */
function buildWeekTable(week) {
  if(!week||!week.length){$('weekTbody').innerHTML='<tr><td colspan="6" style="color:var(--t3);text-align:center;padding:20px 0;">No data</td></tr>';return;}
  const maxH=Math.max(...week.map(w=>w.screenH),0.1);
  $('weekTbody').innerHTML=week.map(w=>{
    const pct=Math.round(w.screenH/maxH*100);
    const avg=w.unlocks>0&&w.screenMs ? secToHM(Math.round(w.screenMs/w.unlocks/1000)) : '—';
    return `<tr class="${w.isToday?'today-row':''}">
      <td style="font-weight:${w.isToday?600:400};color:${w.isToday?'var(--blue)':'var(--t1)'}">
        ${w.day}${w.isToday?' <span style="font-size:8px;color:var(--blue);">(today)</span>':''}
      </td>
      <td style="color:var(--t3)">${w.date}</td>
      <td style="font-weight:600">${w.screenH}h</td>
      <td><span class="wk-bar-track"><span class="wk-bar-fill" data-pct="${pct}" style="background:${w.isToday?'var(--blue)':'var(--bg5)'}"></span></span></td>
      <td style="color:var(--teal)">${w.unlocks||0}</td>
      <td style="color:var(--t2)">${avg}</td>
    </tr>`;
  }).join('');
  animateFills('.wk-bar-fill');
}

/* ── Timeline ── */
function buildTimeline(d) {
  const date=selectedDate||todayStr();
  $('tl-date').textContent=new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const hb=d.hourlyBuckets||{}, evs=[];
  if(d.firstPickup) evs.push({time:d.firstPickup,color:'var(--blue)',event:'First pick-up',tag:'KEYGUARD_HIDDEN',tagBg:'var(--blueT)',tagColor:'var(--blue)',sub:`${d.unlockCount||0} unlocks today · Avg session ${msToHM(d.avgSessionMs||0)}`});
  const peakH=d.peakHour!=null?String(d.peakHour):null;
  if(peakH&&hb[peakH]){const hr=parseInt(peakH),ap=hr>=12?'PM':'AM',h12=hr>12?hr-12:(hr===0?12:hr);evs.push({time:`${h12}:00 ${ap}`,color:'var(--amber)',event:`Peak hour — ${hb[peakH].opens||0} app opens`,tag:'MOVE_TO_FOREGROUND',tagBg:'var(--amberT)',tagColor:'var(--amber)',sub:`${hb[peakH].unlocks||0} unlocks · ${hb[peakH].screenMin||0} min screen-on`,pulse:true});}
  if(d.battery){const b=d.battery;evs.push({time:'Battery',color:b.isCharging?'var(--teal)':'var(--red)',event:`${b.level??'—'}% remaining${b.isCharging?' · Charging':''}`,tag:b.pluggedVia||'Unplugged',tagBg:b.isCharging?'var(--tealT)':'var(--redT)',tagColor:b.isCharging?'var(--teal)':'var(--red)',sub:`Drained ${b.drainToday??0}% · Temp ${b.temperatureC??'—'}°C · ${b.health||'—'}`});}
  if(d.calls&&d.calls.total>0){const c=d.calls;evs.push({time:'Calls',color:'var(--pink)',event:`${c.total} calls · ${c.totalDuration||secToHM(c.totalDurationSec)}`,tag:'CallLog.Calls',tagBg:'var(--pinkT)',tagColor:'var(--pink)',sub:`↙ ${c.incoming||0} in · ↗ ${c.outgoing||0} out · ✗ ${c.missed||0} missed`});}
  if(d.sms&&d.sms.total>0){const s=d.sms;evs.push({time:'SMS',color:'var(--purple)',event:`${s.total} messages`,tag:'Telephony.Sms',tagBg:'var(--purpleT)',tagColor:'var(--purple)',sub:`${s.received||0} recv · ${s.sent||0} sent${s.draft>0?` · ${s.draft} drafts`:''}`});}
  evs.push({time:'Today total',color:'var(--teal)',event:`${d.totalScreenTime||msToHM(d.totalScreenTimeMs||0)} screen time`,tag:'UsageStatsManager',tagBg:'var(--tealT)',tagColor:'var(--teal)',sub:`${d.appsUsedCount||0} apps · Top: ${(d.top3Apps||[]).slice(0,2).join(', ')||'—'}`});
  $('timelineEl').innerHTML=evs.map(ev=>`<div class="tl-item"><div class="tl-dot-host"><div class="tl-dot${ev.pulse?' pulse':''}" style="background:${ev.color};color:${ev.color}"></div></div><div><div class="tl-time">${ev.time}</div><div class="tl-event">${ev.event}</div><div><span class="tl-tag" style="background:${ev.tagBg};color:${ev.tagColor}">${ev.tag}</span></div><div class="tl-sub">${ev.sub}</div></div></div>`).join('');
  $('timelineEl').querySelectorAll('.tl-item').forEach((item,i)=>setTimeout(()=>item.classList.add('vis'),i*80+100));
}

/* ── Process + week ── */
function processDay(raw) {
  if(!raw) return {};
  const d={...raw};
  if(d.apps&&!Array.isArray(d.apps)) d.apps=Object.values(d.apps).sort((a,b)=>(b.usageMs||0)-(a.usageMs||0));
  if(d.appDataUsage&&!Array.isArray(d.appDataUsage)) d.appDataUsage=Object.values(d.appDataUsage).sort((a,b)=>(b.totalBytes||0)-(a.totalBytes||0));
  return d;
}
function buildWeekData(snap) {
  const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], today=todayStr();
  return Object.entries(snap).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([dateStr,val])=>{
    const dt=new Date(dateStr+'T12:00:00');
    return {date:dt.toLocaleDateString('en-US',{month:'short',day:'numeric'}),day:DAYS[dt.getDay()],screenH:val.totalScreenTimeMs?+(val.totalScreenTimeMs/3600000).toFixed(1):0,screenMs:val.totalScreenTimeMs||0,unlocks:val.unlockCount||0,isToday:dateStr===today};
  });
}
function populateDateSelector(snap) {
  const sel=$('dateSel'), today=todayStr();
  sel.innerHTML=Object.keys(snap).sort().reverse().map(d=>`<option value="${d}"${d===today?' selected':''}>${new Date(d+'T12:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}${d===today?' (today)':''}</option>`).join('');
}
function renderDate(date) {
  const raw=allStats[date]; if(!raw){showBanner(`No data for ${date}`,'warn');return;}
  const d=processDay(raw), week=buildWeekData(allStats);
  populateKPIs(d); buildHourlyHeat(d); buildCategoryList(d);
  buildAppList(d.apps||[]); buildDuList(d.appDataUsage||[]);
  buildWeekTable(week); buildTimeline(d); hideBanner();
}

$('dateSel').addEventListener('change',e=>{selectedDate=e.target.value;if(selectedDate)renderDate(selectedDate);});

/* ── Auth + Firebase ── */
onAuthStateChanged(auth, async user => {
  if(!user){setAuthUI(null,null);showBanner('Not signed in.','fail');return;}
  uid=user.uid; setAuthUI(user,null); showBanner('Signed in — fetching device…','warn');
  try{deviceId=await getDeviceIdSafe();}catch(e){showBanner(`getDeviceIdSafe failed: ${e}`,'fail');return;}
  if(!deviceId){showBanner('storeId is null — device not registered.','fail');return;}
  setAuthUI(user,deviceId); showBanner(`Connected · DEV: ${deviceId}`,'ok'); setTimeout(hideBanner,3000);
  const basePath=`users/${uid}/devices/${deviceId}`;
  onValue(ref(db,`${basePath}/stat`),snap=>{
    if(!snap.exists()){showBanner(`No data at ${basePath}/stat`,'warn');return;}
    allStats=snap.val(); populateDateSelector(allStats);
    const today=todayStr();
    selectedDate=allStats[today]?today:Object.keys(allStats).sort().pop();
    $('dateSel').value=selectedDate; renderDate(selectedDate);
    showBanner(`Live · synced ${new Date().toLocaleTimeString()}`,'ok'); setTimeout(hideBanner,2500);
  }, err=>{showBanner(`Read error: ${err.message}`,'fail'); console.error('[StatsModule]',err);});
});

/* ── Theme toggle ── */
$('themeBtn').addEventListener('click',()=>{
  const root=document.documentElement;
  root.setAttribute('data-theme',root.getAttribute('data-theme')==='dark'?'light':'dark');
  $('themeBtn').querySelector('svg').style.transform='rotate(360deg)';
  setTimeout(()=>$('themeBtn').querySelector('svg').style.transform='',400);
  const date=selectedDate||todayStr();
  if(allStats[date]) buildCategoryList(processDay(allStats[date]));
});

/* ── KPI entrance ── */
document.querySelectorAll('.kcard').forEach((k,i)=>setTimeout(()=>k.classList.add('vis'),i*55+200));

/* ── Card observer ── */
const obs=new IntersectionObserver(entries=>{entries.forEach(e=>{if(!e.isIntersecting)return;e.target.classList.add('vis');obs.unobserve(e.target);});},{threshold:0.06});
document.querySelectorAll('.card').forEach(c=>obs.observe(c));

$('tl-date').textContent=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});