/* Tiny JSON-file store (MVP). Swap for Postgres/Supabase/Firestore in production — see README.
 * Assessments are encrypted at rest with AES-256-GCM when DATA_ENCRYPTION_KEY (64 hex chars) is set. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'db.json');
  let db = { users: {}, entitlements: {}, sessions: {}, tokens: {}, assessments: {}, audit: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* new db */ }
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 }); fs.renameSync(tmp, file); };
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const keyHex = () => process.env.DATA_ENCRYPTION_KEY || '';
  const enc = (obj) => {
    const json = JSON.stringify(obj); if (!/^[0-9a-f]{64}$/i.test(keyHex())) return { plain: obj };
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyHex(), 'hex'), iv);
    const ct = Buffer.concat([c.update(json, 'utf8'), c.final()]);
    return { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
  };
  const dec = (rec) => {
    if (!rec) return null; if (rec.plain) return rec.plain;
    const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex(), 'hex'), Buffer.from(rec.iv, 'base64'));
    d.setAuthTag(Buffer.from(rec.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(rec.ct, 'base64')), d.final()]).toString('utf8'));
  };
  const norm = (e) => String(e || '').trim().toLowerCase();
  return {
    norm, sha, save,
    audit(ev) { db.audit.push({ t: new Date().toISOString(), ...ev }); if (db.audit.length > 500) db.audit.shift(); save(); },
    getEntitlement: (email) => db.entitlements[norm(email)] || null,
    setEntitlement(email, patch) { const k = norm(email); db.entitlements[k] = { ...(db.entitlements[k] || {}), ...patch, email: k, updatedAt: new Date().toISOString() }; save(); return db.entitlements[k]; },
    listEntitlements: () => Object.values(db.entitlements),
    hasAccess(email) { const e = db.entitlements[norm(email)]; return !!e && e.status === 'active'; },
    createToken(email, ttlMs = 15 * 60 * 1000) {
      const raw = crypto.randomBytes(32).toString('base64url');
      db.tokens[sha(raw)] = { email: norm(email), exp: Date.now() + ttlMs }; save(); return raw;
    },
    consumeToken(raw) {
      const k = sha(String(raw || '')); const t = db.tokens[k]; delete db.tokens[k];
      if (t) save(); return t && t.exp > Date.now() ? t.email : null;
    },
    createSession(email, ttlMs = 30 * 24 * 3600 * 1000) {
      const raw = crypto.randomBytes(32).toString('base64url');
      db.sessions[sha(raw)] = { email: norm(email), exp: Date.now() + ttlMs }; save(); return raw;
    },
    getSession(raw) { const s = db.sessions[sha(String(raw || ''))]; if (!s) return null; if (s.exp < Date.now()) return null; return s; },
    deleteSession(raw) { delete db.sessions[sha(String(raw || ''))]; save(); },
    revokeSessions(email) { for (const [k, s] of Object.entries(db.sessions)) if (s.email === norm(email)) delete db.sessions[k]; save(); },
    getUser: (email) => db.users[norm(email)] || { consent: null, ai: { day: '', n: 0 } },
    setUser(email, patch) { db.users[norm(email)] = { ...this.getUser(email), ...patch }; save(); },
    getAssessment: (email) => dec(db.assessments[norm(email)]),
    putAssessment(email, obj) { db.assessments[norm(email)] = enc(obj); save(); },
    deleteAssessment(email) { delete db.assessments[norm(email)]; save(); },
    deleteAccountData(email) { const k = norm(email); delete db.assessments[k]; delete db.users[k]; this.revokeSessions(k); save(); }
  };
}
module.exports = { createStore };
