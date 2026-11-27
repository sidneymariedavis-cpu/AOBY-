(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  let LIB = null;
  const H = () => ({ 'content-type': 'application/json', 'x-requested-with': 'compass', authorization: 'Bearer ' + $('tok').value });
  const say = (m) => { $('msg').textContent = m; };
  function el(t, a, ...k) { const e = document.createElement(t); for (const [x, v] of Object.entries(a || {})) { if (x.startsWith('on')) e.addEventListener(x.slice(2), v); else if (x === 'value') e.value = v; else if (x === 'class') e.className = v; else e.setAttribute(x, v); } for (const c of k.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c)); return e; }
  async function call(m, p, b) { const r = await fetch(p, { method: m, headers: H(), body: b ? JSON.stringify(b) : undefined }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; }
  function ta(label, val, on, rows = 3) { const t = el('textarea', { rows, 'aria-label': label, value: val || '' }); t.value = val || ''; t.addEventListener('input', () => on(t.value)); return el('div', {}, el('label', {}, label), t); }
  function draw() {
    const box = $('lib'); box.replaceChildren();
    const approved = LIB.entries.filter((e) => e.status === 'approved').length;
    box.append(el('h2', {}, 'Human Design reference library'), el('div', { class: 'card warn' }, el('b', {}, `${approved} of ${LIB.entries.length} entries approved.`), el('p', { class: 'hint' }, 'Required before launching the Human Design feature:'), el('ul', { class: 'ev' }, LIB.requiredBeforeLaunch.map((r) => el('li', {}, r)))));
    for (const e of LIB.entries) {
      const d = el('details', { class: 'card' }, el('summary', {}, el('span', {}, el('b', {}, e.title), ' ', el('span', { class: 'chip' }, e.kind), el('span', { class: 'chip ' + (e.status === 'approved' ? 'flexible' : '') }, e.status + ' · v' + e.version))));
      d.append(ta('Definition / body (your wording)', e.body, (v) => { e.body = v; }, 4),
        ta('Reflective questions (one per line; you may use {responsibility})', (e.reflective_questions || []).join('\n'), (v) => { e.reflective_questions = v.split('\n').map((s) => s.trim()).filter(Boolean); }, 4),
        ta('Practical decision-making application', e.practical_application, (v) => { e.practical_application = v; }),
        ta('Interpretation limitations', e.limitations, (v) => { e.limitations = v; }, 2));
      const sel = el('select', {}, el('option', { value: 'draft' }, 'draft'), el('option', { value: 'approved' }, 'approved')); sel.value = e.status; sel.addEventListener('change', () => { e.status = sel.value; });
      d.append(el('label', {}, 'Status (editing approved content resets it to draft until re-approved)'), sel, el('p', { class: 'hint' }, e.approvedAt ? `Approved ${e.approvedAt} by ${e.approvedBy}` : 'Not approved'));
      box.append(d);
    }
    box.append(el('div', { class: 'row' }, el('button', { class: 'primary', onclick: async () => { try { LIB = await call('PUT', '/api/admin/library', LIB); say('Saved'); draw(); } catch (e) { say(e.message); } } }, 'Save library')));
  }
  async function ents() {
    const list = await call('GET', '/api/admin/entitlements'); const box = $('ent'); box.replaceChildren(el('h2', {}, 'Access (entitlements)'));
    const em = el('input', { type: 'email', placeholder: 'email', 'aria-label': 'Email' });
    box.append(el('div', { class: 'card' }, em, el('div', { class: 'row', style: 'margin-top:8px' },
      el('button', { onclick: async () => { await call('POST', '/api/admin/entitlements', { email: em.value, action: 'grant', source: 'admin' }); ents(); } }, 'Grant access'),
      el('button', { onclick: async () => { await call('POST', '/api/admin/entitlements', { email: em.value, action: 'grant', source: 'test' }); ents(); } }, 'Grant TEST access (non-production)'),
      el('button', { onclick: async () => { await call('POST', '/api/admin/entitlements', { email: em.value, action: 'revoke' }); ents(); } }, 'Revoke'))));
    box.append(el('div', { class: 'card' }, list.length ? list.map((x) => el('p', {}, `${x.email} — ${x.status} (${x.source})${x.orderId ? ' · order ' + x.orderId : ''}`)) : 'No entitlements yet.'));
  }
  $('load').addEventListener('click', async () => { try { LIB = await call('GET', '/api/admin/library'); say('Loaded'); draw(); await ents(); } catch (e) { say('Could not load: ' + e.message); } });
})();
