/**
 * DigitalX Leave Planner — Unified Server
 * ─────────────────────────────────────────────────────
 * Combines the Anthropic/OpenAI AI proxy with a simple
 * leave data API. Uses a local JSON file as the database.
 *
 * API Routes:
 *   GET    /health                      → health check
 *   POST   /api/chat                    → AI proxy (OpenAI)
 *   GET    /api/leaves                  → get all leaves (manager)
 *   POST   /api/leaves/submit           → submit leaves (team member)
 *   PUT    /api/leaves/:id/status       → approve/reject (manager)
 *   DELETE /api/leaves/:id              → delete leave (manager)
 *   GET    /api/members                 → get all members
 *   PUT    /api/members/:id/entitlement → update entitlement
 *
 * Setup:
 *   1. npm install
 *   2. cp .env.example .env  →  fill in OPENAI_API_KEY
 *   3. node server.js
 */

require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const fs        = require('fs');
const nodemailer = require('nodemailer');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3001;
const DB_PATH = path.join(__dirname, 'leaves-db.json');

/* ── SMTP Transporter ──
   Supports any SMTP — Office 365, Gmail, or your corporate mail.
   Fill SMTP_* vars in .env to enable automated email notifications.
*/
let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls:    { rejectUnauthorized: false }
  });
  console.log('✅  SMTP configured — automated email enabled');
} else {
  console.log('ℹ️   SMTP not configured — set SMTP_* in .env to enable auto email');
}

/* ── Validate on startup ── */
if (!process.env.OPENAI_API_KEY) {
  console.error('❌  OPENAI_API_KEY missing in .env file');
  process.exit(1);
}

/* ── Middleware ── */
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '50kb' }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

/* ── Rate limiting for AI only ── */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: 'Too many AI requests, slow down.' }
});

/* ════════════════════════════════════════════════════
   DATABASE HELPERS
   Simple JSON file — fast enough for 7-20 members
════════════════════════════════════════════════════ */
const DEFAULT_DB = {
  members: [
    {id:'m1',name:'Susmitha Elizabeth Jacob', email:'Susmitha.Jacob@dewa.gov.ae',  entitlement:30},
    {id:'m2',name:'Venkata Siva Modem',        email:'Venkata.Siva@dewa.gov.ae',    entitlement:30},
    {id:'m3',name:'Sukanta Kumar Sasmal',       email:'sukanta.kumar@dewa.gov.ae',   entitlement:30},
    {id:'m4',name:'Rakesh Roshan Sahoo',        email:'rakesh.roshan@dewa.gov.ae',   entitlement:30},
    {id:'m5',name:'Kurnika Choudhary',          email:'kurnika.choudhary@dewa.gov.ae',entitlement:30},
    {id:'m6',name:'Abdulmuhsin Panakkal',       email:'abdulmuhsin.panakkal@dewa.gov.ae',entitlement:30},
    {id:'m7',name:'Deepak Rajan',              email:'deepak.rajan@dewa.gov.ae',    entitlement:30},
    {id:'m8',name:'Narayan Das',                email:'Narayan.das@dewa.gov.ae',      entitlement:30},
    {id:'m9',name:'Vishal Chauhan',             email:'Vishal.chauhan@dewa.gov.ae',    entitlement:30},
    {id:'m10',name:'Bixamaiah Bussa',           email:'bixamaiah.bussa@morohub.com',  entitlement:30},
    {id:'m11',name:'Sooraj Manjery',             email:'sooraj.manjery@morohub.com',   entitlement:30}
  ],
  leaves: []
};

function readDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_DB, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_DB));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch(e) {
    console.error('DB read error:', e.message);
    return JSON.parse(JSON.stringify(DEFAULT_DB));
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch(e) {
    console.error('DB write error:', e.message);
    return false;
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ════════════════════════════════════════════════════
   HEALTH CHECK
════════════════════════════════════════════════════ */
app.get('/health', (req, res) => {
  const db = readDB();
  res.json({
    status:   'ok',
    model:    'gpt-4o-mini',
    members:  db.members.length,
    leaves:   db.leaves.length,
    timestamp: new Date().toISOString()
  });
});

/* ════════════════════════════════════════════════════
   AI PROXY  —  POST /api/chat
════════════════════════════════════════════════════ */
app.post('/api/chat', aiLimiter, async (req, res) => {
  const { messages, system } = req.body;
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: 'messages array required' });
  if (messages.length > 50)
    return res.status(400).json({ error: 'Too many messages' });

  const openaiMessages = [];
  if (system) openaiMessages.push({ role: 'system', content: system });
  messages.forEach(m => openaiMessages.push({ role: m.role, content: m.content }));

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 1000, messages: openaiMessages }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: err?.error?.message || 'OpenAI error' });
    }
    const data = await r.json();
    res.json({ content: [{ type: 'text', text: data.choices?.[0]?.message?.content || '' }], usage: data.usage });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/* ════════════════════════════════════════════════════
   LEAVES API
════════════════════════════════════════════════════ */

/* GET /api/leaves — manager gets all leaves (optionally filtered) */
app.get('/api/leaves', (req, res) => {
  const db  = readDB();
  let leaves = db.leaves;
  if (req.query.year)     leaves = leaves.filter(l => new Date(l.start).getFullYear() === parseInt(req.query.year));
  if (req.query.memberId) leaves = leaves.filter(l => l.memberId === req.query.memberId);
  if (req.query.status)   leaves = leaves.filter(l => l.status === req.query.status);
  res.json({ leaves, members: db.members, total: leaves.length });
});

/* POST /api/leaves/submit — team member submits their leaves */
app.post('/api/leaves/submit', (req, res) => {
  const { exportedBy, email, entitlement, year, leaves } = req.body;
  if (!exportedBy || !Array.isArray(leaves))
    return res.status(400).json({ error: 'exportedBy and leaves[] required' });

  const db = readDB();

  /* Find or create member */
  let member = db.members.find(m => m.name.toLowerCase() === exportedBy.toLowerCase());
  let isNew  = false;
  if (!member) {
    member = { id: 'mb_' + uid(), name: exportedBy, email: email || '', entitlement: Math.min(30, entitlement || 30) };
    db.members.push(member);
    isNew = true;
  }

  /* Upsert leaves — skip exact duplicates */
  let added = 0, skipped = 0, updated = 0;
  leaves.forEach(l => {
    const dup = db.leaves.find(x =>
      x.memberId === member.id &&
      x.start    === l.start   &&
      x.end      === l.end     &&
      x.type     === l.type
    );
    if (dup) {
      /* Update status if changed */
      if (dup.status !== l.status) { dup.status = l.status; updated++; }
      else skipped++;
      return;
    }
    db.leaves.push({
      id:        'lv_' + uid(),
      memberId:  member.id,
      type:      l.type    || 'Annual Leave',
      status:    'Pending',           // always starts as Pending for manager to approve
      start:     l.start,
      end:       l.end,
      days:      l.days    || 0,
      reason:    l.reason  || '',
      submittedAt: new Date().toISOString()
    });
    added++;
  });

  writeDB(db);
  res.json({
    success:   true,
    member:    member.name,
    isNew,
    added,
    updated,
    skipped,
    message:   `${added} leave${added !== 1 ? 's' : ''} submitted for ${member.name}.`
  });
});

/* PUT /api/leaves/:id/status — manager approves or rejects */
app.put('/api/leaves/:id/status', (req, res) => {
  const { status } = req.body;
  if (!['Approved','Rejected','Pending'].includes(status))
    return res.status(400).json({ error: 'status must be Approved, Rejected or Pending' });

  const db = readDB();
  const idx = db.leaves.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Leave not found' });

  db.leaves[idx].status = status;
  db.leaves[idx].reviewedAt = new Date().toISOString();
  writeDB(db);
  res.json({ success: true, leave: db.leaves[idx] });
});

/* DELETE /api/leaves/:id — manager deletes a leave */
app.delete('/api/leaves/:id', (req, res) => {
  const db = readDB();
  const before = db.leaves.length;
  db.leaves = db.leaves.filter(l => l.id !== req.params.id);
  if (db.leaves.length === before) return res.status(404).json({ error: 'Leave not found' });
  writeDB(db);
  res.json({ success: true });
});

/* ════════════════════════════════════════════════════
   MEMBERS API
════════════════════════════════════════════════════ */

/* GET /api/members */
app.get('/api/members', (req, res) => {
  res.json({ members: readDB().members });
});

/* PUT /api/members/:id/entitlement — manager updates entitlement */
app.put('/api/members/:id/entitlement', (req, res) => {
  const val = parseInt(req.body.entitlement);
  if (isNaN(val) || val < 1 || val > 30)
    return res.status(400).json({ error: 'entitlement must be 1–30' });

  const db = readDB();
  const m = db.members.find(x => x.id === req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  m.entitlement = val;
  writeDB(db);
  res.json({ success: true, member: m });
});

/* POST /api/members — add new member */
app.post('/api/members', (req, res) => {
  const { name, email, entitlement } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const db = readDB();
  const m = { id: 'mb_' + uid(), name, email: email || '', entitlement: Math.min(30, parseInt(entitlement) || 30) };
  db.members.push(m);
  writeDB(db);
  res.json({ success: true, member: m });
});

/* DELETE /api/members/:id */
app.delete('/api/members/:id', (req, res) => {
  const db = readDB();
  const before = db.members.length;
  db.members = db.members.filter(m => m.id !== req.params.id);
  db.leaves  = db.leaves.filter(l => l.memberId !== req.params.id);
  if (db.members.length === before) return res.status(404).json({ error: 'Member not found' });
  writeDB(db);
  res.json({ success: true });
});


/* ════════════════════════════════════════════════════
   EMAIL NOTIFICATION  —  POST /api/notify
   Called by personal planner after submit.
   Sends HTML email to manager (CC to submitter).
   Falls back gracefully if SMTP not configured.
════════════════════════════════════════════════════ */
app.post('/api/notify', async (req, res) => {
  const { submitter, submitterEmail, year, leaves, added, skipped } = req.body;
  if (!submitter || !Array.isArray(leaves))
    return res.status(400).json({ error: 'submitter and leaves[] required' });

  const MANAGER_EMAIL = process.env.MANAGER_EMAIL || 'abdulsamee.mohammed@dewa.gov.ae';
  const MANAGER_NAME  = process.env.MANAGER_NAME  || 'Abdul Samee Mohammed';

  /* ── Build HTML email ── */
  const fmtDate = s => { if(!s)return''; const d=new Date(s); return isNaN(d)?s:d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); };
  const statusStyle = { Approved:'background:#D1FAE5;color:#065F46', Pending:'background:#FEF3C7;color:#92400E', Rejected:'background:#FEE2E2;color:#991B1B' };
  const typeStyle = { 'Annual Leave':'background:#DBEAFE;color:#1D4ED8','Sick Leave':'background:#FEE2E2;color:#B91C1C','Emergency Leave':'background:#FEF3C7;color:#B45309','Work From Home':'background:#EEF2FF;color:#4338CA','Maternity Leave':'background:#EDE9FE;color:#6D28D9','Paternity Leave':'background:#CCFBF1;color:#0F766E','Other':'background:#F1F5F9;color:#475569' };

  const rows = leaves.map(l => `
    <tr>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;${typeStyle[l.type]||typeStyle.Other}">${l.type}</span></td>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;font-size:12px;color:#64748B;font-family:monospace;">${fmtDate(l.start)}</td>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;font-size:12px;color:#64748B;font-family:monospace;">${fmtDate(l.end)}</td>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;font-size:13px;font-weight:700;text-align:center;">${l.days||0}</td>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;${statusStyle[l.status]||statusStyle.Pending}">${l.status}</span></td>
      <td style="padding:11px 16px;border-bottom:1px solid #F1F5F9;font-size:12px;color:#94A3B8;">${l.reason||'—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F8FAFC;padding:32px 16px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 24px rgba(0,0,0,.07);">
  <tr><td style="background:linear-gradient(135deg,#1E3A8A,#1D4ED8,#3B82F6);padding:28px 32px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        <div style="display:inline-block;background:rgba(255,255,255,.15);border-radius:6px;padding:4px 10px;font-size:10px;font-weight:700;color:#fff;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px;">DigitalX · Moro Hub</div>
        <div style="font-size:20px;font-weight:700;color:#fff;margin-bottom:4px;">Leave Request Submitted</div>
        <div style="font-size:12px;color:rgba(255,255,255,.6);">${submitter} · ${year} · ${new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}</div>
      </td>
      <td align="right" valign="top">
        <div style="font-size:32px;font-weight:800;color:#fff;line-height:1;">${leaves.length}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.55);margin-top:3px;text-transform:uppercase;letter-spacing:.05em;">Requests</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:20px 32px 8px;">
    <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 18px;margin-bottom:16px;">
      <div style="font-size:13px;color:#334155;line-height:1.7;">
        <strong>${submitter}</strong> has submitted ${added} new leave request${added!==1?'s':''} for your review.
        ${skipped>0?`<span style="color:#94A3B8;"> (${skipped} already on record, skipped)</span>`:''}
        Please review and approve or reject in the <strong>Manager Leave Planner</strong>.
      </div>
    </div>
    <div style="font-size:11px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px;">Leave Schedule — ${year}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
      <thead><tr style="background:#F8FAFC;">
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:left;">Type</th>
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:left;">From</th>
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:left;">To</th>
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:center;">Days</th>
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:left;">Status</th>
        <th style="padding:9px 16px;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#94A3B8;text-align:left;">Notes</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </td></tr>
  <tr><td style="padding:16px 32px 24px;">
    <div style="background:#EFF6FF;border:1px solid #DBEAFE;border-radius:8px;padding:12px 16px;font-size:13px;color:#1E40AF;">
      <strong>Action required:</strong> Please review and approve or reject these requests in your Manager Leave Planner.
    </div>
  </td></tr>
  <tr><td style="background:#F8FAFC;padding:14px 32px;text-align:center;border-top:1px solid #E2E8F0;">
    <div style="font-size:11px;color:#94A3B8;">DigitalX / Moro Hub · Leave Planner · ${new Date().getFullYear()}</div>
  </td></tr>
</table></td></tr></table></body></html>`;

  /* ── Send email or return html for mailto fallback ── */
  if (!mailer) {
    /* SMTP not configured — return the HTML body so client can use mailto */
    return res.json({ success: false, reason: 'smtp_not_configured', html, subject: `Leave Request — ${submitter} — ${year}` });
  }

  try {
    await mailer.sendMail({
      from:    `"${submitter}" <${process.env.SMTP_USER}>`,
      to:      `"${MANAGER_NAME}" <${MANAGER_EMAIL}>`,
      cc:      submitterEmail ? `"${submitter}" <${submitterEmail}>` : undefined,
      subject: `Leave Request — ${submitter} — ${year}`,
      html,
    });
    res.json({ success: true, message: `Email sent to ${MANAGER_EMAIL}` });
  } catch(e) {
    console.error('Email send error:', e.message);
    res.status(500).json({ success: false, reason: 'smtp_error', error: e.message, html, subject: `Leave Request — ${submitter} — ${year}` });
  }
});

/* ── 404 ── */
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`\n✅  DigitalX Leave Server running on http://localhost:${PORT}`);
  console.log(`    Health:  GET  http://localhost:${PORT}/health`);
  console.log(`    Leaves:  GET  http://localhost:${PORT}/api/leaves`);
  console.log(`    Submit:  POST http://localhost:${PORT}/api/leaves/submit`);
  console.log(`    AI Chat: POST http://localhost:${PORT}/api/chat`);
  console.log(`\n    Data file: ${DB_PATH}\n`);
});
