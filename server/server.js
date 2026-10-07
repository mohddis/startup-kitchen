/*
 * The Startup Kitchen by Pista House - request and booking API
 * Hosted on Render. Data lives in Postgres (table sk_requests).
 *
 * Environment variables:
 *   DATABASE_URL   Postgres connection string (Render: database > Connect > Internal Database URL)
 *   TEAM_PIN       PIN the team uses to open planner.html
 *   ALLOWED_ORIGINS comma-separated list of website origins allowed to call this API (optional)
 */
'use strict';
const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 10000;
const TEAM_PIN = String(process.env.TEAM_PIN || '');
const ORIGINS = String(process.env.ALLOWED_ORIGINS || 'https://startupkitchenbypistahouse.com,https://www.startupkitchenbypistahouse.com,https://mohddis.github.io')
  .split(',').map(s => s.trim()).filter(Boolean);

const SLOTS = { s1: 'Morning, 7:00 to 11:00', s2: 'Midday, 11:30 to 3:30', s3: 'Evening, 4:00 to 8:00' };
const STATUSES = ['New', 'Contacted', 'Confirmed', 'Done', 'Declined', 'Cancelled', 'No show'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let pool = null;
let ready = null;
async function db() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('DATABASE_URL is not set'), { code: 'no_db' });
  if (!pool) {
    const url = process.env.DATABASE_URL;
    const internal = /@dpg-[^.]+-a(\/|:)/.test(url) && !/render\.com/.test(url);
    pool = new Pool({ connectionString: url, ssl: internal ? false : { rejectUnauthorized: false }, max: 5 });
  }
  if (!ready) ready = migrate().catch(e => { ready = null; throw e; });
  return ready.then(() => pool);
}
async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sk_requests (
    seq SERIAL PRIMARY KEY,
    id TEXT GENERATED ALWAYS AS ('SK-' || (1000 + seq)::text) STORED UNIQUE,
    created TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'New',
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', city TEXT DEFAULT '',
    dish TEXT DEFAULT '', category TEXT DEFAULT '',
    pref_date TEXT DEFAULT '', pref_slot TEXT DEFAULT '',
    help TEXT DEFAULT '', equipment TEXT DEFAULT '', notes TEXT DEFAULT '',
    date TEXT DEFAULT '', slot TEXT DEFAULT '', mentor TEXT DEFAULT '', team_notes TEXT DEFAULT '',
    source TEXT DEFAULT 'Website',
    updated TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS sk_requests_booked ON sk_requests (date, slot) WHERE status = 'Confirmed'`);
}

/* ---------- helpers ---------- */
function clean(v, max) {
  return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 200);
}
function digits(v) { return String(v || '').replace(/\D/g, ''); }
function toItem(r) {
  return {
    id: r.id, created: new Date(r.created).toISOString(), status: r.status, name: r.name, phone: r.phone,
    email: r.email, city: r.city, dish: r.dish, category: r.category, prefDate: r.pref_date, prefSlot: r.pref_slot,
    help: r.help, equipment: r.equipment, notes: r.notes, date: r.date, slot: r.slot, mentor: r.mentor,
    teamNotes: r.team_notes, source: r.source, updated: new Date(r.updated).toISOString()
  };
}
const FIELD_COLS = { status: 'status', date: 'date', slot: 'slot', mentor: 'mentor', teamNotes: 'team_notes', name: 'name',
  phone: 'phone', email: 'email', city: 'city', dish: 'dish', category: 'category', notes: 'notes' };

/* simple in-memory rate limits */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 3600000) hits.delete(k);
  return arr.length > max;
}
function pinOk(pin, ip) {
  if (!TEAM_PIN) return false;
  if (limited('pin:' + ip, 20, 15 * 60000) && String(pin || '') !== TEAM_PIN) return false;
  return String(pin || '') === TEAM_PIN;
}

/* ---------- actions ---------- */
async function availability(p) {
  const from = DATE_RE.test(p.from || '') ? p.from : '0000-01-01';
  const to = DATE_RE.test(p.to || '') ? p.to : '9999-12-31';
  const { rows } = await (await db()).query(
    `SELECT date, slot FROM sk_requests WHERE status = 'Confirmed' AND date >= $1 AND date <= $2`, [from, to]);
  return { ok: true, booked: rows };
}

async function newRequest(p, ip) {
  if (p.website) return { ok: true, id: 'SK-0' }; // honeypot
  if (limited('req:' + ip, 8, 60 * 60000)) return { ok: false, error: 'busy' };
  const name = clean(p.name, 120), phone = clean(p.phone, 30);
  if (!name || digits(phone).length < 10 || !DATE_RE.test(p.prefDate || '') || !SLOTS[p.prefSlot]) return { ok: false, error: 'invalid' };
  const pg = await db();
  const { rows } = await pg.query(
    `INSERT INTO sk_requests (name, phone, email, city, dish, category, pref_date, pref_slot, help, equipment, notes, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'Website') RETURNING id`,
    [name, phone, clean(p.email, 120), clean(p.city, 80), clean(p.dish, 160), clean(p.category, 40), p.prefDate, p.prefSlot,
     clean(p.help, 300), clean(p.equipment, 600), clean(p.notes, 1500)]);
  return { ok: true, id: rows[0].id };
}

async function list() {
  const { rows } = await (await db()).query(`SELECT * FROM sk_requests ORDER BY seq DESC LIMIT 2000`);
  return { ok: true, items: rows.map(toItem) };
}

async function update(p) {
  const f = p.fields || {};
  const client = await (await db()).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4242)');
    const cur = await client.query('SELECT * FROM sk_requests WHERE id = $1 FOR UPDATE', [String(p.id || '')]);
    if (!cur.rows.length) { await client.query('ROLLBACK'); return { ok: false, error: 'not_found' }; }
    const rec = toItem(cur.rows[0]);
    for (const k of Object.keys(FIELD_COLS)) if (Object.prototype.hasOwnProperty.call(f, k)) rec[k] = clean(f[k], k === 'teamNotes' || k === 'notes' ? 1500 : 200);
    if (!STATUSES.includes(rec.status)) { await client.query('ROLLBACK'); return { ok: false, error: 'invalid' }; }
    if (rec.status === 'Confirmed') {
      if (!DATE_RE.test(rec.date) || !SLOTS[rec.slot]) { await client.query('ROLLBACK'); return { ok: false, error: 'invalid' }; }
      if (!p.force) {
        const c = await client.query(`SELECT 1 FROM sk_requests WHERE status='Confirmed' AND date=$1 AND slot=$2 AND id<>$3 LIMIT 1`, [rec.date, rec.slot, rec.id]);
        if (c.rows.length) { await client.query('ROLLBACK'); return { ok: false, error: 'taken' }; }
      }
    }
    const { rows } = await client.query(
      `UPDATE sk_requests SET status=$2, date=$3, slot=$4, mentor=$5, team_notes=$6, name=$7, phone=$8, email=$9, city=$10,
       dish=$11, category=$12, notes=$13, updated=now() WHERE id=$1 RETURNING *`,
      [rec.id, rec.status, rec.date, rec.slot, rec.mentor, rec.teamNotes, rec.name, rec.phone, rec.email, rec.city, rec.dish, rec.category, rec.notes]);
    await client.query('COMMIT');
    return { ok: true, item: toItem(rows[0]), emailed: false };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

async function add(p) {
  const f = p.fields || {};
  const name = clean(f.name, 120), phone = clean(f.phone, 30);
  if (!name || digits(phone).length < 10) return { ok: false, error: 'invalid' };
  const status = f.status === 'Confirmed' ? 'Confirmed' : 'New';
  if (!DATE_RE.test(f.date || '') || !SLOTS[f.slot]) return { ok: false, error: 'invalid' };
  const client = await (await db()).connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(4242)');
    if (status === 'Confirmed' && !p.force) {
      const c = await client.query(`SELECT 1 FROM sk_requests WHERE status='Confirmed' AND date=$1 AND slot=$2 LIMIT 1`, [f.date, f.slot]);
      if (c.rows.length) { await client.query('ROLLBACK'); return { ok: false, error: 'taken' }; }
    }
    const ins = await client.query(
      `INSERT INTO sk_requests (status, name, phone, email, city, dish, category, pref_date, pref_slot, notes, date, slot, mentor, team_notes, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [status, name, phone, clean(f.email, 120), clean(f.city, 80), clean(f.dish, 160), clean(f.category, 40), f.date, f.slot,
       clean(f.notes, 1500), status === 'Confirmed' ? f.date : '', status === 'Confirmed' ? f.slot : '', clean(f.mentor, 80),
       clean(f.teamNotes, 1500), clean(f.source || 'Phone', 40)]);
    await client.query('COMMIT');
    return { ok: true, item: toItem(ins.rows[0]) };
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
  finally { client.release(); }
}

/* ---------- http ---------- */
function send(res, status, obj, origin) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
  if (origin && (ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  res.writeHead(status, headers);
  res.end(obj === null ? '' : JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '';
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (req.method === 'OPTIONS') return send(res, 204, null, origin);
  if (req.method === 'GET') {
    if (req.url === '/health') return db().then(() => send(res, 200, { ok: true, db: true }, origin)).catch(e => send(res, 200, { ok: true, db: false, error: e.code || 'db' }, origin));
    return send(res, 200, { ok: true, service: 'The Startup Kitchen planner' }, origin);
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'method' }, origin);
  let body = '';
  req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', async () => {
    let p;
    try { p = JSON.parse(body || '{}'); } catch (e) { return send(res, 400, { ok: false, error: 'bad_request' }, origin); }
    try {
      let out;
      if (p.action === 'availability') out = await availability(p);
      else if (p.action === 'request') out = await newRequest(p, ip);
      else if (!pinOk(p.pin, ip)) out = { ok: false, error: 'pin' };
      else if (p.action === 'list') out = await list();
      else if (p.action === 'update') out = await update(p);
      else if (p.action === 'add') out = await add(p);
      else out = { ok: false, error: 'unknown' };
      send(res, 200, out, origin);
    } catch (e) {
      console.error(p && p.action, e.code || '', e.message);
      send(res, 200, { ok: false, error: e.code === 'no_db' ? 'no_db' : 'server' }, origin);
    }
  });
});
server.listen(PORT, () => console.log('Startup Kitchen planner API on port ' + PORT));
