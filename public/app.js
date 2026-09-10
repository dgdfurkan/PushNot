const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const ICONS={
  sun:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  pray:'<svg viewBox="0 0 24 24"><path d="M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-7 18c.8-4.5 3.1-7 7-7s6.2 2.5 7 7M3 21h18"/></svg>',
  walk:'<svg viewBox="0 0 24 24"><circle cx="13" cy="4" r="2"/><path d="m10 22 1-6-3-3 3-5 4 2 3 4m-7 2 4 2 2 4M8 13l-4 2"/></svg>',
  bike:'<svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M8 17.5 11 11h4l3.5 6.5M9.5 8.5h3M11 11l5 6.5M14.5 8.5h2"/></svg>',
  food:'<svg viewBox="0 0 24 24"><path d="M6 3v7m3-7v7M6 7h3m-1.5 3v11M16 3v18m0-18c3 2 4 6 0 9"/></svg>',
  work:'<svg viewBox="0 0 24 24"><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0h10a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-8a3 3 0 0 1 3-3Z"/></svg>'
};
const DEFAULTS={district:'Etimesgut',city:'Ankara',country:'TR',workDay:true,workEnd:'01:30',windDown:45,wakeOffset:20,activity:'walk',activityMinutes:{walk:30,bike:40},napChoice:'auto'};
function todayKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const o=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
const savedSettings=JSON.parse(localStorage.getItem('vakit.settings')||'{}');
const state={
  settings:{...DEFAULTS,...savedSettings,activityMinutes:{...DEFAULTS.activityMinutes,...(savedSettings.activityMinutes||{})}},
  prayer:null,plan:null,activity:null,
  focus:{mode:'focus',preset:25,remaining:25*60,running:false,last:0,timer:null},
  stats:JSON.parse(localStorage.getItem(`vakit.stats.${todayKey()}`)||'{"focus":0,"break":0,"rounds":0,"activity":null}')
};
function saveSettings(){localStorage.setItem('vakit.settings',JSON.stringify(state.settings))}
function saveStats(){localStorage.setItem(`vakit.stats.${todayKey()}`,JSON.stringify(state.stats));renderStats()}
function toast(msg){const e=$('#toast');if(!e)return;e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2400)}
function parseTime(hm,base=new Date()){const [h,m]=String(hm).split(':').map(Number),d=new Date(base);d.setHours(h,m,0,0);return d}
function addMin(d,m){return new Date(d.getTime()+m*60000)}
function fmt(d){return new Intl.DateTimeFormat('tr-TR',{hour:'2-digit',minute:'2-digit',hour12:false}).format(d)}
function clean(t){return String(t||'').replace(/\s*\(.+\)$/,'').slice(0,5)}
function mins(a,b){return Math.round((b-a)/60000)}
function demoPrayer(){return {Imsak:'04:52',Fajr:'04:52',Sunrise:'06:20',Dhuhr:'12:50',Asr:'16:26',Maghrib:'19:14',Isha:'20:38',demo:true}}

async function loadPrayer(){
  $('#statusText').textContent='Namaz vakitleri alınıyor…';
  try{
    const q=new URLSearchParams({district:state.settings.district,city:state.settings.city,country:'TR',date:todayKey()});
    const r=await fetch('/api/prayer-times?'+q,{cache:'no-store'});
    if(!r.ok)throw new Error('Vakit servisi yanıt vermedi');
    const j=await r.json();
    state.prayer={...j.timings,demo:false};
    $('#statusText').textContent=`Vakitler güncel · ${j.source||'sunucu'}`;
  }catch(e){
    state.prayer=demoPrayer();
    $('#statusText').textContent='Sunucuya ulaşılamadı · önizleme verisi';
  }
  buildPlan();renderAll();syncPushSchedule();
}

function buildPlan(){
  const p=state.prayer,sunrise=parseTime(clean(p.Sunrise)),dhuhr=parseTime(clean(p.Dhuhr));
  const wake=addMin(sunrise,-Number(state.settings.wakeOffset||20));
  const activityStart=addMin(sunrise,2),activityEnd=addMin(activityStart,state.settings.activityMinutes[state.settings.activity]),breakfast=addMin(activityEnd,5);
  let bed=addMin(parseTime(state.settings.workEnd),Number(state.settings.windDown||45));if(bed>wake)bed.setDate(bed.getDate()-1);
  const core=Math.max(0,mins(bed,wake)),protectedStart=addMin(dhuhr,-15),protectedEnd=addMin(dhuhr,10),napEnd=addMin(protectedStart,-10);
  let nap=core<330?{start:addMin(napEnd,-90),end:napEnd,minutes:90}:{start:addMin(napEnd,-20),end:napEnd,minutes:20};
  if(state.settings.napChoice==='none')nap=null;
  state.plan={bed,wake,sunrise,activityStart,activityEnd,breakfast,dhuhr,core,protectedStart,protectedEnd,nap};
}

function renderPrayer(){
  const p=state.prayer,rows=[
    {n:'Sabah',t:p.Fajr||p.Imsak,c:'fajr'},
    {n:'Güneş',t:p.Sunrise,c:'sunrise'},
    {n:'Öğle',t:p.Dhuhr,c:'dhuhr'},
    {n:'İkindi',t:p.Asr,c:'asr'},
    {n:'Akşam',t:p.Maghrib,c:'maghrib'},
    {n:'Yatsı',t:p.Isha,c:'isha'}
  ],now=new Date();
  let active=rows.findIndex(x=>parseTime(clean(x.t))>now);if(active<0)active=rows.length-1;
  $('#prayerGrid').innerHTML=rows.map((x,i)=>`<div class="prayer-pill ${x.c} ${i===active?'active':''}"><span>${x.n}</span><strong>${clean(x.t)}</strong></div>`).join('');
}

function nextEvents(){
  const p=state.prayer,x=state.plan;
  return [
    {t:x.wake,title:'Uyanma zamanı',text:`Güneş ${clean(p.Sunrise)} · sabah namazı için kalk.`,icon:'sun'},
    {t:x.activityStart,title:'Sabah hareketi',text:state.settings.activity==='walk'?'30 dk yürüyüş zamanı.':'40 dk bisiklet zamanı.',icon:state.settings.activity==='walk'?'walk':'bike'},
    ...[['Dhuhr','Öğle'],['Asr','İkindi'],['Maghrib','Akşam'],['Isha','Yatsı']].map(([k,n])=>({t:addMin(parseTime(clean(p[k])),-5),title:`${n} namazı yaklaşıyor`,text:`Vakit ${clean(p[k])} · 5 dakika kaldı.`,icon:'pray'}))
  ].sort((a,b)=>a.t-b.t);
}
function renderHero(){
  const now=new Date(),ev=nextEvents(),e=ev.find(x=>x.t>now)||ev.at(-1),diff=mins(now,e.t);
  $('#heroIcon').innerHTML=ICONS[e.icon]||ICONS.pray;$('#heroTitle').textContent=e.title;$('#heroText').textContent=e.text;$('#heroTime').textContent=fmt(e.t);$('#heroEyebrow').textContent=diff>=0?`${diff} DK SONRA`:'BUGÜNÜN SON ADIMI';
}

function renderTimeline(){
  const p=state.prayer,x=state.plan,rows=[
    [fmt(x.wake),'sun','Uyan',`Sabah namazı · güneş ${clean(p.Sunrise)}`],
    [clean(p.Sunrise),'sun','Güneş','Sabah vaktinin sonu · hareket başlangıcı'],
    [fmt(x.activityStart),'walk',state.settings.activity==='walk'?'Yürüyüş':'Bisiklet',`${state.settings.activityMinutes[state.settings.activity]} dk · bitmeden 5 dk önce bildirim`],
    [fmt(x.breakfast),'food','Kahvaltı','Eve dönüşte hazırla'],
    [clean(p.Dhuhr),'pray','Öğle namazı','5 dk önce bildirim'],
    [clean(p.Asr),'pray','İkindi namazı','5 dk önce bildirim'],
    [clean(p.Maghrib),'pray','Akşam namazı','5 dk önce bildirim'],
    [clean(p.Isha),'pray','Yatsı namazı','5 dk önce bildirim']
  ];
  if(state.settings.workDay)rows.push(['19:30','work','İşe hazırlan','İş günü bildirimi açık']);
  $('#timeline').innerHTML=rows.map(r=>`<div class="timeline-row"><div class="timeline-time">${r[0]}</div><div class="timeline-icon ${r[1]}">${ICONS[r[1]]||ICONS.pray}</div><div class="timeline-copy"><strong>${r[2]}</strong><span>${r[3]}</span></div></div>`).join('');
}

function renderSleep(){
  const x=state.plan,h=Math.floor(x.core/60),m=x.core%60;$('#summaryBed').textContent=fmt(x.bed);$('#summaryWake').textContent=fmt(x.wake);
  $('#sleepTitle').textContent=`${h} sa ${m} dk gece uykusu`;
  $('#sleepText').textContent=x.core<330?(x.nap?`${fmt(x.nap.start)}–${fmt(x.nap.end)} arasında 90 dk telafi bloğu öneriliyor.`:'Bugün telafi uykusunu kapattın; mümkünse geceyi daha erkene çek.'):(x.nap?`${fmt(x.nap.start)}–${fmt(x.nap.end)} kısa şekerleme penceresi.`:'Şekerleme bugün kapalı.');
  $('#summaryNap').textContent=x.nap?`${fmt(x.nap.start)} · ${x.nap.minutes} dk`:'Bugün yok';$('#napAction').textContent=x.nap?'Bugün yapamam':'Şekerlemeyi aç';
}

const breakfasts=[
  ['Yumurta + peynir + domates','Kekik ve baharat ekle; yanına su. Ekmek varsa küçük porsiyon.'],
  ['Yoğurt + yulaf + meyve','Evde varsa ceviz veya badem ekle.'],
  ['Peynirli omlet + domates','Yanında yeşillik varsa ekle.'],
  ['Avokado + yumurta + domates','Ekmeği küçük tut.'],
  ['Peynir + domates + zeytin + yoğurt','Yumurtasız gün için basit tabak.']
];
let breakfastIndex=0;
function renderBreakfast(){const b=breakfasts[breakfastIndex%breakfasts.length];$('#breakfastTitle').textContent=b[0];$('#breakfastText').textContent=b[1]}

function renderSettings(){
  const loc=`${state.settings.district}, ${state.settings.city}`;
  $('#todayLabel').textContent=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',weekday:'long',day:'numeric',month:'long'}).format(new Date());
  $('#locationTitle').textContent=loc;$('#locationTop').textContent=loc;$('#heroLocation').textContent=`${state.settings.district} · ${state.settings.city}`;
  $('#districtInput').value=state.settings.district;$('#cityInput').value=state.settings.city;$('#workEndInput').value=state.settings.workEnd;$('#windDownInput').value=state.settings.windDown;$('#wakeOffsetInput').value=state.settings.wakeOffset;
  $('#workToggle').classList.toggle('on',state.settings.workDay);$('#workToggle').setAttribute('aria-pressed',String(state.settings.workDay));$('#summaryWork').textContent=state.settings.workDay?'İş günü':'İzin günü';
  $$('.seg[data-activity]').forEach(x=>x.classList.toggle('active',x.dataset.activity===state.settings.activity));
}
function renderStats(){
  $('#todayFocus').textContent=`${state.stats.focus||0} dk`;$('#todayBreak').textContent=`${state.stats.break||0} dk`;$('#todayRounds').textContent=state.stats.rounds||0;$('#wrapFocus').textContent=`${state.stats.focus||0} dk`;
  if(state.stats.activity){$('#wrapActivity').textContent=`${state.stats.activity.minutes} dk`;$('#wrapActivitySub').textContent=state.stats.activity.type==='bike'?'bisiklet':'yürüyüş'}else{$('#wrapActivity').textContent='Henüz yok';$('#wrapActivitySub').textContent='Başlattığın yürüyüş veya bisiklet burada görünür.'}
}
function renderAll(){renderPrayer();renderHero();renderTimeline();renderSleep();renderBreakfast();renderSettings();renderStats();renderFocus()}

function schedulePayload(){
  const x=state.plan,today=new Date(),ev=[];const add=(t,title,body,tag)=>{if(t>Date.now())ev.push({at:new Date(t).toISOString(),title,body,tag})};
  if(x.nap)add(addMin(x.nap.start,-5),'Şekerleme penceresi',`${fmt(x.nap.start)}’te ${x.nap.minutes} dk uyku planın var.`,'nap');
  if(state.settings.workDay)add(parseTime('19:30',today),'İşe hazırlık','30 dakika sonra iş için çıkış hazırlığı.','work');
  return ev;
}
function b64url(s){const pad='='.repeat((4-s.length%4)%4),raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))}
async function syncPushSchedule(){
  if(!('Notification'in window)||Notification.permission!=='granted'||!('serviceWorker'in navigator)||!state.prayer)return;
  try{
    const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub)return;
    const profile={district:state.settings.district,city:state.settings.city,country:'TR',wakeOffset:Number(state.settings.wakeOffset),activity:state.settings.activity,activityMinutes:Number(state.settings.activityMinutes[state.settings.activity])};
    await fetch('/api/profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),profile})});
    await fetch('/api/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),events:schedulePayload(),kind:'manual'})});
  }catch{}
}
async function enableNotifications(){
  if(!('serviceWorker'in navigator)||!('PushManager'in window)){toast('Bu tarayıcı Web Push desteklemiyor.');return}
  const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!standalone){$('#notificationNote').textContent='iPhone’da önce Safari → Paylaş → Ana Ekrana Ekle. Sonra uygulamayı ana ekrandan aç.';toast('Önce ana ekrana ekle.');return}
  try{
    if(await Notification.requestPermission()!=='granted')throw new Error();const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();
    if(!sub){const k=await fetch('/api/vapid-public-key').then(r=>r.json());sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64url(k.publicKey)})}
    $('#notificationNote').textContent='Bildirimler açık. Plan push sunucusuyla eşitlendi.';await syncPushSchedule();toast('Bildirimler açıldı.');
  }catch{$('#notificationNote').textContent='Bildirim kurulamadı. PWA olarak ana ekrandan açtığından emin ol.';toast('Bildirim kurulamadı.')}
}
async function testNotification(){
  if(!('Notification'in window)||Notification.permission!=='granted'){toast('Önce bildirimleri aç.');return}
  try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub)throw new Error();const r=await fetch('/api/test-push',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),message:'Test başarılı. Vakit bildirimleri çalışıyor.'})});if(!r.ok)throw new Error();toast('Test gönderildi.')}catch{toast('Test gönderilemedi.')}
}
function notificationStatus(){if(!('Notification'in window)){$('#notificationNote').textContent='Bu tarayıcı bildirim desteklemiyor.';return}$('#notificationNote').textContent=Notification.permission==='granted'?'Bildirim izni açık.':Notification.permission==='denied'?'Bildirim izni kapalı.':'Henüz izin verilmedi.'}

function startActivity(){
  if(state.activity?.running)return;const total=state.settings.activityMinutes[state.settings.activity],start=Date.now();
  state.activity={running:true,type:state.settings.activity,total,start,end:start+total*60000};$('#startActivity').classList.add('hidden');$('#activityLive').classList.remove('hidden');tickActivity();state.activity.timer=setInterval(tickActivity,1000);scheduleActivityPush(total);
}
function tickActivity(){if(!state.activity)return;const s=Math.max(0,Math.ceil((state.activity.end-Date.now())/1000));$('#activityTimer').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;if(!s)finishActivity()}
function finishActivity(){if(!state.activity)return;clearInterval(state.activity.timer);const done=Math.max(1,Math.min(state.activity.total,Math.round((Date.now()-state.activity.start)/60000)));state.stats.activity={type:state.activity.type,minutes:done};state.activity=null;$('#activityLive').classList.add('hidden');$('#startActivity').classList.remove('hidden');saveStats();toast('Aktivite kaydedildi. Kahvaltı zamanı.')}
async function scheduleActivityPush(minutes){
  if(!('Notification'in window)||Notification.permission!=='granted')return;
  try{const reg=await navigator.serviceWorker.ready,sub=await reg.pushManager.getSubscription();if(!sub)return;const now=Date.now(),events=[{at:new Date(now+(minutes-5)*60000).toISOString(),title:'5 dakika kaldı',body:'Yavaştan dönüşe geç.',tag:'activity-five'},{at:new Date(now+minutes*60000).toISOString(),title:'Aktivite tamamlandı',body:'Eve dön. Kahvaltını hazırlayalım.',tag:'activity-end'}];await fetch('/api/schedule',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:sub.toJSON(),events,kind:'activity'})})}catch{}
}

function renderFocus(){
  const f=state.focus,total=(f.mode==='focus'?f.preset:(f.preset===25?5:10))*60,pct=Math.max(0,Math.min(1,1-f.remaining/total));
  $('#focusModeLabel').textContent=f.mode==='focus'?'Odak':'Mola';$('#focusTimer').textContent=`${String(Math.floor(f.remaining/60)).padStart(2,'0')}:${String(Math.max(0,f.remaining%60)).padStart(2,'0')}`;$('#focusRing').style.setProperty('--progress',`${pct*100}%`);$('#focusPresetTag').textContent=f.preset===25?'25 / 5':'50 / 10';const label=$('#focusToggle span');if(label)label.textContent=f.running?'Duraklat':'Başlat';
}
function focusToggle(){
  const f=state.focus;f.running=!f.running;
  if(f.running){f.last=Date.now();f.timer=setInterval(()=>{const now=Date.now();f.remaining-=Math.max(1,Math.floor((now-f.last)/1000));f.last=now;if(f.remaining<=0){clearInterval(f.timer);if(f.mode==='focus'){state.stats.focus=(state.stats.focus||0)+f.preset;state.stats.rounds=(state.stats.rounds||0)+1;f.mode='break';f.remaining=(f.preset===25?5:10)*60}else{state.stats.break=(state.stats.break||0)+(f.preset===25?5:10);f.mode='focus';f.remaining=f.preset*60}f.running=false;saveStats();toast(f.mode==='break'?'Odak tamam. Mola zamanı.':'Mola bitti. Yeni tura hazırsın.')}renderFocus()},1000)}else clearInterval(f.timer);renderFocus();
}
function resetFocus(){clearInterval(state.focus.timer);state.focus.running=false;state.focus.mode='focus';state.focus.remaining=state.focus.preset*60;renderFocus()}

function gotoPage(name){const nav=document.querySelector(`[data-nav="${name}"]`);if(nav)nav.click()}
function bind(){
  $$('.nav-item').forEach(b=>b.onclick=()=>{$$('.nav-item').forEach(x=>x.classList.toggle('active',x===b));$$('.page').forEach(p=>p.classList.toggle('active',p.dataset.page===b.dataset.nav));window.scrollTo({top:0,behavior:'smooth'})});
  $$('[data-goto]').forEach(b=>b.onclick=()=>gotoPage(b.dataset.goto));
  $$('.seg[data-activity]').forEach(b=>b.onclick=()=>{$$('.seg[data-activity]').forEach(x=>x.classList.toggle('active',x===b));state.settings.activity=b.dataset.activity;saveSettings();buildPlan();renderTimeline();renderHero();syncPushSchedule()});
  $$('.seg[data-preset]').forEach(b=>b.onclick=()=>{$$('.seg[data-preset]').forEach(x=>x.classList.toggle('active',x===b));state.focus.preset=Number(b.dataset.preset);resetFocus()});
  $('#shuffleBreakfast').onclick=()=>{breakfastIndex++;renderBreakfast();toast('Başka bir seçenek hazırladım.')};
  $('#workToggle').onclick=()=>{state.settings.workDay=!state.settings.workDay;state.settings.workDayDate=todayKey();saveSettings();renderAll();syncPushSchedule()};
  $('#quickDayMode').onclick=()=>{$('#workToggle').click();toast(state.settings.workDay?'Bugün iş günü.':'Bugün izin günü. İş bildirimleri kapandı.')};
  $('#saveLocation').onclick=()=>{state.settings.district=$('#districtInput').value.trim()||'Etimesgut';state.settings.city=$('#cityInput').value.trim()||'Ankara';saveSettings();loadPrayer();toast('Konum güncelleniyor.')};
  $('#saveRoutine').onclick=()=>{state.settings.workEnd=$('#workEndInput').value;state.settings.windDown=Number($('#windDownInput').value);state.settings.wakeOffset=Number($('#wakeOffsetInput').value);saveSettings();buildPlan();renderAll();syncPushSchedule();toast('Gece rutini güncellendi.')};
  $('#napAction').onclick=()=>{state.settings.napChoice=state.plan.nap?'none':'auto';saveSettings();buildPlan();renderSleep();syncPushSchedule();toast(state.plan.nap?'Şekerleme tekrar plana eklendi.':'Bugün şekerleme kaldırıldı.')};
  $('#enableNotifications').onclick=enableNotifications;$('#testNotification').onclick=testNotification;$('#startActivity').onclick=startActivity;$('#stopActivity').onclick=finishActivity;$('#focusToggle').onclick=focusToggle;$('#focusReset').onclick=resetFocus;
}

async function init(){
  if(state.settings.workDayDate!==todayKey()){state.settings.workDay=true;state.settings.workDayDate=todayKey();saveSettings()}
  if('serviceWorker'in navigator)await navigator.serviceWorker.register('/sw.js').catch(()=>{});
  bind();notificationStatus();renderFocus();renderSettings();renderStats();await loadPrayer();
  setInterval(()=>{if(state.prayer){renderHero();renderPrayer()}},30000);
}
init();