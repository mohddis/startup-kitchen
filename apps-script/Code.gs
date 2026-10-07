/**
 * The Startup Kitchen by Pista House - kitchen planner backend
 * Google Sheet: "Startup Kitchen Requests"
 *
 * Script properties (Project Settings > Script Properties):
 *   TEAM_PIN    PIN your team uses to open planner.html
 *   TEAM_EMAIL  email that gets an alert for every new request (optional)
 *
 * After editing: Deploy > Manage deployments > Edit > Version: New version > Deploy
 */

var SHEET_NAME = 'Requests';
var HEAD = ['id','created','status','name','phone','email','city','dish','category',
            'prefDate','prefSlot','help','equipment','notes',
            'date','slot','mentor','teamNotes','source','updated'];
var SLOT_NAMES = { s1: 'Morning, 7:00 to 11:00', s2: 'Midday, 11:30 to 3:30', s3: 'Evening, 4:00 to 8:00' };
var STATUSES = ['New','Contacted','Confirmed','Done','Declined','Cancelled','No show'];
var TEAM_FIELDS = ['status','date','slot','mentor','teamNotes','name','phone','email','city','dish','category','notes'];

/* ---------- setup: run once from the editor ---------- */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  sh.getRange(1, 1, sh.getMaxRows(), HEAD.length).setNumberFormat('@');
  sh.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#F4E6BE');
  sh.setFrozenRows(1);
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEAM_PIN')) Logger.log('Add a TEAM_PIN in Project Settings > Script Properties.');
  if (props.getProperty('TEAM_EMAIL')) MailApp.getRemainingDailyQuota();
  Logger.log('Setup complete');
}

/* ---------- web app ---------- */
function doGet() {
  return ContentService.createTextOutput('The Startup Kitchen planner is running.');
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e.postData.contents || '{}'); } catch (err) { return out({ ok: false, error: 'bad_request' }); }
  try {
    switch (p.action) {
      case 'availability': return out(availability(p));
      case 'request':      return out(newRequest(p));
    }
    if (!pinOk(p.pin)) return out({ ok: false, error: 'pin' });
    switch (p.action) {
      case 'list':   return out(list());
      case 'update': return out(update(p));
      case 'add':    return out(add(p));
    }
    return out({ ok: false, error: 'unknown' });
  } catch (err) {
    return out({ ok: false, error: 'server', message: String(err) });
  }
}

/* ---------- public ---------- */
function availability(p) {
  var rows = readAll();
  var booked = rows.filter(function (r) {
    return r.status === 'Confirmed' && r.date && r.date >= (p.from || '') && r.date <= (p.to || '9999');
  }).map(function (r) { return { date: r.date, slot: r.slot }; });
  return { ok: true, booked: booked };
}

function newRequest(p) {
  var name = clean(p.name, 120), phone = clean(p.phone, 30);
  if (!name || phone.replace(/\D/g, '').length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(p.prefDate || '') || !SLOT_NAMES[p.prefSlot]) {
    return { ok: false, error: 'invalid' };
  }
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet();
    var id = nextId(sh);
    var now = new Date().toISOString();
    var rec = {
      id: id, created: now, status: 'New', name: name, phone: phone,
      email: clean(p.email, 120), city: clean(p.city, 80), dish: clean(p.dish, 160), category: clean(p.category, 40),
      prefDate: p.prefDate, prefSlot: p.prefSlot, help: clean(p.help, 300), equipment: clean(p.equipment, 600),
      notes: clean(p.notes, 1500), date: '', slot: '', mentor: '', teamNotes: '', source: 'Website', updated: now
    };
    sh.appendRow(HEAD.map(function (h) { return rec[h]; }));
  } finally { lock.releaseLock(); }
  alertTeam(rec);
  return { ok: true, id: id };
}

/* ---------- team ---------- */
function list() {
  return { ok: true, items: readAll().reverse() };
}

function update(p) {
  var f = p.fields || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet(), data = sh.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 1; i < data.length; i++) if (String(data[i][0]) === String(p.id)) { rowIdx = i; break; }
    if (rowIdx < 0) return { ok: false, error: 'not_found' };
    var rec = toObj(data[rowIdx]);
    var wasConfirmed = rec.status === 'Confirmed' && rec.date;
    TEAM_FIELDS.forEach(function (k) { if (f.hasOwnProperty(k)) rec[k] = clean(f[k], k === 'teamNotes' || k === 'notes' ? 1500 : 200); });
    if (STATUSES.indexOf(rec.status) < 0) return { ok: false, error: 'invalid' };
    if (rec.status === 'Confirmed') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date) || !SLOT_NAMES[rec.slot]) return { ok: false, error: 'invalid' };
      if (!p.force && clash(data, rec)) return { ok: false, error: 'taken' };
    }
    rec.updated = new Date().toISOString();
    sh.getRange(rowIdx + 1, 1, 1, HEAD.length).setValues([HEAD.map(function (h) { return rec[h]; })]);
  } finally { lock.releaseLock(); }
  if (rec.status === 'Confirmed' && p.sendEmail && rec.email) confirmEmail(rec);
  return { ok: true, item: rec, emailed: !!(rec.status === 'Confirmed' && p.sendEmail && rec.email), changed: !wasConfirmed };
}

function add(p) {
  var f = p.fields || {};
  if (!clean(f.name) || String(f.phone || '').replace(/\D/g, '').length < 10) return { ok: false, error: 'invalid' };
  var status = f.status === 'Confirmed' ? 'Confirmed' : 'New';
  if (status === 'Confirmed' && (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || '') || !SLOT_NAMES[f.slot])) return { ok: false, error: 'invalid' };
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = sheet(), data = sh.getDataRange().getValues();
    var now = new Date().toISOString();
    var rec = {
      id: nextId(sh), created: now, status: status, name: clean(f.name, 120), phone: clean(f.phone, 30),
      email: clean(f.email, 120), city: clean(f.city, 80), dish: clean(f.dish, 160), category: clean(f.category, 40),
      prefDate: f.date || '', prefSlot: f.slot || '', help: clean(f.help, 300), equipment: clean(f.equipment, 600),
      notes: clean(f.notes, 1500), date: status === 'Confirmed' ? f.date : '', slot: status === 'Confirmed' ? f.slot : '',
      mentor: clean(f.mentor, 80), teamNotes: clean(f.teamNotes, 1500), source: clean(f.source || 'Phone', 40), updated: now
    };
    if (status === 'Confirmed' && !p.force && clash(data, rec)) return { ok: false, error: 'taken' };
    sh.appendRow(HEAD.map(function (h) { return rec[h]; }));
  } finally { lock.releaseLock(); }
  return { ok: true, item: rec };
}

/* ---------- helpers ---------- */
function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) { setup(); sh = ss.getSheetByName(SHEET_NAME); }
  return sh;
}
function readAll() {
  var data = sheet().getDataRange().getValues();
  var outRows = [];
  for (var i = 1; i < data.length; i++) if (data[i][0]) outRows.push(toObj(data[i]));
  return outRows;
}
function toObj(row) {
  var o = {}, tz = Session.getScriptTimeZone();
  HEAD.forEach(function (h, i) {
    var v = row[i];
    if (v instanceof Date) v = (h === 'created' || h === 'updated') ? v.toISOString() : Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    o[h] = v === null || v === undefined ? '' : String(v);
  });
  return o;
}
function nextId(sh) {
  var last = sh.getLastRow(), max = 1000;
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
    var n = parseInt(String(r[0]).replace(/\D/g, ''), 10); if (n > max) max = n;
  });
  return 'SK-' + (max + 1);
}
function clash(data, rec) {
  for (var i = 1; i < data.length; i++) {
    var o = toObj(data[i]);
    if (o.id !== rec.id && o.status === 'Confirmed' && o.date === rec.date && o.slot === rec.slot) return true;
  }
  return false;
}
function clean(v, max) {
  v = String(v === undefined || v === null ? '' : v).trim().slice(0, max || 200);
  if (/^[=@]/.test(v)) v = "'" + v;
  return v;
}
function pinOk(pin) {
  var real = PropertiesService.getScriptProperties().getProperty('TEAM_PIN');
  return !!real && String(pin || '') === real;
}
function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function niceDate(d) {
  var p = d.split('-'); var dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return Utilities.formatDate(dt, Session.getScriptTimeZone(), 'EEEE, d MMMM yyyy');
}
function alertTeam(r) {
  var to = PropertiesService.getScriptProperties().getProperty('TEAM_EMAIL');
  if (!to) return;
  try {
    MailApp.sendEmail(to, 'New kitchen request ' + r.id + ': ' + r.name,
      'A new request came in from the website.\n\n' +
      'Request: ' + r.id + '\nName: ' + r.name + '\nPhone: ' + r.phone + (r.email ? '\nEmail: ' + r.email : '') +
      (r.city ? '\nCity: ' + r.city : '') + '\nDish: ' + (r.dish || '-') + ' (' + r.category + ')' +
      '\nPreferred: ' + niceDate(r.prefDate) + ', ' + SLOT_NAMES[r.prefSlot] +
      (r.help ? '\nHelp needed: ' + r.help : '') + (r.notes ? '\nAbout the product: ' + r.notes : '') +
      '\n\nOpen the planner to call and confirm: https://startupkitchenbypistahouse.com/planner.html');
  } catch (err) {}
}
function confirmEmail(r) {
  try {
    MailApp.sendEmail(r.email, 'Your kitchen slot is confirmed: ' + niceDate(r.date),
      'Hello ' + r.name + ',\n\nYour slot at The Startup Kitchen by Pista House is confirmed.\n\n' +
      'Booking: ' + r.id + '\nDate: ' + niceDate(r.date) + '\nSlot: ' + SLOT_NAMES[r.slot] +
      (r.mentor ? '\nYour mentor: ' + r.mentor : '') +
      '\n\nPlease arrive 15 minutes early for the hygiene briefing, and bring your raw material and written recipe.' +
      '\n\nQuestions? Call or WhatsApp +91 91333 08097.\n\nThe Startup Kitchen by Pista House\nstartupkitchenbypistahouse.com',
      { name: 'The Startup Kitchen by Pista House' });
  } catch (err) {}
}
