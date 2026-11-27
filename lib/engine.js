/* The Capacity Compass — deterministic engine (Engine 2 maths + fallbacks).
 * Shared by browser (window.CCEngine) and server/tests (require). No AI in here.
 * Rules enforced here:
 *  - Fixed commitments are NEVER subtracted: "flexible hours" is already net of them.
 *  - Unknown hour estimates are NEVER treated as zero: they are counted and totals are labelled partial.
 *  - Cards with no commitment status ("unsorted") are excluded from the demand total and reported as uncertainty.
 *  - Hypothetical changes are computed separately from confirmed ones; the original assessment is preserved.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CATEGORIES = {
    work: 'Work & business', family: 'Family & caregiving', home: 'Home & household',
    health: 'Health & body', social: 'Relationships & social', admin: 'Admin & money',
    personal: 'Personal goal', decision: 'Decision to make', other: 'Other'
  };
  const STATUSES = ['fixed', 'flexible', 'optional', 'undecided'];
  const LEVELS = ['low', 'moderate', 'high', 'unknown'];
  const ACTIONS = {
    keep: 'Keep as is', reduce: 'Reduce scope', reschedule: 'Reschedule',
    delegate: 'Delegate or share', renegotiate: 'Renegotiate', decline: 'Decline or remove'
  };
  const BOUNDARY_KINDS = {
    more_time: 'Ask for more time before deciding',
    decline: 'Decline a request',
    availability: 'Change my availability',
    share: 'Ask someone to share a responsibility',
    scope: 'Renegotiate the scope',
    need: 'Communicate a need or preference',
    own_limit: 'Create a limit around my own behavior',
    protect: 'Protect time for my personal priority'
  };

  const num = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
  const r1 = (n) => Math.round(n * 10) / 10;
  const uid = (p = 'c') => p + '_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
  const isAdjustable = (c) => STATUSES.indexOf(c.status) > 0; // flexible | optional | undecided
  const hrs = (h) => (h === 1 ? '1 hour' : r1(h) + ' hours');

  // ---------- Safety ----------
  const SAFETY_RE = /\b(retaliat\w*|threat\w*|abus\w*|violen\w*|coerc\w*|stalk\w*|afraid of|scared of|fear for|unsafe|not safe|hurt me|hit me|punish\w*|controlling|he'?ll (?:explode|snap|get angry)|will (?:fire|retaliate)|blackmail\w*)\b/i;
  function detectSafety(text) {
    const m = String(text || '').match(SAFETY_RE);
    return m ? [`Possible safety concern mentioned ("${m[0]}")`] : [];
  }
  function stateSafety(state) {
    const t = [state.brainDump, state.capacity && state.capacity.emotional, state.capacity && state.capacity.constraints,
      ...(state.cards || []).map((c) => c.notes), state.boundary && state.boundary.reason].join(' \n ');
    const flags = detectSafety(t);
    if (state.boundary && state.boundary.safety) flags.push('You indicated that communicating this might feel unsafe or lead to retaliation');
    return flags;
  }

  // ---------- Brain-dump parser (Guided mode, no AI) ----------
  const CAT_WORDS = [
    ['decision', /\b(decide|decision|whether|should i|figure out|choose|undecided)\b/i],
    ['personal', /\b(want to|keep postponing|wish i|my own|creative|paint\w*|novel|hobby|workout|learn)\b/i],
    ['health', /\b(doctor|dentist|therapy|appointment|gym|health|sleep|medical|surgery|physio)\b/i],
    ['family', /\b(kid|kids|child|children|mom|dad|mother|father|parent|school|daughter|son|husband|partner|caregiv|elder)\w*/i],
    ['home', /\b(laundry|clean|cook|meal|grocer|house|home|repair|errand|dishes)\w*/i],
    ['admin', /\b(tax|invoice|bill|budget|insurance|paperwork|bookkeep|admin|payroll)\w*/i],
    ['social', /\b(friend|party|dinner with|wedding|birthday|coffee with|visit|host|rsvp|committee|volunteer|club)\w*/i],
    ['work', /\b(client|work|project|launch|deadline|meeting|call|email|proposal|team|boss|business|webinar|deliver)\w*/i]
  ];
  function guessCategory(t) { for (const [k, re] of CAT_WORDS) if (re.test(t)) return k; return 'other'; }
  function statedHours(t) {
    let m = String(t).match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i);
    if (m) return { hours: Number(m[1]), evidence: m[0] };
    m = String(t).match(/(\d+)\s*(?:min|mins|minutes?)\b/i);
    if (m) return { hours: r1(Number(m[1]) / 60), evidence: m[0] };
    return null;
  }
  function parseBrainDump(text) {
    let items = String(text || '').split(/\r?\n|;|•/).map((s) => s.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    if (items.length === 1 && items[0].includes(',')) items = items[0].split(/,\s*(?:and\s+)?/i).map((s) => s.trim()).filter(Boolean);
    return items.slice(0, 40).map((t) => {
      const h = statedHours(t);
      const clean = h ? t.replace(/\s*[(,-]?\s*(?:about|around|roughly|~)?\s*\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|min|mins|minutes?)\b\)?/i, '').replace(/\s{2,}/g, ' ').trim() || t : t;
      return {
        id: uid(), name: clean.length > 80 ? clean.slice(0, 77) + '…' : clean, category: guessCategory(t),
        hours: h ? h.hours : null, energy: 'unknown', mental: 'unknown', status: null, deadline: '',
        notes: t.length > 80 || clean !== t ? t : '', src: { category: 'auto', hours: h ? 'text' : '' }
      };
    });
  }

  // ---------- Totals ----------
  function adjFor(state, id, mode) {
    const a = state.scenario && state.scenario[id];
    if (!a || a.action === 'keep' || mode === 'original') return null;
    if (mode === 'confirmed' && !a.confirmed) return null;
    return a;
  }
  function defaultImpact(card, action) {
    const h = num(card.hours);
    if (h === null) return null;
    if (action === 'decline' || action === 'reschedule') return h; // leaves this week's load
    return null; // reduce / delegate / renegotiate: the user must say how much — we never assume
  }
  function effectiveImpact(card, adj) {
    const h = num(card.hours);
    if (h === null) return null;
    const own = num(adj.impact);
    const v = own !== null ? own : defaultImpact(card, adj.action);
    return v === null ? null : Math.max(0, Math.min(v, h));
  }
  /** mode: 'original' | 'hypothetical' (all explored changes) | 'confirmed' (only confirmed changes) */
  function totals(state, mode = 'original') {
    const cap = state.capacity || {};
    const avail = cap.hoursUnsure ? null : num(cap.hours);
    const rest = num(cap.restHours) || 0;
    let known = 0, freed = 0, unknownIds = [], unsorted = [], fixedKnown = 0, fixedUnknown = 0, unsortedHours = 0;
    for (const c of state.cards || []) {
      const h = num(c.hours);
      if (c.status === 'fixed') { if (h === null) fixedUnknown++; else fixedKnown += h; continue; } // info only
      if (!isAdjustable(c)) { unsorted.push(c.id); if (h !== null) unsortedHours += h; continue; }
      if (h === null) { unknownIds.push(c.id); continue; }
      let eff = h;
      const adj = adjFor(state, c.id, mode);
      if (adj) { const imp = effectiveImpact(c, adj); if (imp !== null) { eff = h - imp; freed += imp; } }
      known += eff;
    }
    const prio = num(state.priority && state.priority.hours) || 0;
    const remaining = avail === null ? null : r1(avail - rest - known - prio);
    return {
      available: avail, rest, known: r1(known), priorityHours: prio, freed: r1(freed),
      unknownIds, unsorted, unsortedHours: r1(unsortedHours), fixedKnown: r1(fixedKnown), fixedUnknown,
      remaining, over: remaining !== null && remaining < 0,
      gap: remaining !== null && remaining < 0 ? r1(-remaining) : 0,
      partial: unknownIds.length > 0 || unsorted.length > 0,
      status: avail === null ? 'unknown' : remaining < 0 ? 'over' : 'within'
    };
  }
  function describeTotals(t) {
    if (t.status === 'unknown') return 'You weren’t sure how many flexible hours you have, so I can’t compare time yet. Everything else below still works.';
    const bits = [`${hrs(t.available)} flexible`];
    if (t.rest) bits.push(`${hrs(t.rest)} protected for rest`);
    const demand = `${hrs(t.known + t.priorityHours)} of listed demands${t.priorityHours ? ` (including ${hrs(t.priorityHours)} for what you want more room for)` : ''}`;
    let s = `${bits.join(', ')} versus ${demand}. `;
    s += t.over ? `That’s about ${hrs(t.gap)} more than you’ve said you can hold.` : `That fits within your stated flexible time, with about ${hrs(Math.max(0, t.remaining))} left over.`;
    if (t.partial) {
      const parts = [];
      if (t.unknownIds.length) parts.push(`${t.unknownIds.length} item${t.unknownIds.length > 1 ? 's have' : ' has'} no time estimate`);
      if (t.unsorted.length) parts.push(`${t.unsorted.length} item${t.unsorted.length > 1 ? 's are' : ' is'} not yet sorted as fixed or adjustable`);
      s += ` This is a partial estimate — ${parts.join(' and ')}, so the real total is likely higher.`;
    }
    return s;
  }

  // ---------- Conflicts (max 3, all grounded in inputs) ----------
  function daysUntil(iso, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const a = Date.parse(iso + 'T00:00:00Z'); const b = Date.parse((today || new Date().toISOString().slice(0, 10)) + 'T00:00:00Z');
    return Math.round((a - b) / 86400000);
  }
  function conflicts(state, today) {
    const out = [];
    const cards = state.cards || [];
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    const cap = state.capacity || {};
    const t = totals(state, 'original');
    const adj = cards.filter(isAdjustable);
    const nm = (c) => `“${c.name}”`;

    if (t.status === 'over') {
      const ev = adj.filter((c) => num(c.hours) !== null).map((c) => `${nm(c)} ≈ ${hrs(num(c.hours))} (${c.status})`);
      if (t.priorityHours) ev.push(`What you want more room for (${state.priority.text || 'your priority'}) ≈ ${hrs(t.priorityHours)}`);
      if (t.rest) ev.push(`Rest you want to protect ≈ ${hrs(t.rest)}`);
      ev.push(`Flexible time you reported: ${hrs(t.available)} (fixed commitments are already out of this number, so they aren’t counted again)`);
      out.push({
        id: 'time', type: 'time', title: 'Your listed demands add up to more than your flexible time',
        what: `Estimated demands total ${hrs(t.known + t.priorityHours + t.rest)} against ${hrs(t.available)} of flexible time — roughly ${hrs(t.gap)} over.`,
        evidence: ev, ids: adj.filter((c) => num(c.hours) !== null).map((c) => c.id),
        uncertain: [t.unknownIds.length ? `${t.unknownIds.length} item(s) have no time estimate and aren’t in the total` : null,
          t.unsorted.length ? `${t.unsorted.length} item(s) aren’t sorted yet (not counted)` : null,
          'Estimates are yours — they may be generous or tight'].filter(Boolean),
        why: 'Seeing the size of the gap tells you whether this is a small adjustment or a bigger conversation.'
      });
      const soon = adj.filter((c) => { const d = daysUntil(c.deadline, today); return d !== null && d >= 0 && d <= 7 && c.status !== 'optional'; });
      if (soon.length) out.push({
        id: 'deadline', type: 'deadline', title: 'A deadline falls inside this tight week',
        what: `${soon.map(nm).join(', ')} ${soon.length > 1 ? 'have' : 'has'} a deadline within seven days while your time is already over-committed.`,
        evidence: soon.map((c) => `${nm(c)} — due ${c.deadline}`), ids: soon.map((c) => c.id),
        uncertain: ['I don’t know how flexible the deadline really is'], why: 'Deadlines limit what can move, so they shape which adjustment is realistic.'
      });
    }
    const lowCap = (num(cap.energy) !== null && num(cap.energy) <= 4) || cap.mental === 'low';
    const heavy = cards.filter((c) => c.energy === 'high' || c.mental === 'high');
    if (lowCap && heavy.length >= 1) {
      out.push({
        id: 'energy', type: 'energy', title: 'Demanding items meet limited energy or attention',
        what: `You reported ${num(cap.energy) !== null ? 'energy ' + cap.energy + '/10' : ''}${num(cap.energy) !== null && cap.mental ? ' and ' : ''}${cap.mental && cap.mental !== 'unsure' ? cap.mental + ' mental bandwidth' : ''}, while ${heavy.length} item${heavy.length > 1 ? 's are' : ' is'} marked high-demand. Having hours free doesn’t mean having the energy for them.`,
        evidence: heavy.map((c) => `${nm(c)} — energy ${c.energy}, mental load ${c.mental}${c.status ? ' (' + c.status + ')' : ''}`),
        ids: heavy.map((c) => c.id), uncertain: ['Energy and attention can shift during the week; this is a snapshot'],
        why: 'Time and energy are different resources — the plan should fit both.'
      });
    }
    const optional = cards.filter((c) => c.status === 'optional' && c.category !== 'personal');
    if (state.priority && state.priority.text && optional.length >= 2) {
      out.push({
        id: 'priority', type: 'priority', title: 'Your priority is competing with several optional commitments',
        what: `You want more room for “${state.priority.text}”, and you’ve marked ${optional.length} commitments as optional.`,
        evidence: optional.map((c) => `${nm(c)} (optional${num(c.hours) !== null ? ', ≈ ' + hrs(num(c.hours)) : ''})`),
        ids: optional.map((c) => c.id), uncertain: ['I don’t know how much each optional item matters to you'],
        why: 'Optional items are the most natural place to find room without touching anything essential.'
      });
    }
    const undec = cards.filter((c) => c.status === 'undecided');
    if (undec.length >= 3) {
      out.push({
        id: 'decisions', type: 'decisions', title: 'Several open decisions are taking up attention',
        what: `${undec.length} items are still undecided. Unfinished decisions often use mental space before any time is spent on them.`,
        evidence: undec.map((c) => `${nm(c)} (undecided)`), ids: undec.map((c) => c.id),
        uncertain: ['I don’t know which decisions have real deadlines'], why: 'Deciding — or deciding when to decide — can free attention quickly.'
      });
    }
    return out.slice(0, 3).map((c) => ({ ...c, ids: c.ids.filter((i) => byId[i]) }));
  }

  // ---------- Recommendation (deterministic candidates; AI may re-rank/re-word) ----------
  function recommend(state, today) {
    const cards = state.cards || [];
    const cons = conflicts(state, today);
    const t = totals(state, 'original');
    const inConflict = new Set(cons.flatMap((c) => c.ids));
    const safety = stateSafety(state);
    const eligible = cards.filter((c) => isAdjustable(c) && c.category !== 'personal');
    const scored = eligible.map((c) => {
      let s = 0; const h = num(c.hours);
      if (inConflict.has(c.id)) s += 3;
      if (h !== null) s += Math.min(h, 6) / 2;
      s += c.status === 'optional' ? 3 : c.status === 'undecided' ? 2 : 1;
      const d = daysUntil(c.deadline, today);
      if (d !== null && d >= 0 && d <= 7 && c.status !== 'optional') s -= 3;
      return { c, s };
    }).sort((a, b) => b.s - a.s);
    const primaryAction = (c) => (c.status === 'optional' ? 'decline' : c.status === 'undecided' ? 'renegotiate' : 'reschedule');
    const altAction = (c) => (c.status === 'optional' ? 'reduce' : c.status === 'undecided' ? 'decline' : 'delegate');
    const mk = (id, c, action) => {
      const h = num(c.hours); const imp = defaultImpact(c, action);
      const verb = { decline: 'Step back from', reduce: 'Shrink the scope of', reschedule: 'Move to a later week:', delegate: 'Ask whether someone could share', renegotiate: c.status === 'undecided' ? 'Ask for more time on' : 'Renegotiate' }[action];
      const bits = [];
      if (inConflict.has(c.id)) bits.push(`it appears in the ${cons.filter((x) => x.ids.includes(c.id)).map((x) => x.type)[0]} conflict above`);
      bits.push(`you marked it ${c.status}`);
      if (h !== null) bits.push(`you estimated about ${hrs(h)}`);
      const why = `I picked “${c.name}” because ${bits.join(', ')}. ` +
        (c.status === 'optional' ? 'Optional items are the lowest-risk place to make room. ' : c.status === 'undecided' ? 'Asking for time to decide is a small, low-risk move. ' : 'Moving something flexible is usually easier than dropping it. ') +
        (imp !== null && t.status === 'over' ? `If it works out, that could free about ${hrs(imp)} of your ~${hrs(t.gap)} gap — this is hypothetical until you confirm it.` : 'The time effect depends on what you actually negotiate.');
      return {
        id, cardId: c.id, action, title: `${verb} “${c.name}”`, why, effort: c.status === 'optional' ? 'low' : 'medium',
        consequence: c.status === 'optional' ? 'May disappoint someone briefly; no essential obligation is touched.' : 'Needs a conversation or a rescheduling; no essential obligation is touched.',
        impactHours: imp, hypothetical: true, source: 'engine'
      };
    };
    const res = { kind: 'adjust', conflicts: cons, options: [], note: '' };
    if (safety.length) res.safety = safety;
    if (!cons.length && !(scored.length === 0 && cards.some((c) => c.status === 'fixed'))) {
      res.kind = 'preserve';
      res.note = 'Nothing in what you shared points to a clear conflict, so there’s no reason to remove anything. The most useful move is to protect what’s already working.';
      res.options = [{ id: 'rec1', cardId: null, action: 'protect', title: state.priority && state.priority.text ? `Put time for “${state.priority.text}” on your calendar before it fills with other things` : 'Notice what is working and protect it for the week', why: 'Your current capacity looks sufficient, so the aim is to keep it that way.', effort: 'low', consequence: 'Nothing is removed.', impactHours: null, hypothetical: false, source: 'engine' }];
      return res;
    }
    if (!scored.length) {
      res.kind = 'constrained';
      res.note = 'Everything on your plate looks essential or is not yet sorted, so I don’t see a responsible place to cut. That’s a real constraint, not a failure. You’re not obligated to solve every demand — and if you want, sort the cards so I can look again.';
      res.options = [{ id: 'rec1', cardId: null, action: 'protect', title: 'Choose one small thing that is only for you this week, and let everything else stay as it is', why: 'With little flexibility, a small protected pocket matters more than a big change.', effort: 'low', consequence: 'Nothing is removed.', impactHours: null, hypothetical: false, source: 'engine' }];
      return res;
    }
    const top = scored[0].c;
    res.options.push(mk('rec1', top, primaryAction(top)));
    if (scored[1]) res.options.push(mk('rec2', scored[1].c, primaryAction(scored[1].c)));
    if (altAction(top) !== primaryAction(top)) res.options.push(mk('rec3', top, altAction(top)));
    res.options = res.options.slice(0, 3);
    return res;
  }

  function nextMoveDefault(state) {
    const d = state.decision || {};
    const card = (state.cards || []).find((c) => c.id === d.cardId);
    const pr = state.priority && state.priority.text;
    if (d.status === 'rejected' || !d.title) return null;
    const b = state.boundary || {}; const nmx = card ? card.name : 'this commitment';
    const what = b.chosen === 'personal' ? `Take my private step about “${nmx}”` : b.chosen ? `Send my message about “${nmx}”` : d.title;
    return { what, cardId: d.cardId || null, when: '', priority: pr || '', auto: true };
  }

  // ---------- Human Design (library-driven; nothing invented) ----------
  const HD_TYPES = ['Manifestor', 'Generator', 'Manifesting Generator', 'Projector', 'Reflector'];
  const HD_STRATEGIES = ['To Inform', 'To Respond', 'To Respond, then Inform', 'Wait for the Invitation', 'Wait a Lunar Cycle'];
  const HD_AUTHORITIES = ['Emotional', 'Sacral', 'Splenic', 'Ego (Manifested)', 'Ego (Projected)', 'Self-Projected', 'Mental / Environmental', 'Lunar'];
  const HD_PROFILES = ['1/3', '1/4', '2/4', '2/5', '3/5', '3/6', '4/6', '4/1', '5/1', '5/2', '6/2', '6/3'];
  const norm = (s) => String(s || '').trim().toLowerCase();
  /** Maps a provider's Properties to our four labels. Anything it can't map confidently is returned as '' (never guessed). */
  function normalizeChart(p) {
    p = p || {}; const t = norm(p.Type).replace(/\s+/g, ' ');
    const type = HD_TYPES.find((x) => norm(x) === t) || (t.includes('manifesting') ? 'Manifesting Generator' : t.includes('manifestor') ? 'Manifestor' : t.includes('generator') ? 'Generator' : t.includes('projector') ? 'Projector' : t.includes('reflector') ? 'Reflector' : '');
    const st = norm(p.Strategy);
    const strategy = !st ? '' : st.includes('respond') && st.includes('inform') ? 'To Respond, then Inform' : st.includes('respond') ? 'To Respond' : st.includes('inform') ? 'To Inform' : st.includes('invit') ? 'Wait for the Invitation' : st.includes('lunar') ? 'Wait a Lunar Cycle' : '';
    const a = norm(p.InnerAuthority);
    let authority = '';
    if (a.includes('sacral')) authority = 'Sacral'; else if (a.includes('emotion') || a.includes('solar')) authority = 'Emotional'; else if (a.includes('splen')) authority = 'Splenic';
    else if (a.includes('self')) authority = 'Self-Projected'; else if (a.includes('lunar')) authority = 'Lunar';
    else if (a.includes('mental') || a.includes('environment') || a.includes('no inner') || a === 'none') authority = 'Mental / Environmental';
    else if (a.includes('ego') || a.includes('heart')) authority = a.includes('project') ? 'Ego (Projected)' : a.includes('manifest') ? 'Ego (Manifested)' : type === 'Projector' ? 'Ego (Projected)' : type === 'Manifestor' ? 'Ego (Manifested)' : '';
    const m = String(p.Profile || '').match(/(\d)\s*[\/\\]\s*(\d)/); const profile = m && HD_PROFILES.includes(m[1] + '/' + m[2]) ? m[1] + '/' + m[2] : '';
    return { type, strategy, authority, profile };
  }

  /** rules come from the (founder-editable) library; returns the single most material contradiction, or null */
  function hdConsistency(hd, library) {
    if (!hd || !hd.use) return null;
    const rules = (library && library.consistency_rules) || {};
    const t = hd.type && hd.type !== 'unsure' ? hd.type : null;
    const r = t ? rules[t] : null;
    if (!r) return null;
    if (hd.authority && hd.authority !== 'unsure' && r.authorities && !r.authorities.map(norm).includes(norm(hd.authority)))
      return { fields: ['type', 'authority'], message: `${t} and ${hd.authority} authority don’t normally appear together in a chart. Which of the two would you like to double-check? (You can also continue without either — I’ll skip the uncertain part.)` };
    if (hd.strategy && hd.strategy !== 'unsure' && r.strategies && !r.strategies.map(norm).includes(norm(hd.strategy)))
      return { fields: ['type', 'strategy'], message: `Strategy “${hd.strategy}” doesn’t usually pair with ${t}. Would you like to double-check one of them? (Or continue — I’ll skip the uncertain part.)` };
    return null;
  }
  function hdMatches(hd, library) {
    if (!hd || !hd.use || !library) return [];
    const bad = hdConsistency(hd, library);
    const skip = new Set(bad ? bad.fields : []);
    const wants = [];
    if (hd.type && hd.type !== 'unsure' && !skip.has('type')) wants.push(['type', hd.type]);
    if (hd.strategy && hd.strategy !== 'unsure' && !skip.has('strategy')) wants.push(['strategy', hd.strategy]);
    if (hd.authority && hd.authority !== 'unsure' && !skip.has('authority')) wants.push(['authority', hd.authority]);
    if (hd.profile && hd.profile !== 'unsure') wants.push(['profile', hd.profile]);
    return (library.entries || []).filter((e) => e.status === 'approved' && e.reflective_questions && e.reflective_questions.length &&
      wants.some(([k, v]) => e.kind === k && norm(e.key) === norm(v)));
  }
  /** no-AI reflection: approved founder questions verbatim, with the decision named. */
  function hdFallback(hd, library, cardName) {
    const ms = hdMatches(hd, library);
    const prompts = [];
    for (const e of ms) for (const q of e.reflective_questions) prompts.push({ text: String(q).replace(/\{responsibility\}/g, cardName || 'this commitment'), source_entry_ids: [e.id], source_label: `${e.kind}: ${e.key}` });
    return { prompts: prompts.slice(0, 2), available: ms.length > 0 };
  }

  // ---------- Boundary templates (used when AI is off or unavailable; never invent facts) ----------
  function boundaryTemplates(o) {
    const thing = o.thing || 'this'; const to = o.person ? o.person.trim() : '';
    const hi = to ? `Hi ${to},` : 'Hi,';
    const reason = o.reason ? ` ${o.reason.replace(/\.?$/, '.')}` : '';
    const offer = o.offer ? o.offer.replace(/\.?$/, '.') : null;
    const ph = '[add what you can realistically offer — or delete this line]';
    const T = {
      more_time: {
        warm: `${hi} thank you for thinking of me for ${thing}. I want to give it a real answer, so I’d like a little time to think. Can I get back to you by [day]?`,
        direct: `${hi} I’m not able to answer on ${thing} yet. I’ll give you a clear answer by [day].`,
        collaborative: `${hi} I’d like to say yes or no properly on ${thing}. Could I have until [day]? ${offer || 'If you need an answer sooner, tell me and we can work out what’s possible.'}`
      },
      decline: {
        warm: `${hi} thank you so much for asking me about ${thing}. I’m not able to take it on right now.${reason} I appreciate you thinking of me.`,
        direct: `${hi} I won’t be able to do ${thing}.${reason} I wanted to tell you now so you can plan around it.`,
        collaborative: `${hi} I can’t take on ${thing} as it’s described.${reason} ${offer || ph}`
      },
      availability: {
        warm: `${hi} I wanted to let you know about a change in my availability for ${thing}. From [date], I’ll be available [times].${reason} Thank you for working with me on it.`,
        direct: `${hi} my availability for ${thing} is changing. From [date], I’m available [times]. Outside of that, I won’t be able to respond or attend.`,
        collaborative: `${hi} I need to adjust my availability for ${thing}: I can do [times]. ${offer || 'Does that work, or is there a version of this schedule that suits us both?'}`
      },
      share: {
        warm: `${hi} I’d love your help with ${thing}. I’ve been carrying it on my own and I’d like to share it.${reason} Would you be willing to take [specific part]?`,
        direct: `${hi} I need ${thing} to be shared. Can you take [specific part] starting [when]?`,
        collaborative: `${hi} I’d like us to split ${thing}. What I can keep doing: [your part]. What I’d like help with: [their part]. ${offer || 'What feels workable from your side?'}`
      },
      scope: {
        warm: `${hi} I’m glad to keep working on ${thing}, and I want to be sure I do it well. To do that, I need to adjust the scope.${reason} Could we talk about [what changes]?`,
        direct: `${hi} I can’t deliver ${thing} at its current scope.${reason} What I can commit to is [smaller scope]. Please confirm whether that works.`,
        collaborative: `${hi} I’d like to rework the scope of ${thing} so it’s sustainable for me. ${offer || ph} Can we find a version that works for both of us?`
      },
      need: {
        warm: `${hi} I wanted to share something that would help me with ${thing}: [your need].${reason} Thank you for hearing me out.`,
        direct: `${hi} regarding ${thing}, what I need is [your need].${reason}`,
        collaborative: `${hi} about ${thing}, I’ve realised I need [your need]. ${offer || 'Can we figure out together how to make that possible?'}`
      },
      protect: {
        warm: `${hi} I’m setting aside [time] for something that matters to me, so I won’t be available then.${reason} Thank you for understanding.`,
        direct: `${hi} I’m not available [time]. I’ll respond or help outside those hours.`,
        collaborative: `${hi} I’m protecting [time] this week. ${offer || 'If something urgent comes up in that window, let me know and we can work out whether it truly can’t wait.'}`
      }
    };
    const own = {
      own_limit: `For this one, no message may be needed. A limit with yourself: “For the next seven days, I will [specific limit] around ${thing}, and I’ll notice what changes.”`,
      protect: `Personal version: block [time] in your calendar for “${o.priority || 'what you want more room for'}” and treat it like an appointment with someone you respect.`
    };
    const kind = T[o.kind] ? o.kind : (o.kind === 'own_limit' ? null : 'need');
    const scripts = kind ? [
      { tone: 'warm', label: 'Warm and considerate', text: T[kind].warm },
      { tone: 'direct', label: 'Clear and direct', text: T[kind].direct },
      { tone: 'collaborative', label: 'Collaborative', text: T[kind].collaborative }
    ] : [];
    return { scripts, personal_action: own[o.kind] || null };
  }
  function safetyResponse(flags) {
    return {
      safe_mode: true, scripts: [], flags,
      message: 'Something you shared suggests that speaking up could carry risk. I’m not going to draft a confrontation script, because your safety matters more than a clean boundary.',
      alternatives: [
        'Take no action yet. Not changing anything this week is a legitimate choice.',
        'Talk it through with someone you trust, or a counselor or advocate, before deciding what to say or whether to say it.',
        'If you’re in immediate danger, contact local emergency services. In the US, the National Domestic Violence Hotline is 1-800-799-7233 (or text START to 88788); elsewhere, a local support line can help you plan.',
        'If you do want to change something, consider a low-visibility step that doesn’t require anyone’s agreement — such as quietly protecting a small block of time.'
      ]
    };
  }

  function inputsHash(state) {
    const s = JSON.stringify([(state.cards || []).map((c) => [c.id, c.name, c.category, c.hours, c.energy, c.mental, c.status, c.deadline, c.notes]),
      state.capacity, state.priority, state.hd, state.clarification]);
    let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return String(h >>> 0);
  }

  function newState() {
    return {
      v: 1, step: 'plate', brainDump: '', cards: [],
      capacity: { hours: null, hoursUnsure: false, energy: null, mental: '', emotional: '', nonNeg: '', constraints: '', rest: '', restHours: null },
      priority: { text: '', hours: null }, hd: { use: null, type: '', strategy: '', authority: '', profile: '' },
      scenario: {}, rec: null, recHash: null, decision: { status: null }, boundary: { kind: '', cardId: '', person: '', offer: '', reason: '', safety: false, scripts: [], chosen: '' },
      next: null, hdReflection: null, hdDismissed: false, clarification: '', edit: {}, parsedBy: ''
    };
  }

  return { CATEGORIES, STATUSES, LEVELS, ACTIONS, BOUNDARY_KINDS, HD_TYPES, HD_STRATEGIES, HD_AUTHORITIES, HD_PROFILES,
    num, r1, uid, hrs, isAdjustable, detectSafety, stateSafety, parseBrainDump, statedHours, guessCategory, totals, describeTotals,
    defaultImpact, effectiveImpact, daysUntil, conflicts, recommend, nextMoveDefault, hdConsistency, hdMatches, hdFallback, normalizeChart,
    boundaryTemplates, safetyResponse, inputsHash, newState };
});
