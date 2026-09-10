import express from 'express';
import webpush from 'web-push';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express();
const PORT=process.env.PORT||3000;
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'data');
fs.mkdirSync(DATA_DIR,{recursive:true});
app.use(express.json({limit:'250kb'}));
app.use(express.static(path.join(__dirname,'public')));

const dbFile=path.join(DATA_DIR,'push-db.json');
const keyFile=path.join(DATA_DIR,'vapid.json');
const prayerFile=path.join(DATA_DIR,'prayer-cache.json');
const readJson=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const writeJson=(f,v)=>fs.writeFileSync(f,JSON.stringify(v,null,2));
let db=readJson(dbFile,{clients:{}});
let prayerCache=readJson(prayerFile,{});

function base64url(buf){return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function ensureVapid(){
  let keys=readJson(keyFile,null);if(keys)return keys;
  const ecdh=crypto.createECDH('prime256v1');ecdh.generateKeys();
  keys={publicKey:base64url(ecdh.getPublicKey(null,'uncompressed')),privateKey:base64url(ecdh.getPrivateKey())};
  writeJson(keyFile,keys);return keys;
}
const vapid=ensureVapid();
webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY||vapid.publicKey,process.env.VAPID_PRIVATE_KEY||vapid.privateKey);
const keyOf=sub=>crypto.createHash('sha256').update(sub.endpoint).digest('hex').slice(0,32);
const safeEvent=e=>({at:new Date(e.at).toISOString(),title:String(e.title||'Vakit').slice(0,80),body:String(e.body||'').slice(0,180),tag:String(e.tag||'vakit').slice(0,60),sent:false});
const pushOptions={TTL:180,urgency:'high'};

function trDateKey(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const o=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${o.year}-${o.month}-${o.day}`;
}
function addDaysKey(key,days){const [y,m,d]=key.split('-').map(Number);const x=new Date(Date.UTC(y,m-1,d+days,12));return x.toISOString().slice(0,10)}
function trInstant(dateKey,hm){return new Date(`${dateKey}T${hm.slice(0,5)}:00+03:00`)}
function addMinutes(d,m){return new Date(d.getTime()+m*60000)}
function cleanTime(t){return String(t||'').replace(/\s*\(.+\)$/,'').slice(0,5)}

async function getPrayerTimes({district='Etimesgut',city='Ankara',country='TR',date}){
  const cacheKey=[district,city,country,date].join('|').toLowerCase();
  if(prayerCache[cacheKey])return prayerCache[cacheKey];
  const search=encodeURIComponent(district);
  const geoUrl=`https://geocoding-api.open-meteo.com/v1/search?name=${search}&count=10&language=tr&format=json&countryCode=${encodeURIComponent(country)}`;
  const geo=await fetch(geoUrl,{headers:{'user-agent':'VakitPWA/1.0'}}).then(r=>{if(!r.ok)throw new Error('geocode');return r.json()});
  const results=geo.results||[];
  const needle=String(district).toLocaleLowerCase('tr');
  const cityNeedle=String(city).toLocaleLowerCase('tr');
  const loc=results.find(x=>String(x.name).toLocaleLowerCase('tr').includes(needle)&&String(x.admin1||'').toLocaleLowerCase('tr').includes(cityNeedle))||results.find(x=>String(x.name).toLocaleLowerCase('tr').includes(needle))||results[0];
  if(!loc)throw new Error('Konum bulunamadı');
  const [y,m,d]=date.split('-');const dd=`${d}-${m}-${y}`;
  const url=`https://api.aladhan.com/v1/timings/${dd}?latitude=${loc.latitude}&longitude=${loc.longitude}&method=13&school=1&timezonestring=Europe%2FIstanbul`;
  const data=await fetch(url).then(r=>{if(!r.ok)throw new Error('prayer');return r.json()});
  if(data.code!==200)throw new Error('prayer data');
  const t=data.data.timings;
  const payload={source:'AlAdhan · Diyanet yöntemi',location:{name:loc.name,admin1:loc.admin1,latitude:loc.latitude,longitude:loc.longitude},timings:{Imsak:t.Imsak,Fajr:t.Fajr,Sunrise:t.Sunrise,Dhuhr:t.Dhuhr,Asr:t.Asr,Maghrib:t.Maghrib,Isha:t.Isha}};
  prayerCache[cacheKey]=payload;writeJson(prayerFile,prayerCache);return payload;
}

async function buildProfileEvents(profile,days=8){
  const out=[];const first=trDateKey();
  for(let i=0;i<days;i++){
    const date=addDaysKey(first,i);
    try{
      const p=(await getPrayerTimes({...profile,date})).timings;
      const sunrise=trInstant(date,cleanTime(p.Sunrise));
      const wake=addMinutes(sunrise,-Math.max(10,Math.min(45,Number(profile.wakeOffset)||20)));
      const activityStart=addMinutes(sunrise,2);
      out.push(safeEvent({at:wake,title:'Uyanma zamanı',body:`Güneşe ${Number(profile.wakeOffset)||20} dk var. Sabah namazı için kalk.`,tag:`wake-${date}`}));
      out.push(safeEvent({at:activityStart,title:'Güneş doğdu',body:profile.activity==='bike'?`${Number(profile.activityMinutes)||40} dk rahat bisiklet için uygun zaman.`:`${Number(profile.activityMinutes)||30} dk rahat yürüyüş için uygun zaman.`,tag:`morning-${date}`}));
      for(const [k,n] of [['Dhuhr','Öğle'],['Asr','İkindi'],['Maghrib','Akşam'],['Isha','Yatsı']]){
        const at=addMinutes(trInstant(date,cleanTime(p[k])),-5);
        out.push(safeEvent({at,title:`${n} namazına 5 dk`,body:`${n} vakti ${cleanTime(p[k])}.`,tag:`prayer-${k}-${date}`}));
      }
    }catch(err){console.error('profile schedule error',date,err.message)}
  }
  return out.filter(e=>Date.parse(e.at)>Date.now()-60000);
}

app.get('/api/health',(req,res)=>res.json({ok:true,time:new Date().toISOString()}));
app.get('/api/vapid-public-key',(req,res)=>res.json({publicKey:process.env.VAPID_PUBLIC_KEY||vapid.publicKey}));
app.get('/api/prayer-times',async(req,res)=>{
  const district=String(req.query.district||'Etimesgut').slice(0,80),city=String(req.query.city||'Ankara').slice(0,80),country=String(req.query.country||'TR').slice(0,4),date=String(req.query.date||trDateKey());
  try{res.json(await getPrayerTimes({district,city,country,date}))}catch(e){res.status(502).json({error:'Vakit verisi alınamadı',detail:e.message})}
});

app.post('/api/profile',async(req,res)=>{
  const {subscription,profile}=req.body||{};
  if(!subscription?.endpoint||!profile)return res.status(400).json({error:'Eksik veri'});
  const id=keyOf(subscription);
  const cleanProfile={district:String(profile.district||'Etimesgut').slice(0,80),city:String(profile.city||'Ankara').slice(0,80),country:'TR',wakeOffset:Math.max(10,Math.min(45,Number(profile.wakeOffset)||20)),activity:profile.activity==='bike'?'bike':'walk',activityMinutes:Math.max(10,Math.min(120,Number(profile.activityMinutes)||30))};
  const prev=db.clients[id]||{};
  db.clients[id]={...prev,subscription,profile:cleanProfile,profileEvents:await buildProfileEvents(cleanProfile),updatedAt:new Date().toISOString(),profileRefreshedAt:new Date().toISOString()};
  writeJson(dbFile,db);res.json({ok:true,count:db.clients[id].profileEvents.length});
});

app.post('/api/schedule',(req,res)=>{
  const {subscription,events,append=false}=req.body||{};
  if(!subscription?.endpoint||!Array.isArray(events))return res.status(400).json({error:'Eksik veri'});
  if(events.length>40)return res.status(400).json({error:'Çok fazla olay'});
  const id=keyOf(subscription),fresh=events.map(safeEvent).filter(e=>Date.parse(e.at)>Date.now()-60000&&Date.parse(e.at)<Date.now()+8*24*3600000);
  const prev=db.clients[id]||{};const before=prev.manualEvents||[];
  db.clients[id]={...prev,subscription,manualEvents:append?[...before,...fresh]:fresh,updatedAt:new Date().toISOString()};
  writeJson(dbFile,db);res.json({ok:true,count:db.clients[id].manualEvents.length});
});

app.post('/api/test-push',async(req,res)=>{
  const {subscription}=req.body||{};if(!subscription?.endpoint)return res.status(400).json({error:'Abonelik gerekli'});
  try{await webpush.sendNotification(subscription,JSON.stringify({title:'Vakit',body:String(req.body?.message||'Test bildirimi'),tag:'test'}),pushOptions);res.json({ok:true,sent:1})}
  catch(e){res.status(502).json({ok:false,error:'Push gönderilemedi'})}
});

let ticking=false;
async function tick(){
  if(ticking)return;ticking=true;
  try{
    const now=Date.now();let changed=false;
    for(const [id,c] of Object.entries(db.clients)){
      for(const group of ['profileEvents','manualEvents']){
        for(const e of c[group]||[]){
          if(!e.sent&&Date.parse(e.at)<=now&&Date.parse(e.at)>=now-180000){
            try{await webpush.sendNotification(c.subscription,JSON.stringify({title:e.title,body:e.body,tag:e.tag}),pushOptions);e.sent=true;changed=true}
            catch(err){if(err?.statusCode===404||err?.statusCode===410){delete db.clients[id];changed=true;break}}
          }
        }
      }
    }
    if(changed)writeJson(dbFile,db);
  }finally{ticking=false}
}

let refreshing=false;
async function refreshHorizons(){
  if(refreshing)return;refreshing=true;
  try{
    let changed=false;
    for(const c of Object.values(db.clients)){
      if(!c.profile)continue;
      const age=Date.now()-Date.parse(c.profileRefreshedAt||0);
      const last=(c.profileEvents||[]).reduce((m,e)=>Math.max(m,Date.parse(e.at)||0),0);
      if(age>6*3600000||last<Date.now()+5*24*3600000){c.profileEvents=await buildProfileEvents(c.profile);c.profileRefreshedAt=new Date().toISOString();changed=true}
    }
    if(changed)writeJson(dbFile,db);
  }finally{refreshing=false}
}

setInterval(tick,15000);setInterval(refreshHorizons,60*60*1000);tick();refreshHorizons();
app.get('/{*splat}',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Vakit running on :${PORT}`));
