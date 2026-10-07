/**
 * THE STARTUP KITCHEN BY PISTA HOUSE: request and booking backend (Google Apps Script)
 *
 * Free replacement for the Render server. Every request from the website is saved
 * as a row in the "Requests" tab of this Google Sheet, and the team planner
 * (planner.html) reads and updates the same rows.
 *
 * Set up once (full steps in SETUP.md):
 *   1. Open the Google Sheet > Extensions > Apps Script. Paste this whole file. Save.
 *   2. Choose "setup" in the function list at the top and click Run. Allow access.
 *      This creates the "Requests" and "Settings" tabs.
 *   3. In the Sheet, open the "Settings" tab and type the team PIN in cell B2.
 *   4. Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone > Deploy.
 *   5. Copy the Web app URL into assets/config.js (API_URL) on GitHub.
 * After editing this file later: Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy.
 */

var SHEET = 'Requests';
var SETTINGS = 'Settings';
var KITCHEN_PHONE = '+91 91333 08097';
var SLOTS = { s1: 'Morning, 7:00 to 11:00', s2: 'Midday, 11:30 to 3:30', s3: 'Evening, 4:00 to 8:00' };
var STATUSES = ['New', 'Contacted', 'Confirmed', 'Done', 'Declined', 'Cancelled', 'No show'];
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

var COLS = ['id', 'created', 'status', 'name', 'phone', 'email', 'city', 'dish', 'category', 'prefDate', 'prefSlot',
  'help', 'equipment', 'notes', 'date', 'slot', 'mentor', 'teamNotes', 'source', 'updated'];
var HEADERS = ['Request ID', 'Received', 'Status', 'Name', 'Phone', 'Email', 'City', 'Dish', 'Category', 'Preferred date',
  'Preferred slot', 'Help wanted', 'Equipment', 'Founder notes', 'Confirmed date', 'Confirmed slot', 'Mentor',
  'Team notes', 'Source', 'Last updated'];
var EDITABLE = ['status', 'date', 'slot', 'mentor', 'teamNotes', 'name', 'phone', 'email', 'city', 'dish', 'category', 'notes'];

/* ---------- entry points ---------- */

function setup() {
  sheet_();
  settings_();
  Logger.log('Setup done. Now type the team PIN in Settings!B2, then Deploy > New deployment > Web app.');
}

function doGet() {
  return out_({ ok: true, service: 'The Startup Kitchen planner' });
}

function doPost(e) {
  var p;
  try { p = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, error: 'bad_request' }); }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return out_({ ok: false, error: 'busy' }); }
  try {
    if (p.action === 'availability') return out_(availability_(p));
    if (p.action === 'request') return out_(newRequest_(p));
    if (!pinOk_(p.pin)) return out_({ ok: false, error: 'pin' });
    if (p.action === 'list') return out_(list_());
    if (p.action === 'update') return out_(update_(p));
    if (p.action === 'add') return out_(add_(p));
    return out_({ ok: false, error: 'unknown' });
  } catch (err) {
    console.error(p && p.action, err && err.message);
    return out_({ ok: false, error: 'server' });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- actions ---------- */

function availability_(p) {
  var from = DATE_RE.test(p.from || '') ? p.from : '0000-01-01';
  var to = DATE_RE.test(p.to || '') ? p.to : '9999-12-31';
  var booked = rows_().filter(function (r) {
    return r.status === 'Confirmed' && r.date >= from && r.date <= to;
  }).map(function (r) { return { date: r.date, slot: r.slot }; });
  return { ok: true, booked: booked };
}

function newRequest_(p) {
  if (p.website) return { ok: true, id: 'SK-0' }; // honeypot: bots fill this hidden field
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('req_count') || 0);
  if (n > 60) return { ok: false, error: 'busy' }; // more than 60 requests in 10 minutes: likely spam
  cache.put('req_count', String(n + 1), 600);

  var name = clean_(p.name, 120), phone = clean_(p.phone, 30);
  if (!name || digits_(phone).length < 10 || !DATE_RE.test(p.prefDate || '') || !SLOTS[p.prefSlot]) {
    return { ok: false, error: 'invalid' };
  }
  var now = new Date().toISOString();
  var rec = {
    id: nextId_(), created: now, status: 'New', name: name, phone: phone, email: clean_(p.email, 120),
    city: clean_(p.city, 80), dish: clean_(p.dish, 160), category: clean_(p.category, 40),
    prefDate: p.prefDate, prefSlot: p.prefSlot, help: clean_(p.help, 300), equipment: clean_(p.equipment, 600),
    notes: clean_(p.notes, 1500), date: '', slot: '', mentor: '', teamNotes: '', source: 'Website', updated: now
  };
  write_(rec);
  notifyTeam_(rec);
  return { ok: true, id: rec.id };
}

function list_() {
  var items = rows_().map(strip_);
  items.sort(function (a, b) { return a.created < b.created ? 1 : a.created > b.created ? -1 : 0; });
  return { ok: true, items: items.slice(0, 2000) };
}

function update_(p) {
  var all = rows_();
  var rec = null;
  for (var i = 0; i < all.length; i++) if (all[i].id === String(p.id || '')) rec = all[i];
  if (!rec) return { ok: false, error: 'not_found' };
  var f = p.fields || {};
  EDITABLE.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(f, k)) rec[k] = clean_(f[k], k === 'teamNotes' || k === 'notes' ? 1500 : 200);
  });
  if (STATUSES.indexOf(rec.status) < 0) return { ok: false, error: 'invalid' };
  if (rec.status === 'Confirmed') {
    if (!DATE_RE.test(rec.date) || !SLOTS[rec.slot]) return { ok: false, error: 'invalid' };
    if (!p.force && clash_(all, rec)) return { ok: false, error: 'taken' };
  }
  rec.updated = new Date().toISOString();
  write_(rec);
  var emailed = false;
  if (p.sendEmail && rec.status === 'Confirmed' && rec.email) {
    try { sendConfirmation_(rec); emailed = true; } catch (err) { console.error('email', err && err.message); }
  }
  return { ok: true, item: strip_(rec), emailed: emailed };
}

function add_(p) {
  var f = p.fields || {};
  var name = clean_(f.name, 120), phone = clean_(f.phone, 30);
  if (!name || digits_(phone).length < 10) return { ok: false, error: 'invalid' };
  if (!DATE_RE.test(f.date || '') || !SLOTS[f.slot]) return { ok: false, error: 'invalid' };
  var status = f.status === 'Confirmed' ? 'Confirmed' : 'New';
  var now = new Date().toISOString();
  var rec = {
    id: '', created: now, status: status, name: name, phone: phone, email: clean_(f.email, 120),
    city: clean_(f.city, 80), dish: clean_(f.dish, 160), category: clean_(f.category, 40),
    prefDate: f.date, prefSlot: f.slot, help: '', equipment: '', notes: clean_(f.notes, 1500),
    date: status === 'Confirmed' ? f.date : '', slot: status === 'Confirmed' ? f.slot : '',
    mentor: clean_(f.mentor, 80), teamNotes: clean_(f.teamNotes, 1500), source: clean_(f.source || 'Phone', 40), updated: now
  };
  if (status === 'Confirmed' && !p.force && clash_(rows_(), rec)) return { ok: false, error: 'taken' };
  rec.id = nextId_();
  write_(rec);
  return { ok: true, item: strip_(rec) };
}

/* ---------- email ---------- */

function sendConfirmation_(r) {
  var d = parseDate_(r.date);
  var when = d ? Utilities.formatDate(d, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy') : r.date;
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#3b2a1a;max-width:560px">' +
    '<p>Dear ' + esc_(r.name) + ',</p>' +
    '<p>Your kitchen slot at <b>The Startup Kitchen by Pista House</b> is confirmed.</p>' +
    '<p><b>Date:</b> ' + esc_(when) + '<br><b>Slot:</b> ' + esc_(SLOTS[r.slot] || '') +
    (r.mentor ? '<br><b>Your mentor:</b> ' + esc_(r.mentor) : '') + '</p>' +
    '<p>Please bring your recipe and raw material. For any help, call or WhatsApp us on <b>' + KITCHEN_PHONE + '</b>.</p>' +
    '<p>From Home Recipe to Food Startup<br><b>Team The Startup Kitchen</b></p></div>';
  var opts = { to: r.email, subject: 'Confirmed: your Startup Kitchen slot on ' + when, htmlBody: html, name: 'The Startup Kitchen by Pista House' };
  var team = setting_('B3');
  if (team) opts.replyTo = team;
  MailApp.sendEmail(opts);
}

function notifyTeam_(r) {
  var team = setting_('B3');
  if (!team) return;
  try {
    MailApp.sendEmail({
      to: team, name: 'The Startup Kitchen website',
      subject: 'New kitchen request ' + r.id + ': ' + r.name + (r.dish ? ' (' + r.dish + ')' : ''),
      htmlBody: '<p><b>' + esc_(r.name) + '</b>, ' + esc_(r.phone) + (r.city ? ', ' + esc_(r.city) : '') + '</p>' +
        '<p>Dish: ' + esc_(r.dish) + ' (' + esc_(r.category) + ')<br>Preferred: ' + esc_(r.prefDate) + ', ' + esc_(SLOTS[r.prefSlot] || '') + '</p>' +
        (r.notes ? '<p>Notes: ' + esc_(r.notes) + '</p>' : '') +
        '<p><a href="https://startupkitchenbypistahouse.com/planner.html">Open the planner</a></p>'
    });
  } catch (err) { /* never block a request because of email */ }
}

/* ---------- sheet helpers ---------- */

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET, 0);
    sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold').setBackground('#F4E6BE');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, COLS.length).setNumberFormat('@');
  }
  return sh;
}

function settings_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SETTINGS);
  if (!sh) {
    sh = ss.insertSheet(SETTINGS);
    sh.getRange('A1:B3').setValues([
      ['Setting', 'Value'],
      ['Team PIN (for planner.html)', ''],
      ['Team email for new-request alerts (optional)', '']
    ]);
    sh.getRange('A1:B1').setFontWeight('bold').setBackground('#F4E6BE');
    sh.getRange('B2:B3').setNumberFormat('@');
    sh.setColumnWidth(1, 320);
    sh.setColumnWidth(2, 260);
  }
  return sh;
}

function setting_(cell) {
  return String(settings_().getRange(cell).getDisplayValue() || '').trim();
}

function pinOk_(pin) {
  var real = setting_('B2');
  if (!real) return false;
  var cache = CacheService.getScriptCache();
  var fails = Number(cache.get('pin_fails') || 0);
  if (fails >= 30) return false; // too many wrong PINs: wait 15 minutes
  if (String(pin || '') === real) return true;
  cache.put('pin_fails', String(fails + 1), 900);
  Utilities.sleep(800);
  return false;
}

function rows_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, COLS.length).getDisplayValues();
  var out = [];
  vals.forEach(function (row, i) {
    if (!row[0]) return;
    var o = { _row: i + 2 };
    COLS.forEach(function (c, j) { o[c] = row[j]; });
    out.push(o);
  });
  return out;
}

function write_(rec) {
  var sh = sheet_();
  var row = rec._row || sh.getLastRow() + 1;
  var vals = COLS.map(function (c) {
    var v = rec[c] == null ? '' : String(rec[c]);
    return /^[=+\-@]/.test(v) ? "'" + v : v; // stop formula injection
  });
  sh.getRange(row, 1, 1, COLS.length).setNumberFormat('@').setValues([vals]);
  rec._row = row;
}

function nextId_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('SEQ') || 0);
  if (!n) { // first run: continue after any IDs already in the sheet
    rows_().forEach(function (r) { var m = /^SK-(\d+)$/.exec(r.id); if (m) n = Math.max(n, Number(m[1]) - 1000); });
  }
  n += 1;
  props.setProperty('SEQ', String(n));
  return 'SK-' + (1000 + n);
}

function clash_(all, rec) {
  return all.some(function (o) {
    return o.id !== rec.id && o.status === 'Confirmed' && o.date === rec.date && o.slot === rec.slot;
  });
}

function strip_(r) {
  var c = {};
  COLS.forEach(function (k) { c[k] = r[k] == null ? '' : String(r[k]).replace(/^'/, ''); });
  return c;
}

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 200);
}
function digits_(v) { return String(v || '').replace(/\D/g, ''); }
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function parseDate_(s) {
  var m = DATE_RE.exec(String(s || '')) && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null;
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
