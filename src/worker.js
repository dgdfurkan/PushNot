import { handleReminderApi, tickReminders } from './reminders.js';

const te = new TextEncoder();

const j = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

function b64u(bytes) {
  let s = '';
  const a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const n of a) s += String.fromCharCode(n);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64uDecode(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function concat(...parts) {
  const size = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hashId(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(text)));
  return [...d].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

async function hkdf(ikm, salt, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

async function ensureDb(env) {
  if (!env.DB) throw new Error('Cloudflare D1 binding eksik: binding adı DB olmalı.');
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL UNIQUE, p256dh TEXT NOT NULL, auth TEXT NOT NULL, profile TEXT, updated_at TEXT NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL, at TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, tag TEXT NOT NULL, kind TEXT NOT NULL DEFAULT \'manual\', sent INTEGER NOT NULL DEFAULT 0, UNIQUE(client_id, tag, at))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_events_due ON events(sent, at)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS prayer_cache (cache_key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)')
  ]);
}

async function ensureVapid(env) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k='vapid'").first();
  if (row?.v) return JSON.parse(row.v);

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const priv = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const rawPublic = concat(new Uint8Array([4]), b64uDecode(pub.x), b64uDecode(pub.y));
  const value = { publicKey: b64u(rawPublic), privateJwk: priv };
  await env.DB.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('vapid',?)").bind(JSON.stringify(value)).run();
  return value;
}

async function makeVapidJwt(endpoint, vapid) {
  const aud = new URL(endpoint).origin;
  const head = b64u(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(te.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:admin@pushnot.app' })));
  const data = te.encode(`${head}.${body}`);
  const key = await crypto.subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data));
  return `${head}.${body}.${b64u(sig)}`;
}

async function encryptPush(subscription, payload) {
  const clientPub = b64uDecode(subscription.keys.p256dh);
  const auth = b64uDecode(subscription.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const serverPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const clientKey = await crypto.subtle.importKey('raw', clientPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, eph.privateKey, 256));

  const info = concat(te.encode('WebPush: info\0'), clientPub, serverPub);
  const ikm = await hkdf(shared, auth, info, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, te.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plain = concat(te.encode(payload), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([serverPub.length]), serverPub, cipher);
}

async function sendPush(env, subscription, payload) {
  const vapid = await ensureVapid(env);
  const body = await encryptPush(subscription, JSON.stringify(payload));
  const jwt = await makeVapidJwt(subscription.endpoint, vapid);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'TTL': '180',
      'Urgency': 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Authorization': `vapid t=${jwt}, k=${vapid.publicKey}`
    },
    body
  });
}

function trDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const o = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${o.year}-${o.month}-${o.day}`;
}
function addDaysKey(key, days) { const [y, m, d] = key.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10); }
function cleanTime(t) { return String(t || '').replace(/\s*\(.+\)$/, '').slice(0, 5); }
function trInstant(dateKey, hm) { return new Date(`${dateKey}T${cleanTime(hm)}:00+03:00`); }
function addMinutes(d, m) { return new Date(d.getTime() + m * 60000); }
function safeEvent(e, kind = 'manual') { return { at: new Date(e.at).toISOString(), title: String(e.title || 'Vakit').slice(0, 80), body: String(e.body || '').slice(0, 180), tag: String(e.tag || 'vakit').slice(0, 80), kind }; }

async function getPrayerTimes(env, { district = 'Etimesgut', city = 'Ankara', country = 'TR', date = trDateKey() }) {
  const cacheKey = ['v2-school0', district, city, country, date].join('|').toLocaleLowerCase('tr');
  const cached = await env.DB.prepare('SELECT payload FROM prayer_cache WHERE cache_key=?').bind(cacheKey).first();
  if (cached?.payload) return JSON.parse(cached.payload);

  const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(district)}&count=10&language=tr&format=json&countryCode=${encodeURIComponent(country)}`;
  const geoRes = await fetch(geoUrl, { headers: { 'user-agent': 'VakitPWA/2.1' } });
  if (!geoRes.ok) throw new Error('Konum servisine ulaşılamadı');
  const geo = await geoRes.json();
  const results = geo.results || [];
  const needle = String(district).toLocaleLowerCase('tr');
  const cityNeedle = String(city).toLocaleLowerCase('tr');
  const loc = results.find(x => String(x.name).toLocaleLowerCase('tr').includes(needle) && String(x.admin1 || '').toLocaleLowerCase('tr').includes(cityNeedle)) || results.find(x => String(x.name).toLocaleLowerCase('tr').includes(needle)) || results[0];
  if (!loc) throw new Error('Konum bulunamadı');

  const [y, m, d] = date.split('-');
  const url = `https://api.aladhan.com/v1/timings/${d}-${m}-${y}?latitude=${loc.latitude}&longitude=${loc.longitude}&method=13&school=0&timezonestring=Europe%2FIstanbul`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('Namaz vakti servisine ulaşılamadı');
  const data = await r.json();
  if (data.code !== 200) throw new Error('Namaz vakti verisi alınamadı');
  const t = data.data.timings;
  const payload = {
    source: 'AlAdhan · Türkiye/Diyanet yöntemi · düzeltilmiş ikindi',
    location: { name: loc.name, admin1: loc.admin1, latitude: loc.latitude, longitude: loc.longitude },
    timings: { Imsak: t.Imsak, Fajr: t.Fajr, Sunrise: t.Sunrise, Dhuhr: t.Dhuhr, Asr: t.Asr, Maghrib: t.Maghrib, Isha: t.Isha }
  };
  await env.DB.prepare('INSERT OR REPLACE INTO prayer_cache(cache_key,payload,updated_at) VALUES(?,?,?)').bind(cacheKey, JSON.stringify(payload), new Date().toISOString()).run();
  return payload;
}

async function buildProfileEvents(env, profile, days = 8) {
  const out = [];
  const first = trDateKey();
  for (let i = 0; i < days; i++) {
    const date = addDaysKey(first, i);
    const p = (await getPrayerTimes(env, { ...profile, date })).timings;
    const sunrise = trInstant(date, p.Sunrise);
    const wake = addMinutes(sunrise, -Math.max(10, Math.min(45, Number(profile.wakeOffset) || 20)));
    const activityStart = addMinutes(sunrise, 2);
    out.push(safeEvent({ at: wake, title: 'Uyanma zamanı', body: `Güneşe ${Number(profile.wakeOffset) || 20} dk var. Sabah namazı için kalk.`, tag: `wake-${date}` }, 'profile'));
    out.push(safeEvent({ at: activityStart, title: 'Güneş doğdu', body: profile.activity === 'bike' ? `${Number(profile.activityMinutes) || 40} dk rahat bisiklet için uygun zaman.` : `${Number(profile.activityMinutes) || 30} dk rahat yürüyüş için uygun zaman.`, tag: `morning-${date}` }, 'profile'));
    for (const [k, n] of [['Dhuhr', 'Öğle'], ['Asr', 'İkindi'], ['Maghrib', 'Akşam'], ['Isha', 'Yatsı']]) {
      out.push(safeEvent({ at: addMinutes(trInstant(date, p[k]), -5), title: `${n} namazına 5 dk`, body: `${n} vakti ${cleanTime(p[k])}.`, tag: `prayer-${k}-${date}` }, 'profile'));
    }
  }
  return out.filter(e => Date.parse(e.at) > Date.now() - 60000);
}

async function upsertEvents(env, clientId, events, kind, replace = true) {
  if (replace) await env.DB.prepare('DELETE FROM events WHERE client_id=? AND kind=? AND sent=0').bind(clientId, kind).run();
  const now = Date.now(), max = now + 8 * 24 * 3600000;
  const clean = events.map(e => safeEvent(e, kind)).filter(e => Date.parse(e.at) > now - 60000 && Date.parse(e.at) < max).slice(0, 80);
  if (!clean.length) return 0;
  const stmts = clean.map(e => env.DB.prepare('INSERT OR IGNORE INTO events(client_id,at,title,body,tag,kind,sent) VALUES(?,?,?,?,?,?,0)').bind(clientId, e.at, e.title, e.body, e.tag, kind));
  await env.DB.batch(stmts);
  return clean.length;
}

function cleanProfile(profile = {}) {
  return {
    district: String(profile.district || 'Etimesgut').slice(0, 80),
    city: String(profile.city || 'Ankara').slice(0, 80),
    country: 'TR',
    wakeOffset: Math.max(10, Math.min(45, Number(profile.wakeOffset) || 20)),
    activity: profile.activity === 'bike' ? 'bike' : 'walk',
    activityMinutes: Math.max(10, Math.min(120, Number(profile.activityMinutes) || 30))
  };
}

async function saveClient(env, subscription, profile = null) {
  const id = await hashId(subscription.endpoint);
  const p256dh = subscription.keys?.p256dh, auth = subscription.keys?.auth;
  if (!p256dh || !auth) throw new Error('Push anahtarları eksik');
  await env.DB.prepare('INSERT INTO clients(id,endpoint,p256dh,auth,profile,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,profile=COALESCE(excluded.profile,clients.profile),updated_at=excluded.updated_at')
    .bind(id, subscription.endpoint, p256dh, auth, profile ? JSON.stringify(profile) : null, new Date().toISOString()).run();
  return id;
}

async function tick(env) {
  const now = new Date();
  const low = new Date(now.getTime() - 5 * 60000).toISOString();
  const high = now.toISOString();
  const { results = [] } = await env.DB.prepare('SELECT e.id,e.client_id,e.title,e.body,e.tag,c.endpoint,c.p256dh,c.auth FROM events e JOIN clients c ON c.id=e.client_id WHERE e.sent=0 AND e.at<=? AND e.at>=? ORDER BY e.at LIMIT 100').bind(high, low).all();
  for (const e of results) {
    const sub = { endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } };
    try {
      const r = await sendPush(env, sub, { title: e.title, body: e.body, tag: e.tag });
      if (r.ok) await env.DB.prepare('UPDATE events SET sent=1 WHERE id=?').bind(e.id).run();
      else if (r.status === 404 || r.status === 410) {
        await env.DB.batch([
          env.DB.prepare('DELETE FROM events WHERE client_id=?').bind(e.client_id),
          env.DB.prepare('DELETE FROM clients WHERE id=?').bind(e.client_id)
        ]);
      }
    } catch (err) { console.log('push error', e.id, String(err)); }
  }
}

async function refreshHorizons(env) {
  const today = trDateKey();
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k='horizon_day'").first();
  if (row?.v === today) return;
  const { results = [] } = await env.DB.prepare('SELECT id,profile FROM clients WHERE profile IS NOT NULL').all();
  for (const c of results) {
    try { await upsertEvents(env, c.id, await buildProfileEvents(env, JSON.parse(c.profile), 8), 'profile', true); }
    catch (e) { console.log('horizon error', c.id, String(e)); }
  }
  await env.DB.prepare("INSERT OR REPLACE INTO settings(k,v) VALUES('horizon_day',?)").bind(today).run();
}

async function api(request, env) {
  await ensureDb(env);
  const u = new URL(request.url);

  const reminderResponse = await handleReminderApi(request, env);
  if (reminderResponse) return reminderResponse;

  if (request.method === 'GET' && u.pathname === '/api/health') return j({ ok: true, runtime: 'cloudflare-worker', time: new Date().toISOString() });
  if (request.method === 'GET' && u.pathname === '/api/vapid-public-key') return j({ publicKey: (await ensureVapid(env)).publicKey });
  if (request.method === 'GET' && u.pathname === '/api/prayer-times') {
    try {
      return j(await getPrayerTimes(env, { district: String(u.searchParams.get('district') || 'Etimesgut').slice(0, 80), city: String(u.searchParams.get('city') || 'Ankara').slice(0, 80), country: String(u.searchParams.get('country') || 'TR').slice(0, 4), date: String(u.searchParams.get('date') || trDateKey()) }));
    } catch (e) { return j({ error: 'Vakit verisi alınamadı', detail: String(e.message || e) }, 502); }
  }

  if (request.method === 'POST' && u.pathname === '/api/profile') {
    const body = await request.json().catch(() => ({}));
    if (!body.subscription?.endpoint || !body.profile) return j({ error: 'Eksik veri' }, 400);
    const profile = cleanProfile(body.profile);
    const id = await saveClient(env, body.subscription, profile);
    const count = await upsertEvents(env, id, await buildProfileEvents(env, profile, 8), 'profile', true);
    return j({ ok: true, count });
  }

  if (request.method === 'POST' && u.pathname === '/api/schedule') {
    const body = await request.json().catch(() => ({}));
    if (!body.subscription?.endpoint || !Array.isArray(body.events)) return j({ error: 'Eksik veri' }, 400);
    if (body.events.length > 40) return j({ error: 'Çok fazla olay' }, 400);
    const id = await saveClient(env, body.subscription);
    const kind = body.kind === 'activity' ? 'activity' : 'manual';
    const count = await upsertEvents(env, id, body.events, kind, !body.append);
    return j({ ok: true, count });
  }

  if (request.method === 'POST' && u.pathname === '/api/test-push') {
    const body = await request.json().catch(() => ({}));
    if (!body.subscription?.endpoint) return j({ error: 'Abonelik gerekli' }, 400);
    try {
      const r = await sendPush(env, body.subscription, { title: 'Vakit', body: String(body.message || 'Test bildirimi'), tag: 'test' });
      return r.ok ? j({ ok: true, sent: 1 }) : j({ ok: false, error: `Push servisi ${r.status}` }, 502);
    } catch (e) { return j({ ok: false, error: 'Push gönderilemedi', detail: String(e.message || e) }, 502); }
  }

  return j({ error: 'Bulunamadı' }, 404);
}

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname.startsWith('/api/')) {
      try { return await api(request, env); }
      catch (e) { return j({ error: 'Sunucu hatası', detail: String(e.message || e) }, 500); }
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      await ensureDb(env);
      await refreshHorizons(env);
      await tick(env);
      await tickReminders(env, sendPush);
    })());
  }
};