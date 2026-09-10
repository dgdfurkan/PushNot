(()=>{
  const $=s=>document.querySelector(s);
  const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const toast=msg=>{const e=$('#toast');if(!e)return;e.textContent=msg;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),2400)};
  const b64url=s=>{const pad='='.repeat((4-s.length%4)%4),raw=atob((s+pad).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)))};
  const turkeyDate=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
  const turkeyTime=d=>new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);
  const pretty=d=>new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(d));

  async function getSubscription(create=false){
    if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw new Error('Bu cihaz Web Push desteklemiyor.');
    const standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
    if(/iPhone|iPad|iPod/.test(navigator.userAgent)&&!standalone)throw new Error('iPhone’da önce uygulamayı Ana Ekrana Ekle ve oradan aç.');
    const reg=await navigator.serviceWorker.ready;
    let sub=await reg.pushManager.getSubscription();
    if(sub||!create)return sub;
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error('Bildirim izni verilmedi.');
    const key=await fetch('/api/vapid-public-key',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error();return r.json()});
    sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64url(key.publicKey)});
    return sub;
  }

  async function api(path,payload){
    const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.error||'İşlem tamamlanamadı.');
    return j;
  }

  function setDefaults(){
    const d=new Date(Date.now()+15*60000);
    const date=$('#reminderDate'),time=$('#reminderTime');
    if(date&&!date.value)date.value=turkeyDate(d);
    if(time&&!time.value)time.value=turkeyTime(d);
  }

  function updateImagePreview(){
    const input=$('#reminderImage'),box=$('#reminderImagePreview'),img=$('#reminderImagePreview img');
    if(!input||!box||!img)return;
    const url=input.value.trim();
    if(!url){box.classList.add('hidden');img.removeAttribute('src');return;}
    try{new URL(url);img.src=url;box.classList.remove('hidden')}catch{box.classList.add('hidden')}
  }

  async function loadReminders(){
    const list=$('#reminderList');if(!list)return;
    list.innerHTML='<div class="reminder-empty">Hatırlatmalar yükleniyor…</div>';
    try{
      const sub=await getSubscription(false);
      if(!sub){list.innerHTML='<div class="reminder-empty"><b>Henüz bildirim bağlantısı yok.</b><span>İlk hatırlatmayı kaydederken izin isteyeceğiz.</span></div>';return;}
      const j=await api('/api/reminders/list',{subscription:sub.toJSON()});
      if(!j.reminders?.length){list.innerHTML='<div class="reminder-empty"><b>Yaklaşan hatırlatma yok.</b><span>Yeni bir tane eklediğinde burada görünecek.</span></div>';return;}
      list.innerHTML=j.reminders.map(r=>`<article class="reminder-row" data-id="${esc(r.id)}">
        ${r.image?`<img src="${esc(r.image)}" alt="" class="reminder-thumb" loading="lazy" />`:'<div class="reminder-bell">↗</div>'}
        <div class="reminder-row-copy"><span>${esc(pretty(r.at))}</span><strong>${esc(r.title)}</strong>${r.body?`<p>${esc(r.body)}</p>`:''}${r.url?'<small>Dokununca bağlantı açılır</small>':''}</div>
        <button class="reminder-delete" type="button" aria-label="Hatırlatmayı sil" data-reminder-delete="${esc(r.id)}">×</button>
      </article>`).join('');
    }catch(e){list.innerHTML=`<div class="reminder-empty error"><b>Liste alınamadı.</b><span>${esc(e.message)}</span></div>`;}
  }

  async function createReminder(ev){
    ev.preventDefault();
    const btn=$('#saveReminder'),date=$('#reminderDate')?.value,time=$('#reminderTime')?.value,title=$('#reminderTitle')?.value.trim(),body=$('#reminderBody')?.value.trim()||'',image=$('#reminderImage')?.value.trim()||'',url=$('#reminderUrl')?.value.trim()||'';
    if(!date||!time||!title){toast('Tarih, saat ve başlık gerekli.');return;}
    const at=new Date(`${date}T${time}:00+03:00`);
    if(!Number.isFinite(at.getTime())||at.getTime()<=Date.now()+15000){toast('Gelecekte bir tarih ve saat seç.');return;}
    try{
      if(btn){btn.disabled=true;btn.querySelector('span').textContent='Kaydediliyor…'}
      const sub=await getSubscription(true);
      await api('/api/reminders/create',{subscription:sub.toJSON(),at:at.toISOString(),title,body,image,url});
      toast('Hatırlatma kaydedildi.');
      $('#reminderTitle').value='';$('#reminderBody').value='';$('#reminderImage').value='';$('#reminderUrl').value='';updateImagePreview();setDefaults();await loadReminders();
    }catch(e){toast(e.message||'Hatırlatma kaydedilemedi.');}
    finally{if(btn){btn.disabled=false;btn.querySelector('span').textContent='Hatırlatmayı kaydet'}}
  }

  async function deleteReminder(id){
    try{
      const sub=await getSubscription(false);if(!sub)throw new Error('Bildirim bağlantısı bulunamadı.');
      await api('/api/reminders/delete',{subscription:sub.toJSON(),id});
      toast('Hatırlatma silindi.');await loadReminders();
    }catch(e){toast(e.message||'Silinemedi.');}
  }

  function bind(){
    const form=$('#reminderForm');if(!form)return;
    form.addEventListener('submit',createReminder);
    $('#reminderImage')?.addEventListener('input',updateImagePreview);
    $('#reminderList')?.addEventListener('click',e=>{const b=e.target.closest('[data-reminder-delete]');if(b)deleteReminder(b.dataset.reminderDelete)});
    document.querySelector('[data-nav="reminders"]')?.addEventListener('click',loadReminders);
    setDefaults();loadReminders();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
