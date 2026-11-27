/* The Capacity Compass — front end (vanilla JS, no build step). All user text is rendered with textContent. */
(function () {
  'use strict';
  const E = window.CCEngine;
  let CFG = {}, SESSION = null, LIB = null, S = E.newState();
  const ui = { screen: 'loading', open: {}, busy: '', error: '', toast: '', saved: '', token: null, devLink: '', email: '', sent: false, hdAsk: null };
  const root = document.getElementById('app');

  // ---------- helpers ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'open' || k === 'selected') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  async function api(method, path, body) {
    const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'compass' }, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch (e) { /* none */ }
    if (r.status === 401 && path !== '/api/auth/verify' && path !== '/api/session') { SESSION = null; go('login'); }
    if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
    return j;
  }
  let saveT;
  function save() {
    ui.saved = 'Saving…'; clearTimeout(saveT);
    saveT = setTimeout(async () => { try { await api('PUT', '/api/assessment', { state: S }); ui.saved = 'Saved'; } catch (e) { ui.saved = 'Not saved'; } const el = document.getElementById('saved'); if (el) el.textContent = ui.saved; }, 600);
  }
  let rq = 0;
  function render() {
    cancelAnimationFrame(rq);
    rq = requestAnimationFrame(() => {
      const ae = document.activeElement; const fk = ae && ae.dataset && ae.dataset.fk;
      const sel = fk && ae.selectionStart !== undefined ? [ae.selectionStart, ae.selectionEnd] : null;
      const y = window.scrollY;
      root.replaceChildren(view());
      window.scrollTo(0, y);
      if (fk) { const n = root.querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n) { n.focus({ preventScroll: true }); try { if (sel) n.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ } } }
    });
  }
  const mutate = (fn) => { fn(); save(); render(); };
  const go = (screen) => { ui.screen = screen; ui.error = ''; render(); window.scrollTo(0, 0); };
  const toast = (m) => { ui.toast = m; render(); setTimeout(() => { ui.toast = ''; render(); }, 2200); };
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { const t = h('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); toast('Copied'); } catch (e2) { toast('Select and copy manually'); } t.remove(); } };
  const cardById = (id) => S.cards.find((c) => c.id === id);
  const nm = (id) => { const c = cardById(id); return c ? c.name : ''; };
  const hrs = (v) => (E.num(v) === null ? 'unknown' : E.hrs(E.num(v)));
  const openKey = (k) => !!ui.open[k];
  const det = (key, cls, summary, ...body) => h('details', { class: cls, open: openKey(key), ontoggle: (e) => { ui.open[key] = e.target.open; } }, h('summary', {}, summary), ...body);

  // ---------- form atoms ----------
  function field(label, input, hint) { return h('div', {}, h('label', {}, label), hint ? h('div', { class: 'hint' }, hint) : null, input); }
  function selectEl(fk, opts, val, onch) {
    return h('select', { 'data-fk': fk, onchange: (e) => onch(e.target.value) }, opts.map(([v, l]) => h('option', { value: v, selected: String(val ?? '') === String(v) }, l)));
  }
  function numEl(fk, val, onch, ph, step = '0.25') {
    return h('input', { 'data-fk': fk, type: 'number', min: '0', step, inputmode: 'decimal', placeholder: ph || '', value: val === null || val === undefined ? '' : val, onchange: (e) => onch(e.target.value === '' ? null : Math.max(0, Number(e.target.value))) });
  }
  function textEl(fk, val, onch, ph, tag = 'input') {
    const el = h(tag, { 'data-fk': fk, maxlength: tag === 'textarea' ? '8000' : '400', placeholder: ph || '', value: val || '', oninput: (e) => { onch(e.target.value); save(); } });
    if (tag === 'textarea') el.textContent = val || '';
    return el;
  }
  const LV = [['unknown', 'Not sure'], ['low', 'Low'], ['moderate', 'Moderate'], ['high', 'High']];
  const STAT = [['', 'Not sorted yet'], ['fixed', 'Fixed — can’t change'], ['flexible', 'Flexible — can move'], ['optional', 'Optional — I could drop it'], ['undecided', 'Undecided']];

  // ---------- shell ----------
  function shell(content, wide) {
    const tb = h('header', { class: 'topbar' },
      h('div', { class: 'brand' }, 'The Capacity Compass', h('small', {}, 'Renew You Living')),
      SESSION ? h('nav', { class: 'menu', 'aria-label': 'Account' },
        h('span', { class: 'saved', id: 'saved', 'aria-live': 'polite' }, ui.saved),
        h('button', { class: 'quiet small', onclick: () => go('privacy') }, 'Privacy'),
        h('button', { class: 'quiet small', onclick: newAssessment }, 'Start new'),
        h('button', { class: 'quiet small', onclick: signOut }, 'Sign out')) : null);
    return h('div', {}, SESSION && SESSION.testAccess ? h('div', { class: 'banner', role: 'status' }, 'TEST ACCESS — non-production. Anyone can sign in with any email in this mode.') : null,
      tb, h('main', { id: 'main', class: 'wrap' + (wide ? ' wide' : ''), tabindex: '-1' }, ui.error ? h('div', { class: 'err', role: 'alert' }, ui.error) : null, content),
      ui.toast ? h('div', { class: 'toast', role: 'status' }, ui.toast) : null);
  }
  async function signOut() { await api('POST', '/api/auth/logout').catch(() => {}); SESSION = null; S = E.newState(); go('login'); }
  function newAssessment() {
    if (!confirm('Start a new assessment? This clears your current assessment from our server. (Your Capacity Edit isn’t kept anywhere else — print or save it first if you want it.)')) return;
    api('DELETE', '/api/assessment').catch(() => {}); S = E.newState(); S.consentSeen = true; ui.hdAsk = null; go('plate');
  }

  // ---------- screens ----------
  function view() {
    switch (ui.screen) {
      case 'loading': return h('p', { class: 'loading' }, 'Loading…');
      case 'login': return shell(loginView());
      case 'welcome': return shell(welcomeView());
      case 'privacy': return shell(privacyView());
      case 'plate': return shell(stepView(1, plateStep()));
      case 'capacity': return shell(stepView(2, capacityStep()));
      case 'priority': return shell(stepView(3, priorityStep()));
      case 'hd': return shell(stepView(4, hdStep()));
      case 'dashboard': return shell(dashboardView(), true);
      case 'edit': return shell(editView());
    }
    return h('p', {}, '…');
  }

  function loginView() {
    const testNote = CFG.accessMode === 'test';
    return h('div', { class: 'card', style: 'margin-top:24px' },
      h('div', { class: 'kicker' }, 'Renew You Living'), h('h1', {}, 'Welcome back'),
      h('p', { class: 'lede' }, 'Enter the email you used at checkout and we’ll send a secure sign-in link. No password needed.'),
      testNote ? h('div', { class: 'banner', style: 'margin:10px 0;border-radius:10px' }, 'TEST MODE (non-production): any email can sign in and the link is shown on this page.') : null,
      ui.sent ? h('div', { class: 'card olive', role: 'status' }, h('p', {}, 'If that email has access, a sign-in link is on its way. It works once and expires in 15 minutes.'),
        ui.devLink ? h('p', {}, h('a', { href: ui.devLink }, 'Test mode: open sign-in link')) : null) : null,
      field('Email', h('input', { type: 'email', 'data-fk': 'email', autocomplete: 'email', placeholder: 'you@example.com', value: ui.email, oninput: (e) => { ui.email = e.target.value; } })),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', disabled: !!ui.busy, onclick: async () => {
        ui.busy = 'login'; ui.error = ''; render();
        try { const r = await api('POST', '/api/auth/request', { email: ui.email }); ui.sent = true; ui.devLink = r.devLink || ''; } catch (e) { ui.error = e.message; }
        ui.busy = ''; render();
      } }, ui.busy ? 'Sending…' : 'Email me a sign-in link'),
        CFG.checkoutUrl ? h('a', { class: 'btn', href: CFG.checkoutUrl, rel: 'noopener' }, 'Get The Capacity Compass' + (CFG.offerPrice ? ` — $${CFG.offerPrice}` : '')) : null),
      CFG.supportEmail ? h('p', { class: 'hint', style: 'margin-top:14px' }, 'Trouble signing in? ', h('a', { href: 'mailto:' + CFG.supportEmail }, CFG.supportEmail)) : null);
  }

  function welcomeView() {
    const aiOn = CFG.aiAvailable;
    return h('div', {},
      h('div', { class: 'kicker', style: 'margin-top:28px' }, 'The Capacity Compass'),
      h('h1', {}, 'Your life is full. Let’s find out what’s taking up all the room.'),
      h('p', { class: 'lede' }, 'Get everything out of your head and find out what your week can actually hold, what can change, and where to set one boundary to get some breathing room back.'),
      h('p', { class: 'hint' }, 'About 5–10 minutes. This isn’t about doing more — it’s about making room for what matters without automatically sacrificing yourself.'),
      h('div', { class: 'card' }, h('h3', {}, 'How your information is handled'),
        aiOn ? h('div', {}, h('p', {}, `To organize your brain dump and personalize recommendations, your text can be processed by AI (${CFG.aiProvider}). You choose below. You can use the whole tool without AI too — it then runs in Guided mode with simpler, rule-based help, clearly labeled.`),
          h('ul', { class: 'ev' }, h('li', {}, h('b', {}, 'Sent to the AI provider: '), 'your brain dump, responsibility cards, capacity answers, priority, and Human Design details only if you add them. Never your email or name.'),
            h('li', {}, h('b', {}, 'Storage: '), CFG.storage), h('li', {}, h('b', {}, 'Retention at the provider: '), CFG.retentionNote),
            h('li', {}, h('b', {}, 'Delete anytime: '), 'Start new, or Privacy → Delete my data.')),
          h('div', { class: 'row' },
            h('button', { class: 'primary', onclick: () => consent(true) }, 'I understand — use AI'),
            h('button', { onclick: () => consent(false) }, 'Continue without AI')))
          : h('div', {}, h('p', {}, 'AI is not configured on this server, so you’ll use Guided mode: your text is organized with simple rules, not AI, and scripts come from built-in templates. Nothing is sent to an AI provider.'),
            h('p', { class: 'hint' }, CFG.storage), h('button', { class: 'primary', onclick: () => consent(false) }, 'Begin'))),
      S.cards.length ? h('button', { onclick: () => go(S.step === 'dashboard' ? 'dashboard' : S.step) }, 'Continue my saved assessment') : null);
  }
  async function consent(ai) {
    try { await api('POST', '/api/consent', { ai }); SESSION.consentAI = ai; } catch (e) { /* ignore */ }
    S.consentSeen = true; save(); go('plate');
  }

  function privacyView() {
    return h('div', { class: 'card', style: 'margin-top:24px' }, h('h2', {}, 'Privacy & your data'),
      h('ul', { class: 'ev' },
        h('li', {}, 'We ask only for what’s needed. No medical, financial or relationship histories required.'),
        h('li', {}, `AI processing: ${CFG.aiAvailable ? 'enabled by you, using ' + CFG.aiProvider + '.' : 'not configured on this server.'} ${CFG.retentionNote}`),
        h('li', {}, CFG.storage), h('li', {}, 'Your answers are never sent to advertising or analytics platforms; this app loads no third-party scripts or fonts.'),
        h('li', {}, 'Human Design is offered as an optional symbolic reflection framework. It is not a measure of health, energy, personality or decision-making ability.'),
        h('li', {}, 'This tool supports reflection; it doesn’t diagnose burnout, stress, trauma or any health condition and isn’t a substitute for professional support.')),
      SESSION && SESSION.consentAI ? h('p', {}, h('button', { class: 'small', onclick: async () => { await api('POST', '/api/consent', { ai: false }); SESSION.consentAI = false; toast('AI turned off'); } }, 'Turn off AI processing')) : null,
      h('div', { class: 'row' }, h('button', { onclick: () => go(S.cards.length ? S.step === 'dashboard' ? 'dashboard' : S.step : 'welcome') }, 'Back'),
        h('button', { onclick: async () => { if (!confirm('Delete your saved assessment from our server now?')) return; await api('DELETE', '/api/assessment'); S = E.newState(); toast('Assessment deleted'); go('welcome'); } }, 'Delete my assessment'),
        h('button', { onclick: async () => { if (!confirm('Delete all your stored data and sign out? Your purchase access remains so you can come back.')) return; await api('DELETE', '/api/account'); SESSION = null; S = E.newState(); go('login'); } }, 'Delete all my data & sign out')));
  }

  function stepView(n, body) {
    return h('div', {}, h('div', { class: 'progress', role: 'img', 'aria-label': `Step ${n} of 4` }, [1, 2, 3, 4].map((i) => h('span', { class: i <= n ? 'on' : '' }))), body);
  }
  const modeLabel = () => (CFG.aiAvailable && SESSION && SESSION.consentAI ? 'AI-assisted' : 'Guided mode (rule-based, not AI)');

  // ----- Step 1
  function plateStep() {
    const hasCards = S.cards.length > 0;
    return h('div', {},
      h('div', { class: 'kicker' }, 'Step 1 of 4 · ' + modeLabel()), h('h1', {}, 'What’s on your plate?'),
      h('p', { class: 'lede' }, 'What’s taking up your time, energy or mental space right now?'),
      h('p', { class: 'hint' }, 'A messy brain dump is perfect. Include work, appointments and deadlines, family and household, requests from other people, unfinished decisions, personal goals, things you’re mentally carrying, and what you keep postponing. If you know a time, mention it (“about 2 hours”); if you don’t, leave it out — I won’t guess.'),
      textEl('dump', S.brainDump, (v) => { S.brainDump = v.slice(0, 8000); const b = document.getElementById('orgBtn'); if (b) b.disabled = !!ui.busy || v.trim().length < 3; const c = document.getElementById('dumpCount'); if (c) c.textContent = v.length + '/8000 characters'; }, 'e.g. Client proposal due Friday (about 3 hours). Mom’s appointment Tuesday. Haven’t decided about the committee role. Want to start painting again…', 'textarea'),
      h('p', { class: 'hint', id: 'dumpCount' }, `${S.brainDump.length}/8000 characters`),
      h('div', { class: 'row' }, h('button', { class: 'primary', id: 'orgBtn', disabled: !!ui.busy || S.brainDump.trim().length < 3, onclick: organize }, ui.busy === 'organize' ? h('span', {}, h('span', { class: 'spin' }), ' Organizing…') : hasCards ? 'Re-organize into cards' : 'Organize into cards'),
        hasCards ? h('span', { class: 'hint' }, 'Re-organizing replaces the cards below.') : null),
      hasCards ? h('div', { style: 'margin-top:22px' }, h('h2', {}, 'Your responsibility cards'),
        h('p', { class: 'hint' }, 'Edit anything. Fields marked “suggested” came from the organizer — change or confirm them. You don’t need to fill every field; unknown is fine.'),
        S.cards.map((c) => cardEditor(c)),
        h('div', { class: 'row' }, h('button', { onclick: () => mutate(() => { const c = blankCard(); S.cards.push(c); ui.open['card' + c.id] = true; }) }, '+ Add a responsibility'))) : null,
      h('div', { class: 'stepnav' }, h('button', { onclick: () => go('welcome') }, 'Back'),
        h('button', { class: 'primary', onclick: () => { S.step = 'capacity'; save(); go('capacity'); } }, hasCards ? 'Next: what can you hold?' : 'Skip cards for now')));
  }
  const blankCard = () => ({ id: E.uid(), name: 'New responsibility', category: 'other', hours: null, energy: 'unknown', mental: 'unknown', status: null, deadline: '', notes: '', src: {} });
  async function organize() {
    ui.busy = 'organize'; ui.error = ''; render();
    try {
      let cards = null;
      if (CFG.aiAvailable && SESSION.consentAI) {
        const r = await api('POST', '/api/ai/organize', { text: S.brainDump });
        if (r.aiUsed) { cards = r.cards; S.parsedBy = 'ai'; S.clarification = S.clarification || ''; if (r.clarification_question) ui.error = ''; S.aiQuestion = r.clarification_question || null; }
        else ui.error = 'AI wasn’t available just now, so I used Guided mode (simple rules) instead. You can edit everything.';
      }
      if (!cards) { cards = E.parseBrainDump(S.brainDump); S.parsedBy = 'rules'; }
      S.cards = cards; S.rec = null; save();
    } catch (e) { ui.error = e.message; }
    ui.busy = ''; render();
  }
  function setField(c, key, val) { c[key] = val; if (c.src) delete c.src[key]; save(); render(); }
  function cardEditor(c) {
    const sug = (k) => (c.src && (c.src[k] === 'ai' || c.src[k] === 'auto')) ? h('span', { class: 'chip sug' }, 'suggested') : null;
    const sum = h('div', { style: 'flex:1' }, h('div', { class: 'name' }, c.name),
      h('div', {}, c.status ? h('span', { class: 'chip ' + c.status }, c.status) : h('span', { class: 'chip' }, 'not sorted'), h('span', { class: 'chip' }, E.CATEGORIES[c.category] || 'Other'),
        h('span', { class: 'chip' }, E.num(c.hours) === null ? 'time unknown' : E.hrs(E.num(c.hours))), c.deadline ? h('span', { class: 'chip' }, 'due ' + c.deadline) : null,
        (c.src && (c.src.status === 'ai' || c.src.category === 'ai' || c.src.category === 'auto')) ? h('span', { class: 'chip sug' }, 'some fields suggested') : null));
    const mergeOpts = [['', 'Merge into…'], ...S.cards.filter((x) => x.id !== c.id).map((x) => [x.id, x.name])];
    return det('card' + c.id, 'card', sum,
      h('div', { class: 'grid two' },
        field('Name', textEl('n' + c.id, c.name, (v) => { c.name = v; })),
        field(h('span', {}, 'Category ', sug('category')), selectEl('cat' + c.id, Object.entries(E.CATEGORIES), c.category, (v) => setField(c, 'category', v))),
        field('Time needed this week (hours)', numEl('h' + c.id, c.hours, (v) => setField(c, 'hours', v), 'leave blank if unknown'), 'Only what you know. Blank is never treated as zero.'),
        field(h('span', {}, 'Commitment status ', sug('status')), selectEl('s' + c.id, STAT, c.status || '', (v) => setField(c, 'status', v || null)), 'Fixed = can’t change. Helping someone else isn’t automatically “optional”.'),
        field(h('span', {}, 'Energy it takes ', sug('energy')), selectEl('e' + c.id, LV, c.energy, (v) => setField(c, 'energy', v))),
        field(h('span', {}, 'Mental load ', sug('mental')), selectEl('m' + c.id, LV, c.mental, (v) => setField(c, 'mental', v))),
        field('Deadline (if any)', h('input', { 'data-fk': 'd' + c.id, type: 'date', value: c.deadline || '', onchange: (e) => setField(c, 'deadline', e.target.value) })),
        field('Notes or constraints', textEl('no' + c.id, c.notes, (v) => { c.notes = v; }, 'optional'))),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'small', onclick: () => { if (confirm(`Remove “${c.name}”?`)) mutate(() => { S.cards = S.cards.filter((x) => x.id !== c.id); delete S.scenario[c.id]; }); } }, 'Remove'),
        S.cards.length > 1 ? h('div', { style: 'min-width:180px' }, selectEl('mg' + c.id, mergeOpts, '', (v) => { if (!v) return; const t = cardById(v); mutate(() => { t.name = t.name + ' + ' + c.name; if (E.num(t.hours) !== null || E.num(c.hours) !== null) t.hours = (E.num(t.hours) || 0) + (E.num(c.hours) || 0); t.notes = [t.notes, c.notes].filter(Boolean).join(' / '); S.cards = S.cards.filter((x) => x.id !== c.id); }); })) : null));
  }

  // ----- Step 2
  function capacityForm() {
    const c = S.capacity;
    return h('div', {},
      h('div', { class: 'grid two' },
        h('div', {}, h('label', {}, 'Flexible hours available (next 7 days)'),
          h('div', { class: 'hint' }, 'After your fixed commitments are already handled — hours you could genuinely use. e.g. “two evenings and part of Saturday ≈ 8”.'),
          numEl('hrs', c.hours, (v) => mutateQuiet(() => { c.hours = v; c.hoursUnsure = false; }), 'hours', '0.5'),
          h('label', { class: 'check', style: 'margin-top:8px' }, h('input', { type: 'checkbox', checked: c.hoursUnsure, onchange: (e) => mutateQuiet(() => { c.hoursUnsure = e.target.checked; }) }), 'I’m not sure')),
        h('div', {}, h('label', { id: 'energyLabel' }, 'Energy right now: ' + (c.energy ?? '–') + '/10'),
          h('div', { class: 'hint' }, '1 = running on fumes, 10 = full tank. Your own sense, not a measurement.'),
          h('input', { 'data-fk': 'energy', type: 'range', min: '1', max: '10', value: c.energy ?? 5, oninput: (e) => { c.energy = Number(e.target.value); document.getElementById('energyLabel').textContent = 'Energy right now: ' + c.energy + '/10'; save(); }, onchange: () => render() }),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: c.energy === null, onchange: (e) => mutateQuiet(() => { c.energy = e.target.checked ? null : 5; }) }), 'I’m not sure'))),
      field('Mental bandwidth', selectEl('mental', [['', 'Choose…'], ['low', 'Low — hard to focus or decide'], ['moderate', 'Moderate — can handle a bit more'], ['high', 'High — clear head'], ['unsure', 'Not sure']], c.mental, (v) => mutateQuiet(() => { c.mental = v; })), 'Separate from time and energy: you can have free hours and still have little attention left.'),
      h('div', { class: 'grid two', style: 'margin-top:12px' },
        field('Emotional demands (optional)', textEl('emo', c.emotional, (v) => { c.emotional = v; }, 'Only if you want to share', 'textarea'), 'e.g. a hard conversation coming up, supporting someone through something.'),
        field('Non-negotiables', textEl('nn', c.nonNeg, (v) => { c.nonNeg = v; }, 'What must happen no matter what?', 'textarea')),
        field('Important deadlines or constraints', textEl('cons', c.constraints, (v) => { c.constraints = v; }, 'optional', 'textarea')),
        h('div', {}, field('Rest or recovery you want to protect', textEl('rest', c.rest, (v) => { c.rest = v; }, 'e.g. Sunday afternoon offline'),),
          h('label', { style: 'margin-top:8px' }, 'Hours to protect (optional)'), numEl('resth', c.restHours, (v) => mutateQuiet(() => { c.restHours = v; }), 'hours', '0.5'))));
  }
  const mutateQuiet = (fn) => { fn(); save(); render(); };
  function capacityStep() {
    return h('div', {}, h('div', { class: 'kicker' }, 'Step 2 of 4'), h('h1', {}, 'What can you realistically hold?'),
      h('p', { class: 'lede' }, 'Think about the next seven days. Honest beats optimistic — and “not sure” is a fine answer.'),
      h('div', { class: 'card' }, capacityForm()),
      h('div', { class: 'stepnav' }, h('button', { onclick: () => go('plate') }, 'Back'), h('button', { class: 'primary', onclick: () => { S.step = 'priority'; save(); go('priority'); } }, 'Next: what do you want room for?')));
  }
  // ----- Step 3
  function priorityStep() {
    const ex = ['Rest without feeling behind', 'Working on a creative project', 'Meaningful time with someone', 'Pursuing a business opportunity', 'Moving my body', 'Enjoying my own company', 'A slower morning', 'Making an important decision'];
    return h('div', {}, h('div', { class: 'kicker' }, 'Step 3 of 4'), h('h1', {}, 'What do you want more room for?'),
      h('p', { class: 'lede' }, 'If you had a little more room in your life this week, what would you want to use it for?'),
      h('p', { class: 'hint' }, 'This counts as a real demand on your capacity — not a reward you earn after everything else is done. Choose one.'),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, ex.map((t) => h('button', { class: 'small', onclick: () => mutate(() => { S.priority.text = t; }) }, t))),
      field('In your own words', textEl('prio', S.priority.text, (v) => { S.priority.text = v; }, 'e.g. Finish the first chapter of my book')),
      h('div', { style: 'max-width:260px;margin-top:10px' }, field('Hours you’d like to protect for it (optional)', numEl('prioh', S.priority.hours, (v) => mutateQuiet(() => { S.priority.hours = v; }), 'hours', '0.5'))),
      h('div', { class: 'stepnav' }, h('button', { onclick: () => go('capacity') }, 'Back'), h('button', { class: 'primary', onclick: () => { S.step = 'hd'; save(); go('hd'); } }, 'Next')));
  }
  // ----- Step 4
  function hdStep() {
    const hd = S.hd; const bad = E.hdConsistency(hd, LIB);
    const sel = (key, list) => selectEl('hd' + key, [['', 'Choose…'], ['unsure', 'I’m not sure'], ...list.map((x) => [x, x])], hd[key], (v) => mutate(() => { hd[key] = v; }));
    return h('div', {}, h('div', { class: 'kicker' }, 'Step 4 of 4 · optional'), h('h1', {}, 'Let’s make this personal to you.'),
      h('p', { class: 'lede' }, 'If you use Human Design, you can add your chart details for an extra layer of reflection. Don’t know your Design? No problem. Your Capacity Compass works beautifully without it.'),
      h('div', { class: 'row' }, h('button', { class: hd.use === true ? 'primary' : '', onclick: () => mutate(() => { hd.use = true; }) }, 'Add my Human Design'), h('button', { class: hd.use === false ? 'primary' : '', onclick: () => mutate(() => { hd.use = false; S.hdReflection = null; }) }, 'Skip this step')),
      hd.use ? h('div', { class: 'card hd', style: 'margin-top:14px' },
        h('p', { class: 'hint' }, 'Human Design here is an optional symbolic self-reflection framework — not a scientific measure of health, energy, personality or decision-making ability. Enter only what you know; leave the rest.'),
        h('div', { class: 'grid two' }, field('Type', sel('type', E.HD_TYPES)), field('Strategy', sel('strategy', E.HD_STRATEGIES)), field('Authority', sel('authority', E.HD_AUTHORITIES)), field('Profile (optional)', sel('profile', E.HD_PROFILES))),
        bad ? h('div', { class: 'card warn', role: 'status' }, h('p', {}, bad.message), h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => mutate(() => { hd[bad.fields[1]] = 'unsure'; }) }, `Set ${bad.fields[1]} to “not sure”`),
          h('button', { class: 'small', onclick: () => mutate(() => { hd.type = 'unsure'; }) }, 'Set type to “not sure”'),
          h('button', { class: 'small', onclick: () => { ui.hdAsk = 'skip'; render(); } }, 'Continue — skip the uncertain part'))) : null,
        (LIB && E.hdMatches(hd, LIB).length === 0 && (hd.type || hd.authority)) ? h('p', { class: 'hint' }, 'Heads up: the approved reflection library doesn’t yet have material for these details, so no Human Design reflection will be shown until the founder adds it. Nothing will be invented.') : null) : null,
      h('div', { class: 'stepnav' }, h('button', { onclick: () => go('priority') }, 'Back'),
        h('button', { class: 'primary', disabled: !!ui.busy, onclick: build }, ui.busy === 'build' ? h('span', {}, h('span', { class: 'spin' }), ' Building…') : 'Build my Compass')));
  }
  async function build() {
    ui.busy = 'build'; ui.error = ''; render();
    await refreshRecommendation(true);
    S.step = 'dashboard'; S.scenario = S.scenario || {}; save(); ui.busy = ''; go('dashboard');
  }
  async function refreshRecommendation(quiet) {
    const base = E.recommend(S);
    let rec = { ...base, summary: '', source: 'engine' };
    if (CFG.aiAvailable && SESSION.consentAI && base.kind === 'adjust') {
      try {
        const r = await api('POST', '/api/ai/analyze', { state: S });
        if (r.aiUsed && r.analysis) { rec = { ...base, ...r.analysis, conflicts: base.conflicts, source: 'ai' }; }
        else if (!quiet) ui.error = 'AI wasn’t available, so this recommendation comes from Guided mode.';
      } catch (e) { if (!quiet) ui.error = e.message; }
    }
    S.rec = rec; S.recHash = E.inputsHash(S); S.hdReflection = null; save();
  }

  // ---------- Dashboard ----------
  const MODS = [['a', 'Capacity'], ['b', 'Plate'], ['c', 'Stretch'], ['d', 'Options'], ['e', 'Adjustment'], ['f', 'Reflection'], ['g', 'Boundary'], ['h', 'Next move']];
  function dashboardView() {
    const stale = S.rec && S.recHash !== E.inputsHash(S);
    const nav = h('nav', { class: 'modnav', 'aria-label': 'Dashboard sections' }, MODS.map(([k, l]) => h('button', { class: 'quiet small', onclick: () => document.getElementById('mod-' + k).scrollIntoView({ behavior: 'smooth' }) }, l)));
    return h('div', {}, nav,
      h('div', { style: 'margin-top:24px' }, h('div', { class: 'kicker' }, 'Your Capacity Compass · current assessment'), h('h1', {}, 'Here’s what your week is holding.'),
        h('p', { class: 'hint' }, modeLabel() + '. Time totals are calculated, not guessed. Recommendations are suggestions — you decide.')),
      stale ? h('div', { class: 'card warn', role: 'status' }, h('b', {}, 'Your inputs changed. '), 'The recommendation below may be out of date. Totals above update instantly; recommendations only change when you ask.', h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'small primary', disabled: !!ui.busy, onclick: async () => { ui.busy = 'rec'; render(); await refreshRecommendation(false); ui.busy = ''; render(); } }, ui.busy === 'rec' ? 'Refreshing…' : 'Refresh recommendation'))) : null,
      modA(), modB(), modC(), modD(), modE(), modF(), modG(), modH(),
      h('div', { class: 'stepnav' }, h('button', { onclick: () => go('hd') }, 'Back to my answers'), h('button', { class: 'primary', onclick: () => go('edit') }, 'See my Capacity Edit →')));
  }
  const modHead = (k, kick, title, sub) => h('div', {}, h('h2', {}, h('small', {}, kick), title), sub ? h('p', { class: 'hint' }, sub) : null);

  function modA() {
    const t = E.totals(S); const c = S.capacity;
    const fixed = S.cards.filter((x) => x.status === 'fixed').map((x) => x.name);
    const stat = (n, l) => h('div', { class: 'stat' }, h('div', { class: 'bigstat' }, n), h('small', {}, l));
    const sentence = `You have ${c.hoursUnsure || E.num(c.hours) === null ? 'an unsure amount of' : E.hrs(E.num(c.hours))} of flexible time, ${c.energy === null ? 'energy you’re not sure about' : 'energy around ' + c.energy + '/10'}, and ${c.mental && c.mental !== 'unsure' ? c.mental : 'unsure'} mental bandwidth.${S.priority.text ? ` You want more room for “${S.priority.text}”.` : ''}`;
    return h('section', { class: 'mod', id: 'mod-a' }, modHead('a', 'A', 'Your current capacity'),
      h('div', { class: 'card' }, h('p', { style: 'font-family:var(--serif);font-size:1.15rem' }, sentence),
        h('div', { class: 'stats' }, stat(c.hoursUnsure || E.num(c.hours) === null ? '?' : E.num(c.hours), 'flexible hours'), stat(c.energy ?? '?', 'energy (1–10)'), stat(c.mental && c.mental !== 'unsure' ? c.mental : '?', 'mental bandwidth'), stat(fixed.length, 'fixed obligations')),
        fixed.length ? h('p', { class: 'hint', style: 'margin-top:10px' }, 'Fixed: ' + fixed.join(', ') + '. These are already out of your flexible hours — they aren’t counted again.') : null,
        c.nonNeg ? h('p', { class: 'hint' }, 'Non-negotiables you named: ' + c.nonNeg) : null,
        det('editcap', 'mod', 'Edit capacity & priority', capacityForm(),
          h('div', { class: 'grid two' }, field('What I want more room for', textEl('prio2', S.priority.text, (v) => { S.priority.text = v; })), field('Hours to protect for it', numEl('prio2h', S.priority.hours, (v) => mutateQuiet(() => { S.priority.hours = v; }), 'hours', '0.5'))))));
  }
  function groupCards() {
    const g = { fixed: [], flexible: [], optional: [], undecided: [], unsorted: [], personal: [] };
    for (const c of S.cards) { if (c.category === 'personal') g.personal.push(c); else g[c.status || 'unsorted'].push(c); }
    return g;
  }
  function modB() {
    const g = groupCards(); const t = E.totals(S);
    const sect = (title, hint, list) => list.length ? h('div', {}, h('h3', { style: 'margin-top:14px' }, title, ' ', h('span', { class: 'chip' }, list.length)), hint ? h('p', { class: 'hint' }, hint) : null, list.map(cardEditor)) : null;
    return h('section', { class: 'mod', id: 'mod-b' }, modHead('b', 'B', 'What’s on your plate', 'Essential obligations (fixed) are kept separate from commitments you’ve said can change.'),
      sect('Fixed responsibilities', 'Can’t change. Shown for context; not subtracted from your flexible hours again.', g.fixed),
      sect('Flexible commitments', 'Could move or change shape.', g.flexible), sect('Optional commitments', 'You’ve said you could let these go.', g.optional),
      sect('Unresolved decisions', null, g.undecided), sect('Personal priorities & goals', null, g.personal),
      g.unsorted.length ? sect('Not sorted yet', 'I won’t assume whether these are fixed or adjustable — they’re left out of the totals until you sort them.', g.unsorted) : null,
      S.priority.text ? h('div', { class: 'card tint' }, h('b', {}, 'What you want more room for: '), S.priority.text, S.priority.hours ? ` (≈ ${E.hrs(S.priority.hours)})` : '') : null,
      h('div', { class: 'row' }, h('button', { onclick: () => mutate(() => { const c = blankCard(); S.cards.push(c); ui.open['card' + c.id] = true; }) }, '+ Add a responsibility')),
      h('p', { class: 'hint' }, E.describeTotals(t)));
  }
  function clarificationQuestion() {
    const t = E.totals(S);
    const bad = E.hdConsistency(S.hd, LIB);
    if (bad) return { q: bad.message, kind: 'hd' };
    if (S.aiQuestion && !S.clarification) return { q: S.aiQuestion, kind: 'text' };
    if (t.unsorted.length) return { q: `Which of your ${t.unsorted.length} unsorted item${t.unsorted.length > 1 ? 's' : ''} can’t change at all? Sorting them sharpens everything here.`, kind: 'sort' };
    if (t.unknownIds.length >= 2) return { q: `About how long might “${nm(t.unknownIds[0])}” take this week? Even a rough guess helps — or leave it unknown.`, kind: 'hours', id: t.unknownIds[0] };
    return null;
  }
  function modC() {
    const cons = E.conflicts(S); const t = E.totals(S); const q = clarificationQuestion();
    return h('section', { class: 'mod', id: 'mod-c' }, modHead('c', 'C', 'Where your capacity is being stretched', 'Only what’s supported by your own inputs. Time maths is calculated, not guessed.'),
      h('div', { class: 'card olive' }, h('p', {}, E.describeTotals(t)),
        t.status !== 'unknown' ? h('div', { class: 'stats' }, [['Available', E.hrs(t.available)], ['Rest protected', E.hrs(t.rest)], ['Listed demands' + (t.partial ? ' (partial)' : ''), E.hrs(t.known + t.priorityHours)], [t.over ? 'Over by' : 'Left over', E.hrs(t.over ? t.gap : Math.max(0, t.remaining))]].map(([l, n]) => h('div', { class: 'stat' }, h('div', { class: 'bigstat', style: 'font-size:1.3rem' }, n), h('small', {}, l)))) : null),
      cons.length ? cons.map((c) => h('div', { class: 'card' }, h('h3', {}, c.title), h('p', {}, c.what),
        h('b', {}, 'What supports this'), h('ul', { class: 'ev' }, c.evidence.map((e) => h('li', {}, e))),
        c.uncertain.length ? h('div', {}, h('b', {}, 'Still uncertain'), h('ul', { class: 'ev' }, c.uncertain.map((e) => h('li', {}, e)))) : null,
        h('p', { class: 'hint' }, 'Why it may be worth addressing: ' + c.why)))
        : h('div', { class: 'card tint' }, h('h3', {}, 'No clear conflict'), h('p', {}, 'Based on what you shared, nothing is clearly overloaded. I’m not going to manufacture a problem — the useful question is how to protect the capacity you already have.')),
      q ? h('div', { class: 'card warn' }, h('b', {}, 'One question that would sharpen this'), h('p', {}, q.q),
        q.kind === 'text' ? h('div', {}, textEl('clar', S.clarification, (v) => { S.clarification = v; }, 'Your answer (optional)'), h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'small', onclick: () => mutate(() => { S.aiQuestion = null; }) }, 'Skip this question')))
          : q.kind === 'sort' ? h('button', { class: 'small', onclick: () => document.getElementById('mod-b').scrollIntoView({ behavior: 'smooth' }) }, 'Go sort my cards')
            : q.kind === 'hours' ? h('div', { style: 'max-width:200px' }, numEl('qh', null, (v) => { if (v !== null) setField(cardById(q.id), 'hours', v); }, 'hours')) : null) : null);
  }

  function qualitative(c, a) {
    const heavy = c.energy === 'high' || c.mental === 'high';
    const m = { keep: 'No change to your load.', reduce: 'A smaller version would likely lighten the effort and the mental tracking.', reschedule: 'Moving it could ease this week’s pressure, but it still exists later — check it doesn’t just pile up.', delegate: 'Sharing could lighten both time and mental load — only if someone is actually willing and able. I’m not assuming anyone is.', renegotiate: 'A renegotiated scope or date could reduce pressure, depending on how the other person responds.', decline: 'Letting go could remove both the time and the background mental load, and may bring a moment of discomfort.' }[a];
    return m + (heavy && a !== 'keep' ? ' This item is marked high-demand, so the relief could be more than the hours suggest.' : '');
  }
  function modD() {
    const list = S.cards.filter(E.isAdjustable);
    const t0 = E.totals(S, 'original'), th = E.totals(S, 'hypothetical'), tc = E.totals(S, 'confirmed');
    const remTxt = (t) => (t.status === 'unknown' ? 'n/a' : t.over ? 'over by ' + E.hrs(t.gap) : E.hrs(Math.max(0, t.remaining)) + ' left');
    return h('section', { class: 'mod', id: 'mod-d' }, modHead('d', 'D', 'Explore your options', 'Try changes on commitments you’ve said can change. Everything here is hypothetical until you confirm it — your original assessment is always preserved.'),
      !list.length ? h('div', { class: 'card' }, h('p', {}, 'Nothing here is marked flexible, optional or undecided yet. Sort your cards above to explore options. Fixed obligations aren’t offered for change.')) : list.map((c) => {
        const a = S.scenario[c.id] || { action: 'keep', impact: null, confirmed: false };
        const h0 = E.num(c.hours); const eff = E.effectiveImpact(c, a);
        return h('div', { class: 'card' }, h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', { style: 'font-family:var(--serif);font-size:1.05rem' }, c.name), h('span', {}, h('span', { class: 'chip ' + c.status }, c.status), h('span', { class: 'chip' }, hrs(c.hours)))),
          h('div', { class: 'grid two' },
            field('What if I…', selectEl('act' + c.id, Object.entries(E.ACTIONS), a.action, (v) => mutate(() => { S.scenario[c.id] = { action: v, impact: null, confirmed: false }; }))),
            a.action !== 'keep' ? field('Hours this would free (editable)', numEl('imp' + c.id, a.impact !== null && a.impact !== undefined ? a.impact : (E.defaultImpact(c, a.action)), (v) => mutate(() => { S.scenario[c.id] = { ...a, impact: v, confirmed: false }; }), h0 === null ? 'add an hours estimate first' : 'you decide'), h0 === null ? 'This item has no time estimate, so I can’t calculate an effect.' : a.action === 'delegate' || a.action === 'reduce' || a.action === 'renegotiate' ? 'I don’t know how much this would free — enter your best estimate.' : null) : null),
          a.action !== 'keep' ? h('div', {}, h('p', { class: 'hint' }, qualitative(c, a.action)),
            h('p', {}, h('span', { class: 'chip hyp' }, a.confirmed ? 'confirmed' : 'hypothetical'), eff !== null ? ` Frees about ${E.hrs(eff)} if it works out.` : ' Time effect unknown.'),
            h('div', { class: 'row' }, !a.confirmed ? h('button', { class: 'small primary', onclick: () => mutate(() => { S.scenario[c.id] = { ...a, confirmed: true }; }) }, 'Confirm this change') : h('button', { class: 'small', onclick: () => mutate(() => { S.scenario[c.id] = { ...a, confirmed: false }; }) }, 'Un-confirm'),
              h('button', { class: 'small quiet', onclick: () => mutate(() => { delete S.scenario[c.id]; }) }, 'Undo'))) : null);
      }),
      list.length ? h('div', { class: 'card' }, h('h3', {}, 'Compare'), h('div', { class: 'cmp' },
        h('div', {}, h('small', {}, 'Original assessment'), h('div', { class: 'n' }, remTxt(t0))), h('div', {}, h('small', {}, 'If all explored changes happen (hypothetical)'), h('div', { class: 'n' }, remTxt(th)), h('small', {}, `frees ≈ ${E.hrs(th.freed)}`)),
        h('div', {}, h('small', {}, 'Confirmed changes only'), h('div', { class: 'n' }, remTxt(tc)), h('small', {}, `frees ≈ ${E.hrs(tc.freed)}`))),
        t0.partial ? h('p', { class: 'hint' }, 'Totals are partial estimates — items with unknown time or no sorting aren’t included.') : null) : null);
  }

  function modE() {
    const rec = S.rec; const d = S.decision || {};
    if (!rec) return h('section', { class: 'mod', id: 'mod-e' }, modHead('e', 'E', 'Your recommended adjustment'), h('div', { class: 'card' }, h('button', { class: 'primary', onclick: async () => { ui.busy = 'rec'; render(); await refreshRecommendation(false); ui.busy = ''; render(); } }, 'Generate recommendation')));
    const opts = rec.options || [];
    const accept = (o) => mutate(() => {
      S.decision = { status: 'accepted', optionId: o.id, cardId: o.cardId, action: o.action, title: o.title, why: o.why };
      if (o.cardId && o.action !== 'protect') S.scenario[o.cardId] = { action: o.action, impact: E.defaultImpact(cardById(o.cardId), o.action), confirmed: true };
      S.next = null; S.hdReflection = null;
    });
    const optCard = (o, primary) => h('div', { class: 'card' + (primary ? ' tint' : '') },
      h('div', { class: 'kicker' }, primary ? 'Recommended starting point' : 'Alternative'), h('h3', {}, o.title),
      h('p', {}, o.why), o.consequence ? h('p', { class: 'hint' }, 'Effort: ' + o.effort + '. ' + o.consequence) : null,
      o.hypothetical ? h('p', {}, h('span', { class: 'chip hyp' }, 'hypothetical'), o.impactHours != null ? ` Could free about ${E.hrs(o.impactHours)} — only if it goes through.` : '') : null,
      d.optionId === o.id && d.status === 'accepted' ? h('p', {}, h('span', { class: 'chip flexible' }, 'accepted')) : null,
      h('div', { class: 'row' }, h('button', { class: 'small primary', onclick: () => accept(o) }, primary ? 'Accept this' : 'Choose this instead'),
        h('button', { class: 'small', onclick: () => { ui.open['edit' + o.id] = !ui.open['edit' + o.id]; render(); } }, 'Edit wording')),
      ui.open['edit' + o.id] ? h('div', { style: 'margin-top:8px' }, textEl('et' + o.id, o.title, (v) => { o.title = v; if (d.optionId === o.id) d.title = v; }, '', 'textarea')) : null);
    return h('section', { class: 'mod', id: 'mod-e' }, modHead('e', 'E', 'Your recommended adjustment', 'One realistic place to start — chosen to protect essentials, respect your constraints and support what you want more room for.'),
      rec.summary ? h('div', { class: 'card olive' }, h('p', {}, rec.summary), rec.assumptions && rec.assumptions.length ? h('ul', { class: 'ev' }, rec.assumptions.map((a) => h('li', {}, a))) : null) : null,
      rec.note ? h('div', { class: 'card tint' }, h('p', {}, rec.note)) : null,
      rec.safety ? h('div', { class: 'card warn' }, h('p', {}, 'Something you wrote suggests that changing things could carry risk. Please weigh safety first; I’ve kept recommendations gentle and you’re never obligated to act.')) : null,
      opts.map((o, i) => optCard(o, i === 0)),
      h('div', { class: 'card' }, h('h3', {}, 'None of these fit?'), h('p', { class: 'hint' }, 'You can reject the recommendation and choose your own — or decide not to change anything this week. Both are legitimate.'),
        h('div', { class: 'grid two' }, field('Responsibility', selectEl('cc', [['', '— none —'], ...S.cards.filter((c) => E.isAdjustable(c)).map((c) => [c.id, c.name])], d.status === 'custom' ? d.cardId || '' : '', (v) => mutate(() => { S.customCard = v; }))),
          field('What I’ll do', selectEl('ca', Object.entries(E.ACTIONS).filter(([k]) => k !== 'keep'), S.customAction || 'reduce', (v) => mutate(() => { S.customAction = v; })))),
        h('div', { class: 'row' }, h('button', { class: 'small primary', onclick: () => mutate(() => {
          const cid = S.customCard; const act = S.customAction || 'reduce'; const c = cardById(cid);
          if (!c) return; S.decision = { status: 'custom', cardId: cid, action: act, title: `${E.ACTIONS[act]}: “${c.name}”`, why: 'My own choice.' }; S.scenario[cid] = { action: act, impact: E.defaultImpact(c, act), confirmed: true }; S.next = null;
        }) }, 'Use my choice'),
        h('button', { class: 'small', onclick: () => mutate(() => { S.decision = { status: 'rejected', title: 'I’ve decided not to change a commitment this week.', cardId: null }; S.next = null; }) }, 'Change nothing this week'))),
      d.status ? h('p', { class: 'hint' }, `Current choice: ${d.status === 'rejected' ? 'no change this week' : d.title}`) : null);
  }

  function modF() {
    if (!S.hd.use) return null;
    const matches = LIB ? E.hdMatches(S.hd, LIB) : [];
    const d = S.decision || {}; const c = cardById(d.cardId);
    const shown = S.hdReflection && !S.hdDismissed;
    return h('section', { class: 'mod', id: 'mod-f' }, modHead('f', 'F', 'Your Human Design reflection', 'Kept separate from the practical recommendation above. Optional, symbolic, and never a substitute for your real capacity, deadlines, safety or judgment.'),
      !matches.length ? h('div', { class: 'card hd' }, h('p', {}, 'No approved reflection material is available yet for the details you entered, so I’m not offering one. I won’t improvise Human Design interpretations.'),
        h('p', { class: 'hint' }, 'Founder note: approve entries in /admin to switch this on — see the launch checklist in the README.'))
        : S.hdDismissed ? h('div', { class: 'card hd' }, h('p', {}, 'Reflection dismissed.'), h('button', { class: 'small', onclick: () => mutate(() => { S.hdDismissed = false; }) }, 'Show it again'))
          : !shown ? h('div', { class: 'card hd' }, h('button', { class: 'primary', disabled: !!ui.busy, onclick: async () => {
            ui.busy = 'hd'; render();
            let r = E.hdFallback(S.hd, LIB, c && c.name); r.source = 'library';
            if (CFG.aiAvailable && SESSION.consentAI) { try { const x = await api('POST', '/api/ai/hd', { state: S }); if (x.aiUsed && x.reflection.available) r = x.reflection; } catch (e) { /* keep library version */ } }
            S.hdReflection = { prompts: r.prompts, source: r.source, selected: true }; ui.busy = ''; save(); render();
          } }, ui.busy === 'hd' ? 'Preparing…' : 'Show my reflection'))
            : h('div', { class: 'card hd' },
              h('div', { class: 'kicker' }, 'Reflection — not a recommendation'),
              S.hdReflection.prompts.map((p) => h('div', {}, h('p', { style: 'font-family:var(--serif);font-size:1.1rem' }, p.text), h('p', { class: 'hint' }, 'Source: founder-approved library' + (p.source_label ? ' (' + p.source_label + ')' : '')))),
              h('p', { class: 'hint' }, 'Notice whether this resonates with your experience. If this reflection is useful, consider it alongside the practical picture — your actual capacity, deadlines and obligations come first.'),
              h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.hdReflection.selected !== false, onchange: (e) => mutate(() => { S.hdReflection.selected = e.target.checked; }) }), 'Include in my Capacity Edit'),
              h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'small', onclick: () => mutate(() => { S.hdDismissed = true; }) }, 'Dismiss'))));
  }

  function modG() {
    const b = S.boundary; const flags = E.stateSafety(S);
    const sr = b.safeResult;
    const opts = [['', 'Choose a responsibility…'], ...S.cards.map((c) => [c.id, c.name])];
    if (!b.cardId && S.decision && S.decision.cardId) b.cardId = S.decision.cardId;
    return h('section', { class: 'mod', id: 'mod-g' }, modHead('g', 'G', 'The Boundary Builder', 'Optional. Draft something you might say — or choose a personal action that needs no one else’s agreement.'),
      h('div', { class: 'card' }, h('div', { class: 'grid two' },
        field('About which responsibility?', selectEl('bc', opts, b.cardId, (v) => mutate(() => { b.cardId = v; }))),
        field('What kind of change?', selectEl('bk', [['', 'Choose…'], ...Object.entries(E.BOUNDARY_KINDS)], b.kind, (v) => mutate(() => { b.kind = v; }))),
        field('Who is it for? (optional)', textEl('bp', b.person, (v) => { b.person = v; }, 'a name')),
        field('What you can realistically offer (optional)', textEl('bo', b.offer, (v) => { b.offer = v; }, 'Only if true — I won’t invent one')),
        field('Reason you want to share (optional)', textEl('br', b.reason, (v) => { b.reason = v; }, 'Short and honest'))),
        h('label', { class: 'check', style: 'margin-top:10px' }, h('input', { type: 'checkbox', checked: !!b.safety, onchange: (e) => mutate(() => { b.safety = e.target.checked; }) }), 'Speaking up here could feel unsafe, or might lead to retaliation or punishment.'),
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'primary', disabled: !b.kind || !!ui.busy, onclick: draftScripts }, ui.busy === 'bd' ? 'Drafting…' : b.scripts.length ? 'Redraft options' : 'Draft my options'),
          flags.length ? h('span', { class: 'hint' }, 'Safety check active.') : null)),
      sr ? h('div', { class: 'card warn', role: 'status' }, h('h3', {}, 'Let’s slow down'), h('p', {}, sr.message), h('ul', { class: 'ev' }, sr.alternatives.map((a) => h('li', {}, a)))) : null,
      b.rejected ? h('p', { class: 'hint' }, 'You skipped scripts. That’s fine — your next move can be a private action instead.') : null,
      b.scripts.length ? h('div', {}, b.scripts.map((s, i) => h('div', { class: 'card' + (b.chosen === s.tone ? ' tint' : '') },
        h('h3', {}, s.label), h('div', {}, h('textarea', { 'data-fk': 'sct' + i, 'aria-label': s.label + ' script', value: s.text, oninput: (e) => { s.text = e.target.value; save(); } }, s.text)),
        h('div', { class: 'copyrow' }, h('button', { class: 'small', onclick: () => copy(s.text) }, 'Copy'),
          h('button', { class: 'small ' + (b.chosen === s.tone ? 'primary' : ''), onclick: () => mutate(() => { b.chosen = s.tone; }) }, b.chosen === s.tone ? 'Selected for my plan' : 'Use this one')))),
        b.personalAction ? h('div', { class: 'card olive' }, h('h3', {}, 'A private option'), h('div', {}, h('textarea', { 'data-fk': 'pa', 'aria-label': 'Personal action', value: b.personalAction, oninput: (e) => { b.personalAction = e.target.value; save(); } }, b.personalAction)),
          h('div', { class: 'copyrow' }, h('button', { class: 'small', onclick: () => copy(b.personalAction) }, 'Copy'), h('button', { class: 'small ' + (b.chosen === 'personal' ? 'primary' : ''), onclick: () => mutate(() => { b.chosen = 'personal'; }) }, b.chosen === 'personal' ? 'Selected for my plan' : 'Use this instead'))) : null,
        h('p', { class: 'hint' }, b.source === 'ai' ? 'Drafted with AI from only what you entered. Edit freely; [brackets] are details only you can fill in.' : 'Built from templates (not AI). Edit freely; [brackets] are details only you can fill in.'),
        h('div', { class: 'row' }, CFG.aiAvailable && SESSION.consentAI ? ['Shorter', 'Softer', 'More direct'].map((w) => h('button', { class: 'small', disabled: !!ui.busy, onclick: () => draftScripts(w) }, 'Rewrite: ' + w.toLowerCase())) : null,
          h('button', { class: 'small quiet', onclick: () => mutate(() => { b.scripts = []; b.chosen = ''; b.rejected = true; b.personalAction = ''; }) }, 'Not for me — reject these'))) : null);
  }
  async function draftScripts(rewrite) {
    const b = S.boundary; ui.busy = 'bd'; ui.error = ''; render();
    const req = { cardId: b.cardId, kind: b.kind, person: b.person, offer: b.offer, reason: b.reason, safety: !!b.safety, rewrite: typeof rewrite === 'string' ? rewrite : '', current: b.scripts.length && typeof rewrite === 'string' ? b.scripts.map((s) => s.text).join('\n---\n') : '' };
    try {
      let res = null;
      if (CFG.aiAvailable && SESSION.consentAI) { const r = await api('POST', '/api/ai/boundary', { state: S, request: req }); if (r.aiUsed) res = r.result; }
      if (!res) {
        const flags = E.stateSafety({ ...S, boundary: { ...b, safety: b.safety } });
        if (flags.length) res = E.safetyResponse(flags);
        else { const c = cardById(b.cardId); const t = E.boundaryTemplates({ kind: b.kind, thing: c ? c.name : '', person: b.person, offer: b.offer, reason: b.reason, priority: S.priority.text }); res = { scripts: t.scripts, personal_action: t.personal_action, source: 'template' }; }
      }
      b.rejected = false;
      if (res.safe_mode) { b.safeResult = res; b.scripts = []; b.personalAction = ''; b.chosen = ''; } else { b.safeResult = null; b.scripts = res.scripts; b.personalAction = res.personal_action || ''; b.source = res.source; b.chosen = b.chosen && (b.chosen === 'personal' || res.scripts.find((s) => s.tone === b.chosen)) ? b.chosen : ''; }
      save();
    } catch (e) { ui.error = e.message; }
    ui.busy = ''; render();
  }

  function modH() {
    const d = S.decision || {};
    if (!S.next) { const n0 = E.nextMoveDefault(S); if (n0) { n0.confirmed = false; S.next = n0; } }
    if (S.next && S.next.auto && !S.next.confirmed) { const n1 = E.nextMoveDefault(S); if (n1) { S.next.what = n1.what; S.next.cardId = n1.cardId; } }
    const n = S.next;
    return h('section', { class: 'mod', id: 'mod-h' }, modHead('h', 'H', 'Your next move', 'One thing, within seven days. Not a new assignment.'),
      !d.status ? h('div', { class: 'card' }, h('p', {}, 'Choose or accept an adjustment above (or choose “change nothing”), and I’ll suggest one next move.'),
        h('button', { class: 'small', onclick: () => mutate(() => { S.next = { what: '', cardId: null, when: '', priority: S.priority.text, confirmed: false }; }) }, 'Write my own'))
        : !n ? h('div', { class: 'card' }, h('button', { class: 'small', onclick: () => mutate(() => { S.next = { what: '', cardId: null, when: '', priority: S.priority.text, confirmed: false }; }) }, 'Write my own'))
          : h('div', { class: 'card' + (n.confirmed ? ' olive' : '') },
            field('What I will do', textEl('nw', n.what, (v) => { n.what = v; n.confirmed = false; n.auto = false; }, '', 'textarea')),
            h('div', { class: 'grid two' }, field('Related responsibility', selectEl('nc', [['', '— none —'], ...S.cards.map((c) => [c.id, c.name])], n.cardId || '', (v) => mutate(() => { n.cardId = v || null; }))),
              field('When (optional)', textEl('nwhen', n.when, (v) => { n.when = v; }, 'e.g. Thursday after lunch'))),
            h('p', { class: 'hint' }, S.priority.text ? 'Supports: ' + S.priority.text : 'Supports your priority: (add one in step 3)'),
            h('div', { class: 'row' }, h('button', { class: 'primary small', onclick: () => mutate(() => { n.confirmed = true; }) }, n.confirmed ? 'Confirmed ✓' : 'Confirm my next move'),
              h('button', { class: 'small', onclick: () => mutate(() => { S.next = { what: '', cardId: null, when: '', priority: S.priority.text, confirmed: false }; }) }, 'Replace with my own'))));
  }

  // ---------- Capacity Edit ----------
  function editSections() {
    const t = E.totals(S, 'original'); const d = S.decision || {}; const b = S.boundary; const n = S.next; const c0 = S.capacity;
    const cons = E.conflicts(S);
    const g = groupCards();
    const line = (c) => `• ${c.name}${E.num(c.hours) !== null ? ' (' + E.hrs(E.num(c.hours)) + ')' : ''}`;
    const plate = [['Fixed', g.fixed], ['Flexible', g.flexible], ['Optional', g.optional], ['Undecided', g.undecided], ['Personal', g.personal], ['Not yet sorted', g.unsorted]].filter(([, l]) => l.length).map(([k, l]) => k + ':\n' + l.map(line).join('\n')).join('\n');
    const chosenScript = b.chosen === 'personal' ? b.personalAction : (b.scripts.find((s) => s.tone === b.chosen) || {}).text;
    const sec = [];
    sec.push(['capacity', 'My current capacity', `${c0.hoursUnsure || E.num(c0.hours) === null ? 'Flexible time: not sure' : 'Flexible time: about ' + E.hrs(E.num(c0.hours))} · Energy: ${c0.energy === null ? 'not sure' : c0.energy + '/10'} · Mental bandwidth: ${c0.mental && c0.mental !== 'unsure' ? c0.mental : 'not sure'}${c0.rest ? '\nProtecting: ' + c0.rest : ''}${c0.nonNeg ? '\nNon-negotiable: ' + c0.nonNeg : ''}`]);
    sec.push(['plate', 'What’s taking up my capacity', plate + `\n${E.describeTotals(t)}`]);
    sec.push(['conflict', 'My main capacity conflict', cons.length ? `${cons[0].title}. ${cons[0].what}` : 'No clear conflict — my current capacity looks sufficient, so my focus is protecting it.']);
    sec.push(['room', 'What I want more room for', S.priority.text ? S.priority.text + (S.priority.hours ? ` (about ${E.hrs(S.priority.hours)} protected)` : '') : 'Not specified yet.']);
    if (S.hd.use && S.hdReflection && !S.hdDismissed && S.hdReflection.selected !== false && S.hdReflection.prompts.length) sec.push(['hd', 'My Human Design reflection (optional, symbolic)', S.hdReflection.prompts.map((p) => p.text).join('\n')]);
    sec.push(['adjust', 'The adjustment I’ve chosen', d.status === 'rejected' ? 'I’m choosing not to change a commitment this week.' : d.title ? d.title + (d.status === 'custom' ? ' (my own choice)' : '') : 'Not chosen yet.']);
    if (chosenScript) sec.push(['script', b.chosen === 'personal' ? 'My personal action' : 'My boundary script', chosenScript]);
    sec.push(['next', 'My next move', n && n.what ? `${n.what}${n.cardId ? '\nRelated to: ' + nm(n.cardId) : ''}${n.when ? '\nWhen: ' + n.when : ''}${S.priority.text ? '\nSupports: ' + S.priority.text : ''}${n.confirmed ? '' : '\n(not yet confirmed)'}` : 'Not chosen yet.']);
    return sec;
  }
  function editView() {
    const secs = editSections().map(([k, t, txt]) => [k, t, S.edit[k] !== undefined ? S.edit[k] : txt]);
    const full = ['My Capacity Edit — The Capacity Compass', '', ...secs.flatMap(([, t, x]) => [t.toUpperCase(), x, '']), 'What would become possible if you kept making room for what matters to you?'].join('\n');
    return h('div', { style: 'margin-top:18px' },
      h('div', { class: 'row noprint', style: 'margin-bottom:12px' }, h('button', { onclick: () => go('dashboard') }, '← Back to dashboard'), h('button', { class: 'primary', onclick: () => copy(full) }, 'Copy'), h('button', { class: 'primary', onclick: () => window.print() }, 'Print / Save as PDF')),
      h('p', { class: 'hint noprint' }, 'Tap any text to edit it. This reflects only choices you’ve confirmed. To save as PDF, choose “Save as PDF” as the destination in the print dialog.'),
      h('article', { class: 'sheet' }, h('div', { class: 'kicker' }, 'Renew You Living'), h('h1', {}, 'My Capacity Edit'), h('p', { class: 'hint' }, 'A snapshot of my week · ' + new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
        secs.map(([k, t, x]) => h('div', { class: 'sec' }, h('h3', {}, t), h('div', { contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': t, oninput: (e) => { S.edit[k] = e.target.innerText; save(); } }, x))),
        h('p', { class: 'closing' }, 'What would become possible if you kept making room for what matters to you?'),
        h('div', { class: 'invite noprint' }, h('p', {}, 'You have identified one way to make more room for yourself. If you want support practicing these decisions, trusting yourself and changing the patterns that keep putting your priorities last, explore The Art of Being You.'),
          CFG.coachingUrl ? h('a', { class: 'btn', href: CFG.coachingUrl, rel: 'noopener' }, 'Explore The Art of Being You') : (CFG.accessMode === 'test' ? h('p', { class: 'hint' }, '(Test mode: COACHING_URL is not configured, so no link is shown.)') : null))));
  }

  // ---------- boot ----------
  async function boot() {
    try { CFG = await api('GET', '/api/config'); } catch (e) { CFG = {}; }
    const url = new URL(location.href); const token = url.searchParams.get('token');
    if (token) {
      history.replaceState({}, '', '/');
      try { await api('POST', '/api/auth/verify', { token }); } catch (e) { ui.error = e.message; }
    }
    try { SESSION = await api('GET', '/api/session'); } catch (e) { SESSION = { authenticated: false }; }
    if (!SESSION.authenticated) { SESSION = null; return go('login'); }
    try { const l = await api('GET', '/api/library'); LIB = l; } catch (e) { LIB = null; }
    try { const r = await api('GET', '/api/assessment'); if (r.state && r.state.cards) S = Object.assign(E.newState(), r.state); } catch (e) { /* new */ }
    if (S.step === 'dashboard' && S.cards.length) go('dashboard'); else if (S.cards.length || S.consentSeen) go(S.step && S.step !== 'dashboard' ? S.step : 'plate'); else go('welcome');
  }
  boot();
})();
