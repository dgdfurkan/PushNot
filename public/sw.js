const CACHE='vakit-shell-v4';
const CORE=['/','/index.html','/styles.css','/reminders.css','/app.js','/reminders.js','/manifest.webmanifest','/icons/icon.svg'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))]))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin===location.origin&&e.request.method==='GET'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));
  }
});
self.addEventListener('push',e=>{
  let data={title:'Vakit',body:'Günlük planında yeni bir adım var.',tag:'vakit'};
  try{data={...data,...e.data.json()}}catch{}
  const options={body:data.body||'',tag:data.tag||'vakit',icon:'/icons/icon.svg',renotify:true,data:{url:data.url||'/'}};
  if(data.image)options.image=data.image;
  e.waitUntil(self.registration.showNotification(data.title||'Vakit',options));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  const raw=e.notification.data?.url||'/';
  let target='/';
  try{target=new URL(raw,self.location.origin).href}catch{}
  e.waitUntil((async()=>{
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    const sameOrigin=target.startsWith(self.location.origin);
    if(sameOrigin){
      for(const c of list){
        if(c.url.startsWith(self.location.origin)&&'focus'in c){
          await c.focus();
          if('navigate'in c)await c.navigate(target);
          return;
        }
      }
    }
    return clients.openWindow(target);
  })());
});