/* Independent, deterministic medicine scoring. No storage or DOM access. */
((root) => {
  const subjects = ["Biologija", "Kemija", "Fizika"];
  const storageKey = (id) => `asistent-za-mature:medicine:v1:${id}`;
  function selectRandomQuestions(poolIds, questionMap, random = Math.random) {
    return ["Biologija", "Fizika", "Kemija"].flatMap((subject) => {
      const candidates = poolIds.filter((id) => questionMap.get(id)?.subject === subject);
      if (candidates.length < 40) throw new Error(`Nema dovoljno pitanja: ${subject}`);
      for (let index = candidates.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
      }
      return candidates.slice(0, 40);
    });
  }
  function validSelection(ids, poolIds, questionMap) {
    if (!Array.isArray(ids) || ids.length !== 120 || new Set(ids).size !== 120) return false;
    const pool = new Set(poolIds);
    if (!ids.every((id) => pool.has(id) && questionMap.has(id))) return false;
    return ["Biologija", "Fizika", "Kemija"].every((subject, index) =>
      ids.slice(index * 40, index * 40 + 40).every((id) => questionMap.get(id).subject === subject));
  }
  function answersFor(questions, candidate) {
    const answers = {};
    if (!candidate || typeof candidate !== "object") return answers;
    questions.forEach((q) => {
      if (q.options.some((option) => option.id === candidate[q.id])) answers[q.id] = candidate[q.id];
    });
    return answers;
  }
  function score(questions, answers, { checked = null, threshold = null } = {}) {
    const bySubject = subjects.map((subject) => ({ subject, total: 0, answered: 0, correct: 0, points: 0, maximum: 0 }));
    let checkedCount = 0;
    questions.forEach((q) => {
      const part = bySubject.find((entry) => entry.subject === q.subject);
      part.total += 1;
      part.maximum += q.points;
      if (answers[q.id]) part.answered += 1;
      const revealed = checked === null || checked.has(q.id);
      if (revealed) checkedCount += 1;
      if (revealed && answers[q.id] === q.answer) { part.correct += 1; part.points += q.points; }
    });
    const parts = bySubject.filter((part) => part.total);
    const points = parts.reduce((total, part) => total + part.points, 0);
    const maximum = parts.reduce((total, part) => total + part.maximum, 0);
    return {
      points, maximum, checkedCount,
      answered: parts.reduce((total, part) => total + part.answered, 0),
      total: questions.length,
      percentage: maximum ? Math.round(points / maximum * 1000) / 10 : 0,
      bySubject: parts,
      passed: threshold ? points >= threshold.totalPoints && parts.every((part) => part.correct >= threshold.perSubjectCorrect) : null,
    };
  }
  root.MedicineCore = { subjects, storageKey, selectRandomQuestions, validSelection, answersFor, score };
  if (typeof module !== "undefined") module.exports = root.MedicineCore;
})(typeof window === "undefined" ? globalThis : window);
