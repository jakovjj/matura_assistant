const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const core = require('../medicine-core.js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('data/medicine.js', 'utf8'), context);
const data = context.window.MEDICINE_DATA;
assert.equal(data.questions.length, 444);
assert.equal(new Set(data.questions.map(q => q.id)).size, 444);
assert.equal(data.sets.length, 5);
const paper = data.sets.find(set => set.id === 'exam-2020');
const questions = paper.questionIds.map(id => data.questions.find(q => q.id === id));
assert.equal(paper.durationMinutes, 180);
assert.equal(paper.threshold.totalPoints, 330);
assert.equal(paper.threshold.perSubjectCorrect, 16);
assert.equal(questions.length, 120);
const allCorrect = Object.fromEntries(questions.map(q => [q.id, q.answer]));
const full = core.score(questions, allCorrect, { threshold: paper.threshold });
assert.equal(full.points, 600);
assert.equal(full.percentage, 100);
assert.equal(full.passed, true);
assert.equal(core.score(questions, {}).points, 0);
const partial = {};
for (const subject of core.subjects) questions.filter(q => q.subject === subject).slice(0, 22).forEach(q => partial[q.id] = q.answer);
assert.equal(core.score(questions, partial, { threshold: paper.threshold }).passed, true);
delete partial[questions[0].id];
assert.equal(core.score(questions, partial, { threshold: paper.threshold }).passed, false);
const unbalanced = {};
for (const subject of core.subjects) questions.filter(q => q.subject === subject).slice(0, subject === 'Biologija' ? 15 : 40).forEach(q => unbalanced[q.id] = q.answer);
assert.equal(core.score(questions, unbalanced, { threshold: paper.threshold }).passed, false);
assert.equal(core.score(questions, allCorrect, { checked: new Set([questions[0].id]) }).points, 5);
assert.equal(core.score(questions, Object.fromEntries(questions.map(q => [q.id, q.answer === 'A' ? 'B' : 'A']))).points, 0);
assert.deepEqual(core.answersFor(questions, { [questions[0].id]: 'A', nope: 'B', [questions[1].id]: 'F' }), { [questions[0].id]: 'A' });
for (const set of data.sets) {
  if (set.kind !== 'random') assert.equal(set.questionIds.length, set.expectedCount);
  const chosen = set.questionIds.map(id => data.questions.find(q => q.id === id));
  assert.ok(chosen.every(Boolean));
  assert.equal(new Set(set.questionIds).size, chosen.length);
  if (set.kind === 'random') {
    assert.equal(set.year, null);
    assert.ok(chosen.every(q => !q.reviewIssue && !q.id.startsWith('exam-')));
    core.subjects.forEach(subject => assert.ok(chosen.filter(q => q.subject === subject).length >= 40));
    const map = new Map(data.questions.map(q => [q.id, q]));
    const first = core.selectRandomQuestions(set.questionIds, map, () => 0);
    const last = core.selectRandomQuestions(set.questionIds, map, () => .999);
    assert.equal(first.length, 120);
    assert.equal(new Set(first).size, 120);
    assert.equal(core.validSelection(first, set.questionIds, map), true);
    assert.equal(core.validSelection([...first].reverse(), set.questionIds, map), false);
    assert.notDeepEqual(first, last);
  }
}
for (const q of data.questions) {
  assert.equal(q.options.map(o => o.id).join(''), 'ABCDE');
  assert.ok('ABCDE'.includes(q.answer));
  assert.equal(q.provenance, undefined);
  for (const block of [...q.prompt, ...q.options.flatMap(o => o.content)]) {
    if (block.type === 'figure') assert.ok(fs.existsSync(data.figures[block.id].url.replace('./', '')));
    else if (block.type === 'table') assert.ok(data.tables[block.id].rows.length);
    else assert.ok(block.text.trim());
  }
}
console.log('PASS: 444 questions, 5 complete sets, random 40-per-subject selection, 2020 thresholds, scoring boundaries, assets and provenance separation.');
