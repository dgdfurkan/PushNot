const CACHE='vakit-shell-v1';
const CORE=['/','/index.html','/styles.css','/app.js','/manifest.webmanifest','/icons/icon-192.png','/icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin===location.origin && e.request.method==='GET'){
    e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/index.html'))));
  }
});
self.addEventListener('push',e=>{
  let data={title:'Vakit',body:'Günlük planında yeni bir adım var.',tag:'vakit'};
  try{data={...data,...e.data.json()}}catch{}
  e.waitUntil(self.registration.showNotification(data.title,{body:data.body,tag:data.tag||'vakit',icon:'/icons/icon-192.png',badge:'/icons/icon-192.png',data:data.data||{},renotify:true}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus'in c)return c.focus()}
    return clients.openWindow('/');
  }));
});
