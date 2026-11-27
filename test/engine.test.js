'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../lib/engine');
const fs = require('fs'); const path = require('path');
const LIB = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/hd-library.json'), 'utf8'));
const TODAY = '2026-11-27';

const card = (o) => ({ id: o.id || E.uid(), name: 'x', category: 'work', hours: null, energy: 'unknown', mental: 'unknown', status: null, deadline: '', notes: '', src: {}, ...o });
const st = (cards, cap = {}, prio = {}, hd = {}) => ({ ...E.newState(), cards, capacity: { ...E.newState().capacity, hours: 10, energy: 6, mental: 'moderate', ...cap }, priority: { text: '', hours: null, ...prio }, hd: { use: false, ...hd } });

test('S1 business owner: client work + creative time -> time conflict, recommends adjustable item, never the fixed one', () => {
  const s = st([card({ id: 'a', name: 'Client launch', hours: 6, status: 'fixed', deadline: '2026-11-30' }), card({ id: 'b', name: 'Podcast guesting', hours: 4, status: 'optional' }), card({ id: 'c', name: 'Newsletter', hours: 3, status: 'flexible' }), card({ id: 'd', name: 'Admin catch-up', hours: 4, status: 'flexible' })],
    { hours: 8 }, { text: 'Creative writing time', hours: 3 });
  const t = E.totals(s); assert.equal(t.known, 11); assert.equal(t.over, true); assert.equal(t.gap, 6); // 11 + 3 prio - 8 = 6
  const r = E.recommend(s, TODAY); assert.equal(r.kind, 'adjust'); assert.ok(r.options.every((o) => o.cardId !== 'a'));
  assert.ok(E.conflicts(s, TODAY).find((c) => c.type === 'time'));
});
test('S2 caregiving, almost no flexible time: all fixed -> constrained, no pressure to cut', () => {
  const s = st([card({ name: 'Care for dad', hours: 30, status: 'fixed' }), card({ name: 'Work shifts', hours: 30, status: 'fixed' })], { hours: 1 });
  const r = E.recommend(s, TODAY); assert.equal(r.kind, 'constrained'); assert.match(r.note, /not obligated/);
  assert.equal(E.totals(s).known, 0);
});
test('S3 several optional commitments compete with priority', () => {
  const s = st([card({ id: '1', name: 'Book club', hours: 2, status: 'optional' }), card({ id: '2', name: 'Bake sale', hours: 3, status: 'optional' })], { hours: 20 }, { text: 'Painting' });
  const c = E.conflicts(s, TODAY); assert.ok(c.find((x) => x.type === 'priority'));
  assert.ok(c.find((x) => x.type === 'priority').evidence.length === 2);
});
test('S4 unknown estimates are NOT zero; totals labelled partial', () => {
  const s = st([card({ name: 'A', hours: 2, status: 'flexible' }), card({ name: 'B', hours: null, status: 'flexible' })], { hours: 3 });
  const t = E.totals(s); assert.equal(t.known, 2); assert.equal(t.unknownIds.length, 1); assert.equal(t.partial, true);
  assert.match(E.describeTotals(t), /partial estimate/); assert.match(E.describeTotals(t), /no time estimate/);
});
test('S5 time available but low energy & mental -> energy conflict, not time conflict', () => {
  const s = st([card({ name: 'Big proposal', hours: 3, status: 'flexible', energy: 'high', mental: 'high' })], { hours: 20, energy: 3, mental: 'low' });
  const c = E.conflicts(s, TODAY); assert.ok(c.find((x) => x.type === 'energy')); assert.ok(!c.find((x) => x.type === 'time'));
});
test('fixed commitments are not subtracted twice (flexible hours already net)', () => {
  const s = st([card({ name: 'Fixed', hours: 50, status: 'fixed' }), card({ name: 'Flex', hours: 4, status: 'flexible' })], { hours: 5 });
  const t = E.totals(s); assert.equal(t.remaining, 1); assert.equal(t.fixedKnown, 50); assert.equal(t.over, false);
});
test('unsorted cards are excluded from demand and flagged, never assumed', () => {
  const s = st([card({ name: 'Mystery', hours: 9 })], { hours: 3 });
  const t = E.totals(s); assert.equal(t.known, 0); assert.equal(t.unsorted.length, 1); assert.equal(t.partial, true);
});
test('time calculations remain accurate after edits', () => {
  const s = st([card({ id: 'a', hours: 4, status: 'optional' })], { hours: 3 });
  assert.equal(E.totals(s).gap, 1);
  s.cards[0].hours = 2; assert.equal(E.totals(s).remaining, 1);
  s.capacity.hours = 1; assert.equal(E.totals(s).gap, 1);
});
test('hypothetical vs confirmed: scenario never alters original; undo restores', () => {
  const s = st([card({ id: 'a', hours: 4, status: 'optional' })], { hours: 3 });
  s.scenario.a = { action: 'decline', impact: null, confirmed: false };
  assert.equal(E.totals(s, 'original').gap, 1); assert.equal(E.totals(s, 'hypothetical').remaining, 3); assert.equal(E.totals(s, 'confirmed').gap, 1);
  s.scenario.a.confirmed = true; assert.equal(E.totals(s, 'confirmed').remaining, 3);
  delete s.scenario.a; assert.equal(E.totals(s, 'hypothetical').gap, 1);
});
test('delegate/reduce never assume impact; user-entered impact is clamped to the hours that exist', () => {
  const c = card({ hours: 3, status: 'flexible' });
  assert.equal(E.effectiveImpact(c, { action: 'delegate', impact: null }), null);
  assert.equal(E.effectiveImpact(c, { action: 'reduce', impact: 10 }), 3);
  assert.equal(E.effectiveImpact(card({ hours: null }), { action: 'decline', impact: 2 }), null);
});
test('S12 sufficient capacity: no manufactured conflict, nothing removed', () => {
  const s = st([card({ name: 'Calls', hours: 3, status: 'fixed' }), card({ name: 'Blog', hours: 2, status: 'flexible' })], { hours: 10, energy: 8, mental: 'high' }, { text: 'Long walks', hours: 2 });
  assert.equal(E.conflicts(s, TODAY).length, 0);
  const r = E.recommend(s, TODAY); assert.equal(r.kind, 'preserve'); assert.equal(r.options[0].cardId, null);
});
test('conflicts capped at 3 and each cites inputs', () => {
  const cards = [card({ id: '1', name: 'A', hours: 9, status: 'optional', energy: 'high', deadline: '2026-11-29' }), card({ id: '2', name: 'B', hours: 3, status: 'optional' }), card({ id: '3', name: 'C', status: 'undecided' }), card({ id: '4', name: 'D', status: 'undecided' }), card({ id: '5', name: 'E', status: 'undecided' })];
  const c = E.conflicts(st(cards, { hours: 2, energy: 2 }, { text: 'Rest' }), TODAY); assert.ok(c.length <= 3); c.forEach((x) => assert.ok(x.evidence.length && x.what && x.why));
});
test('unsure hours: no time comparison is invented', () => {
  const s = st([card({ hours: 5, status: 'flexible' })], { hours: null, hoursUnsure: true });
  assert.equal(E.totals(s).status, 'unknown'); assert.equal(E.conflicts(s, TODAY).find((c) => c.type === 'time'), undefined);
});
test('parser: only explicitly stated hours are extracted', () => {
  const cards = E.parseBrainDump('Client call about 2 hours\nLaundry\n- Tax prep 90 minutes');
  assert.equal(cards.length, 3); assert.equal(cards[0].hours, 2); assert.equal(cards[1].hours, null); assert.equal(cards[2].hours, 1.5);
  assert.ok(cards.every((c) => c.status === null)); // never invents commitment status
});
test('S6/S7: HD skipped -> no matches; only Type+Authority works; empty library -> no fabricated reflection', () => {
  assert.deepEqual(E.hdMatches({ use: false }, LIB), []);
  assert.deepEqual(E.hdMatches({ use: true, type: 'Projector', authority: 'Emotional' }, LIB), []); // nothing approved in shipped library
  const lib = JSON.parse(JSON.stringify(LIB)); const e = lib.entries.find((x) => x.id === 'auth-emotional'); e.status = 'approved'; e.reflective_questions = ['Before deciding on {responsibility}, what do you notice over time?'];
  const m = E.hdMatches({ use: true, type: 'Projector', authority: 'Emotional' }, lib); assert.equal(m.length, 1);
  const fb = E.hdFallback({ use: true, type: 'Projector', authority: 'Emotional' }, lib, 'Board role'); assert.match(fb.prompts[0].text, /Board role/);
  e.status = 'draft'; assert.deepEqual(E.hdMatches({ use: true, authority: 'Emotional' }, lib), []); // drafts never used
});
test('S8 contradictory HD: one clarification; uncertain part skipped', () => {
  const bad = E.hdConsistency({ use: true, type: 'Reflector', authority: 'Sacral' }, LIB); assert.ok(bad); assert.deepEqual(bad.fields, ['type', 'authority']);
  assert.equal(E.hdConsistency({ use: true, type: 'Generator', authority: 'Sacral', strategy: 'To Respond' }, LIB), null);
  const lib = JSON.parse(JSON.stringify(LIB)); lib.entries.find((x) => x.id === 'auth-sacral').status = 'approved'; lib.entries.find((x) => x.id === 'auth-sacral').reflective_questions = ['q'];
  assert.deepEqual(E.hdMatches({ use: true, type: 'Reflector', authority: 'Sacral' }, lib), []); // contradicted field dropped
});
test('S9 HD never changes the practical recommendation', () => {
  const base = st([card({ id: 'a', hours: 6, status: 'optional' }), card({ id: 'f', hours: 5, status: 'fixed' })], { hours: 4 });
  const a = E.recommend(base, TODAY); const b = E.recommend({ ...base, hd: { use: true, type: 'Generator', authority: 'Sacral', strategy: 'To Respond' } }, TODAY);
  assert.deepEqual(a.options.map((o) => [o.cardId, o.action]), b.options.map((o) => [o.cardId, o.action]));
});
test('S11 retaliation: safety flagged; no scripts generated', () => {
  const s = st([card({ name: 'Ask boss for fewer shifts', notes: 'I’m afraid of retaliation if I say anything', status: 'flexible' })]);
  assert.ok(E.stateSafety(s).length); const r = E.safetyResponse(E.stateSafety(s)); assert.equal(r.scripts.length, 0); assert.ok(r.alternatives.length >= 3);
  s.cards[0].notes = ''; s.boundary.safety = true; assert.ok(E.stateSafety(s).length);
});
test('boundary templates: 3 tones, reflect selected situation, do not invent offers', () => {
  const t = E.boundaryTemplates({ kind: 'decline', thing: 'chairing the gala', person: 'Maya' });
  assert.equal(t.scripts.length, 3); assert.ok(t.scripts.every((x) => x.text.includes('chairing the gala'))); assert.match(t.scripts[2].text, /\[add what you can realistically offer/);
  const o = E.boundaryTemplates({ kind: 'decline', thing: 'x', offer: 'I can send a template.' }); assert.match(o.scripts[2].text, /send a template/);
  const own = E.boundaryTemplates({ kind: 'own_limit', thing: 'checking email' }); assert.equal(own.scripts.length, 0); assert.ok(own.personal_action);
});
test('recommendation prefers optional over flexible, avoids near-deadline items', () => {
  const s = st([card({ id: 'f1', name: 'Flex due soon', hours: 3, status: 'flexible', deadline: '2026-11-28' }), card({ id: 'f', name: 'Flex', hours: 3, status: 'flexible' }), card({ id: 'o2', name: 'Opt2', hours: 3, status: 'optional' })], { hours: 3 });
  const r = E.recommend(s, TODAY); assert.equal(r.options[0].cardId, 'o2'); assert.notEqual(r.options[1].cardId, 'f1');
});
test('inputsHash changes on input edits (stale detection) but not on UI-only state', () => {
  const s = st([card({ id: 'a', hours: 1, status: 'flexible' })]); const h1 = E.inputsHash(s);
  s.cards[0].hours = 2; assert.notEqual(E.inputsHash(s), h1); const h2 = E.inputsHash(s); s.edit.x = 'y'; s.scenario.a = { action: 'decline' }; assert.equal(E.inputsHash(s), h2);
});

test('normalizeChart maps provider labels, never guesses unknown ones', () => {
  assert.deepEqual(E.normalizeChart({ Type: 'Manifesting Generator', Strategy: 'To Respond, then Inform', InnerAuthority: 'Sacral', Profile: '3/5' }), { type: 'Manifesting Generator', strategy: 'To Respond, then Inform', authority: 'Sacral', profile: '3/5' });
  assert.equal(E.normalizeChart({ Type: 'Projector', InnerAuthority: 'Ego' }).authority, 'Ego (Projected)');
  assert.equal(E.normalizeChart({ Type: 'Generator', InnerAuthority: 'Emotional - Solar Plexus' }).authority, 'Emotional');
  assert.deepEqual(E.normalizeChart({ Type: '???', Strategy: 'x', InnerAuthority: 'y', Profile: '9/9' }), { type: '', strategy: '', authority: '', profile: '' });
});
