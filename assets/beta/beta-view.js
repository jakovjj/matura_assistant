/* Beta-only presentation. Exam mappings, scoring and metadata come from the app snapshot. */
function betaSolverUrl(href, exam) {
  const url = new URL(href, document.baseURI);
  url.pathname = `/assets/beta/${url.pathname.split('/').pop()}`;
  const back = new URL(window.location.href);
  back.hash = `exam-${exam.id}`;
  url.searchParams.set('betaReturn', back.pathname + back.search + back.hash);
  return url.pathname + url.search;
}

function renderBetaSubjectGrades(subject) {
  const exam = subjectExams(subject)[0];
  if (!exam) return '';
  return `<details class="beta-subject-grades" ${window.matchMedia('(min-width: 761px)').matches ? 'open' : ''}>
    <summary>Pragovi ocjena</summary>${renderGradeThresholds(exam)}
  </details>`;
}

function setupBetaSubject() {
  // Old beta bookmarks must not silently filter a page without filter controls.
  const url = new URL(location.href);
  for (const key of ['razina', 'rok', 'q']) url.searchParams.delete(key);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  const target = document.getElementById(location.hash.slice(1));
  if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start', behavior: 'instant' }));
}

function renderBetaExam(exam, attempts) {
  const parts = interactiveParts(exam);
  const best = bestSimulationPercentages(exam, attempts);
  const progress = examProgress(exam);
  const stats = renderExamStatistics(exam);
  return `<article class="beta-exam" id="exam-${escapeHtml(exam.id)}" aria-labelledby="title-${escapeHtml(exam.id)}">
    <header class="beta-exam-heading">
      <div><h4 id="title-${escapeHtml(exam.id)}">${exam.year}. · ${escapeHtml(formatTerm(exam.term))}</h4>${exam.level ? levelBadge(exam.level) : '<span class="beta-level">Jedinstvena razina</span>'}${parts.length > 1 ? `<span class="beta-parts-caption">${parts.length} cjeline</span>` : ''}</div>
      <a class="secondary-button beta-download" href="${escapeHtml(exam.url)}" target="_blank" rel="noreferrer" aria-label="Preuzmi paket: ${escapeHtml(exam.subject)} ${exam.year}. ${escapeHtml(formatTerm(exam.term))} ${escapeHtml(formatLevel(exam.level))}">${downloadIcon()}Preuzmi paket</a>
    </header>
    <div class="beta-parts">${parts.map(part => renderBetaPart(part, best.find(result => result.label === part.label))).join('') || '<p>Nema definiranog interaktivnog ispita za sada.</p>'}</div>
    <footer class="beta-exam-footer">
      <span class="beta-progress">Napredak vježbe: <strong>${progress.status ? `${progress.percent}%` : '—'}</strong>${progress.status ? ` <span>(${escapeHtml(progress.label)})</span>` : ''}</span>
      ${stats ? `<details class="beta-details"><summary>Statistika ispita</summary><div class="beta-detail-content">${stats}</div></details>` : ''}
    </footer>
  </article>`;
}

function renderBetaPart(part, result) {
  const duration = part.durationMinutes != null && Number.isFinite(Number(part.durationMinutes)) ? `${part.durationMinutes} min` : 'Trajanje nije poznato';
  const actions = part.available
    ? (isPreviewOnlyPart(part) ? renderPreviewPracticeActions(part, false) : renderSolvablePracticeActions(part, false))
    : '<details class="beta-unavailable"><summary>Trenutno nedostupno</summary><p>Nema definiranog interaktivnog ispita za sada.</p></details>';
  return `<div class="beta-part">
    <div class="beta-part-name"><div><strong>${escapeHtml(part.label)}</strong><span class="beta-duration">${escapeHtml(duration)}</span></div>
      ${isPreviewOnlyPart(part) ? '<small>Pregled zadatka i službenih kriterija</small>' : result?.hasResult ? `<small>Najbolja simulacija: <strong>${result.percentage}%</strong></small>` : ''}
    </div><div class="practice-exam-row__actions">${actions}</div>
  </div>`;
}
