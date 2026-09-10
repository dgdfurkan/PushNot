const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' }
});

async function clientId(endpoint) {
  const bytes = new TextEncoder().encode(String(endpoint || ''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    return u.toString().slice(0, 1200);
  } catch {
    return '';
  }
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function readSubscription(body) {
  const sub = body?.subscription;
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return null;
  return {
    endpoint: String(sub.endpoint),
    keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }
  };
}

export async function ensureReminderDb(env) {
  if (!env.DB) throw new Error('Cloudflare D1 binding eksik: DB');
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      at TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      image_url TEXT,
      click_url TEXT,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(sent, at)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_reminders_client ON reminders(client_id, sent, at)')
  ]);
}

export async function handleReminderApi(request, env) {
  const u = new URL(request.url);
  if (!u.pathname.startsWith('/api/reminders/')) return null;
  await ensureReminderDb(env);

  if (request.method !== 'POST') return json({ error: 'Yalnızca POST desteklenir' }, 405);
  const body = await request.json().catch(() => ({}));
  const sub = readSubscription(body);
  if (!sub) return json({ error: 'Bildirim aboneliği gerekli' }, 400);
  const cid = await clientId(sub.endpoint);

  if (u.pathname === '/api/reminders/create') {
    const at = new Date(body.at);
    const now = Date.now();
    const max = now + 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(at.getTime()) || at.getTime() <= now + 15000) return json({ error: 'Hatırlatma zamanı gelecekte olmalı' }, 400);
    if (at.getTime() > max) return json({ error: 'Hatırlatma en fazla 1 yıl sonrasına planlanabilir' }, 400);

    const title = safeText(body.title, 80);
    const description = safeText(body.body, 180);
    if (!title) return json({ error: 'Başlık gerekli' }, 400);
    const imageUrl = safeUrl(body.image);
    const clickUrl = safeUrl(body.url);
    if (body.image && !imageUrl) return json({ error: 'Görsel bağlantısı geçerli bir http/https URL olmalı' }, 400);
    if (body.url && !clickUrl) return json({ error: 'Açılacak bağlantı geçerli bir http/https URL olmalı' }, 400);

    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO reminders
      (id,client_id,endpoint,p256dh,auth,at,title,body,image_url,click_url,sent,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`)
      .bind(id, cid, sub.endpoint, sub.keys.p256dh, sub.keys.auth, at.toISOString(), title, description, imageUrl || null, clickUrl || null, new Date().toISOString())
      .run();

    return json({ ok: true, id });
  }

  if (u.pathname === '/api/reminders/list') {
    const { results = [] } = await env.DB.prepare(`SELECT id,at,title,body,image_url AS image,click_url AS url
      FROM reminders WHERE client_id=? AND sent=0 AND at>? ORDER BY at ASC LIMIT 100`)
      .bind(cid, new Date(Date.now() - 60000).toISOString()).all();
    return json({ ok: true, reminders: results });
  }

  if (u.pathname === '/api/reminders/delete') {
    const id = safeText(body.id, 80);
    if (!id) return json({ error: 'Hatırlatma kimliği gerekli' }, 400);
    const result = await env.DB.prepare('DELETE FROM reminders WHERE id=? AND client_id=? AND sent=0').bind(id, cid).run();
    return json({ ok: true, deleted: Number(result?.meta?.changes || 0) });
  }

  return json({ error: 'Bulunamadı' }, 404);
}

export async function tickReminders(env, sendPush) {
  await ensureReminderDb(env);
  const now = new Date();
  const low = new Date(now.getTime() - 5 * 60000).toISOString();
  const high = now.toISOString();
  const { results = [] } = await env.DB.prepare(`SELECT id,client_id,endpoint,p256dh,auth,title,body,image_url,click_url
    FROM reminders WHERE sent=0 AND at<=? AND at>=? ORDER BY at ASC LIMIT 100`)
    .bind(high, low).all();

  for (const r of results) {
    const sub = { endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } };
    try {
      const response = await sendPush(env, sub, {
        title: r.title,
        body: r.body,
        tag: `reminder-${r.id}`,
        image: r.image_url || undefined,
        url: r.click_url || '/?view=reminders'
      });
      if (response.ok) {
        await env.DB.prepare('UPDATE reminders SET sent=1 WHERE id=?').bind(r.id).run();
      } else if (response.status === 404 || response.status === 410) {
        await env.DB.prepare('DELETE FROM reminders WHERE client_id=?').bind(r.client_id).run();
      }
    } catch (error) {
      console.log('reminder push error', r.id, String(error));
    }
  }
}
