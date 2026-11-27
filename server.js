'use strict';
/* The Capacity Compass — server. Zero npm dependencies (Node 18+).
 * Auth: passwordless magic link. Access: server-side entitlement per email. AI: server-side only. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// optional .env loader (no dependency)
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch (e) { /* no .env */ }

const E = require('./lib/engine');
const AI = require('./lib/ai');
const { createStore } = require('./lib/store');

function createApp(opts = {}) {
  const env = (k, d = '') => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
  const store = createStore(opts.dataDir || env('DATA_DIR', path.join(__dirname, 'data', 'runtime')));
  const LIB_PATH = opts.libraryPath || env('LIBRARY_PATH', path.join(__dirname, 'data', 'hd-library.json'));
  const isProd = () => env('NODE_ENV') === 'production';
  const testMode = () => env('ACCESS_MODE', 'production') === 'test';
  const readLib = () => JSON.parse(fs.readFileSync(LIB_PATH, 'utf8'));
  const timingEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

  // ---- rate limits (in-memory; per process) ----
  const hits = new Map();
  function limit(key, max, windowMs) {
    const now = Date.now(); const a = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (a.length >= max) { hits.set(key, a); return false; } a.push(now); hits.set(key, a); return true;
  }

  const publicConfig = () => ({
    productName: 'The Capacity Compass', brand: 'Renew You Living',
    offerPrice: env('OFFER_PRICE', '27'), offerCurrency: env('OFFER_CURRENCY', 'USD'),
    checkoutUrl: env('CHECKOUT_URL'), supportEmail: env('SUPPORT_EMAIL'), coachingUrl: env('COACHING_URL'),
    accessMode: testMode() ? 'test' : 'production', aiAvailable: AI.available(), aiProvider: 'Anthropic (Claude API)',
    retentionNote: env('AI_RETENTION_NOTE', 'We do not control or guarantee zero retention at the AI provider. Anthropic’s API terms and data-retention policy in effect at the time apply; check them before you submit anything sensitive.'),
    storage: env('DATA_ENCRYPTION_KEY') ? 'Your assessment is stored on our server, encrypted at rest, until you delete it.' : 'Your assessment is stored on our server until you delete it. (Encryption at rest is not enabled in this deployment.)'
  });

  const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((s) => s.trim().split(/=(.*)/s).slice(0, 2)).filter((p) => p[0]));
  function setCookie(res, val, maxAge) {
    res.setHeader('Set-Cookie', `cc_session=${val}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${isProd() ? '; Secure' : ''}`);
  }
  function readBody(req, max = 300 * 1024) {
    return new Promise((resolve, reject) => {
      let n = 0; const chunks = [];
      req.on('data', (c) => { n += c.length; if (n > max) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const fail = (status, message) => Object.assign(new Error(message), { status });

  async function sendMagicLink(email, token, req) {
    const base = env('APP_URL', `http://${req.headers.host}`);
    const link = `${base}/?token=${encodeURIComponent(token)}`;
    const hook = env('EMAIL_WEBHOOK_URL');
    if (hook) {
      await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json', ...(env('EMAIL_WEBHOOK_SECRET') ? { 'x-webhook-secret': env('EMAIL_WEBHOOK_SECRET') } : {}) },
        body: JSON.stringify({ to: email, subject: 'Your Capacity Compass sign-in link', text: `Here is your secure sign-in link (valid 15 minutes, one use):\n${link}`, link }) }).catch(() => {});
      return { link: null, delivered: 'webhook' };
    }
    if (!isProd() || testMode()) console.log(`[dev] sign-in link for ${email}: ${link}`);
    else console.warn('[warn] EMAIL_WEBHOOK_URL is not set; sign-in link could not be delivered.');
    return { link, delivered: 'none' };
  }

  async function api(req, res, url) {
    const p = url.pathname; const m = req.method;
    const ip = req.socket.remoteAddress || 'x';
    if (m !== 'GET' && !String(req.headers['content-type'] || '').includes('application/json') && p !== '/api/webhooks/ghl') throw fail(415, 'JSON only');
    if (m !== 'GET' && !p.startsWith('/api/webhooks/') && req.headers['x-requested-with'] !== 'compass') throw fail(403, 'Missing request header');

    if (p === '/api/config' && m === 'GET') return json(res, 200, publicConfig());

    // ---- GoHighLevel webhook (server-to-server; shared secret header) ----
    if (p === '/api/webhooks/ghl' && m === 'POST') {
      const secret = env('GHL_WEBHOOK_SECRET');
      if (!secret) throw fail(503, 'Webhook not configured');
      if (!timingEq(req.headers['x-webhook-secret'] || '', secret)) throw fail(401, 'Bad signature');
      let b; try { b = JSON.parse((await readBody(req, 50 * 1024)).toString('utf8')); } catch (e) { throw fail(400, 'Bad JSON'); }
      const email = String(b.email || (b.contact && b.contact.email) || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fail(400, 'Email required');
      const allowed = env('ELIGIBLE_TICKETS', 'general_admission,vip').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      const wantProduct = env('GHL_PRODUCT_ID');
      if (b.event === 'grant') {
        if (wantProduct && String(b.productId || '') !== wantProduct) throw fail(422, 'Unexpected product');
        if (allowed.length && !allowed.includes(String(b.ticket || '').toLowerCase())) throw fail(422, 'Ticket not eligible');
        const ent = store.setEntitlement(email, { status: 'active', source: 'ghl', orderId: String(b.orderId || ''), ticket: String(b.ticket || ''), grantedAt: new Date().toISOString() });
        store.audit({ ev: 'grant', email, orderId: ent.orderId });
        return json(res, 200, { ok: true });
      }
      if (b.event === 'revoke') {
        store.setEntitlement(email, { status: 'revoked', revokedAt: new Date().toISOString(), revokeReason: String(b.reason || 'refund').slice(0, 80) });
        store.revokeSessions(email); store.audit({ ev: 'revoke', email });
        return json(res, 200, { ok: true });
      }
      throw fail(400, 'event must be grant or revoke');
    }

    // ---- admin (bearer ADMIN_TOKEN) ----
    if (p.startsWith('/api/admin/')) {
      const tok = env('ADMIN_TOKEN');
      const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!tok || !limit('admin:' + ip, 30, 60000) || !timingEq(given, tok)) throw fail(401, 'Unauthorized');
      if (p === '/api/admin/library' && m === 'GET') return json(res, 200, readLib());
      if (p === '/api/admin/library' && m === 'PUT') {
        const lib = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
        if (!Array.isArray(lib.entries)) throw fail(400, 'entries[] required');
        const prev = readLib(); const prevById = Object.fromEntries(prev.entries.map((e) => [e.id, e]));
        for (const e of lib.entries) {
          if (!['draft', 'approved'].includes(e.status)) e.status = 'draft';
          const old = prevById[e.id];
          const changed = !old || ['body', 'practical_application', 'limitations', 'key'].some((k) => old[k] !== e[k]) || JSON.stringify(old.reflective_questions) !== JSON.stringify(e.reflective_questions);
          if (old && changed) { e.version = (old.version || 1) + 1; if (old.status === 'approved') e.status = 'draft'; } // edits require re-approval
          if (e.status === 'approved' && (!old || old.status !== 'approved')) { e.approvedAt = new Date().toISOString(); e.approvedBy = e.approvedBy || 'founder'; }
          if (e.status !== 'approved') { e.approvedAt = null; }
        }
        lib.updatedAt = new Date().toISOString();
        fs.writeFileSync(LIB_PATH, JSON.stringify(lib, null, 2)); store.audit({ ev: 'library-save' });
        return json(res, 200, lib);
      }
      if (p === '/api/admin/entitlements' && m === 'GET') return json(res, 200, store.listEntitlements());
      if (p === '/api/admin/entitlements' && m === 'POST') {
        const b = JSON.parse((await readBody(req)).toString('utf8')); const email = String(b.email || '').toLowerCase();
        if (!email.includes('@')) throw fail(400, 'email');
        if (b.action === 'revoke') { store.setEntitlement(email, { status: 'revoked', revokedAt: new Date().toISOString() }); store.revokeSessions(email); }
        else store.setEntitlement(email, { status: 'active', source: b.source === 'test' ? 'test' : 'admin', grantedAt: new Date().toISOString() });
        store.audit({ ev: 'admin-' + b.action, email });
        return json(res, 200, { ok: true });
      }
      throw fail(404, 'Not found');
    }

    // ---- auth ----
    if (p === '/api/auth/request' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
      const email = String(b.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) throw fail(400, 'Please enter a valid email.');
      if (!limit('ar:ip:' + ip, Number(env('AUTH_IP_LIMIT', '10')), 600000) || !limit('ar:e:' + email, 3, 600000)) throw fail(429, 'Too many requests. Please wait a few minutes.');
      if (testMode() && !store.hasAccess(email)) store.setEntitlement(email, { status: 'active', source: 'test', grantedAt: new Date().toISOString() });
      const out = { ok: true, message: 'If this email has access, a sign-in link is on its way.' };
      if (store.hasAccess(email)) {
        const r = await sendMagicLink(email, store.createToken(email), req);
        if (testMode() && r.link) { out.devLink = r.link; out.testMode = true; }
      }
      return json(res, 200, out);
    }
    if (p === '/api/auth/verify' && m === 'POST') {
      if (!limit('av:' + ip, 20, 600000)) throw fail(429, 'Too many attempts');
      const b = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
      const email = store.consumeToken(b.token);
      if (!email || !store.hasAccess(email)) throw fail(401, 'This link is invalid, expired or already used. Request a new one.');
      setCookie(res, store.createSession(email), 30 * 24 * 3600);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/auth/logout' && m === 'POST') { store.deleteSession(parseCookies(req).cc_session); setCookie(res, '', 0); return json(res, 200, { ok: true }); }

    // ---- everything below needs a session AND an active entitlement (re-checked every request) ----
    const sess = store.getSession(parseCookies(req).cc_session);
    if (p === '/api/session' && m === 'GET') {
      if (!sess || !store.hasAccess(sess.email)) return json(res, 200, { authenticated: false });
      const ent = store.getEntitlement(sess.email); const u = store.getUser(sess.email);
      return json(res, 200, { authenticated: true, email: sess.email, testAccess: ent.source === 'test', consentAI: !!(u.consent && u.consent.ai), aiAvailable: AI.available() });
    }
    if (!sess) throw fail(401, 'Please sign in.');
    if (!store.hasAccess(sess.email)) throw fail(403, 'Your access is not active. Contact support.');
    const email = sess.email;

    if (p === '/api/assessment' && m === 'GET') return json(res, 200, { state: store.getAssessment(email) });
    if (p === '/api/assessment' && m === 'PUT') {
      const b = JSON.parse((await readBody(req)).toString('utf8'));
      if (!b.state || typeof b.state !== 'object' || !Array.isArray(b.state.cards)) throw fail(400, 'Invalid state');
      store.putAssessment(email, b.state); return json(res, 200, { ok: true });
    }
    if (p === '/api/assessment' && m === 'DELETE') { store.deleteAssessment(email); return json(res, 200, { ok: true }); }
    if (p === '/api/account' && m === 'DELETE') { store.deleteAccountData(email); setCookie(res, '', 0); return json(res, 200, { ok: true }); }
    if (p === '/api/consent' && m === 'POST') {
      const b = JSON.parse((await readBody(req, 2048)).toString('utf8') || '{}');
      store.setUser(email, { consent: b.ai ? { ai: true, at: new Date().toISOString() } : null }); return json(res, 200, { ok: true });
    }
    if (p === '/api/library' && m === 'GET') { // customer-facing view: approved entries only, nothing else
      const lib = readLib();
      return json(res, 200, { consistency_rules: lib.consistency_rules, entries: lib.entries.filter((e) => e.status === 'approved') .map((e) => ({ id: e.id, kind: e.kind, key: e.key, title: e.title, body: e.body, reflective_questions: e.reflective_questions, practical_application: e.practical_application, limitations: e.limitations, status: e.status })) });
    }

    // ---- AI endpoints ----
    if (p.startsWith('/api/ai/') && m === 'POST') {
      const b = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const u = store.getUser(email);
      const aiOn = AI.available() && u.consent && u.consent.ai;
      if (!AI.available()) return json(res, 200, { aiUsed: false, reason: 'not_configured' });
      if (!u.consent || !u.consent.ai) return json(res, 200, { aiUsed: false, reason: 'no_consent' });
      const day = new Date().toISOString().slice(0, 10);
      const used = u.ai && u.ai.day === day ? u.ai.n : 0; const dailyMax = Number(env('AI_DAILY_LIMIT', '40'));
      if (used >= dailyMax) throw fail(429, 'You’ve reached today’s AI limit. Guided mode still works, and the limit resets tomorrow.');
      if (!limit('ai:' + email, 8, 60000)) throw fail(429, 'Please slow down for a moment.');
      store.setUser(email, { ai: { day, n: used + 1 } });
      try {
        if (p === '/api/ai/organize') {
          const text = String(b.text || '').slice(0, 8000); if (text.trim().length < 3) throw fail(400, 'Write a little more first.');
          return json(res, 200, { aiUsed: true, ...(await AI.organize(text)) });
        }
        const st = b.state; if (!st || !Array.isArray(st.cards)) throw fail(400, 'state required');
        st.cards = st.cards.slice(0, 60);
        if (p === '/api/ai/analyze') return json(res, 200, { aiUsed: true, analysis: await AI.analyze(st) });
        if (p === '/api/ai/hd') return json(res, 200, { aiUsed: true, reflection: await AI.hdReflect(st, readLib()) });
        if (p === '/api/ai/boundary') return json(res, 200, { aiUsed: true, result: await AI.boundary(st, b.request || {}) });
      } catch (e) {
        if (e.status) throw e;
        return json(res, 200, { aiUsed: false, reason: 'ai_error', detail: e.code || 'ERROR' }); // client falls back to deterministic mode
      }
    }
    throw fail(404, 'Not found');
  }

  // ---- static ----
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname); if (rel === '/') rel = '/index.html'; if (rel === '/admin') rel = '/admin.html';
    let file;
    if (rel === '/engine.js') file = path.join(__dirname, 'lib', 'engine.js');
    else { file = path.normalize(path.join(__dirname, 'public', rel)); if (!file.startsWith(path.join(__dirname, 'public') + path.sep)) { res.writeHead(403); return res.end(); } }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(buf);
    });
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (isProd()) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url);
    } catch (e) {
      const status = e.status || (e instanceof SyntaxError ? 400 : 500);
      if (status === 500) console.error(e);
      json(res, status, { error: status === 500 ? 'Something went wrong.' : e.message });
    }
  });
  return { server, store };
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    const test = (process.env.ACCESS_MODE || 'production') === 'test';
    console.log(`The Capacity Compass on http://localhost:${port}`);
    console.log(`Access mode: ${test ? 'TEST (non-production: any email can sign in)' : 'production (entitlement required)'}`);
    console.log(`AI: ${AI.available() ? 'Anthropic key configured' : 'no ANTHROPIC_API_KEY — Guided (non-AI) mode'}`);
  });
}
module.exports = { createApp };
