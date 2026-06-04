const data = window.ASISTENT_ZA_MATURE_CROATIAN_WRITING;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks pisanih zadataka iz hrvatskoga jezika.");
}

const app = document.querySelector("#essay-app");
const croatianSubjectUrl = "./?predmet=Hrvatski%20jezik";
const maximumImageBytes = 8 * 1024 * 1024;

const termLabels = {
  "ljetni rok": "Ljetni rok",
  "jesenski rok": "Jesenski rok",
};

const termAliases = {
  "prvi rok": "ljetni rok",
  "drugi rok": "jesenski rok",
  "ljetni rok": "ljetni rok",
  "jesenski rok": "jesenski rok",
};

const legacyTermAliases = {
  "ljetni rok": ["prvi rok"],
  "jesenski rok": ["drugi rok"],
};

let solverExam;
let essayText = "";
let ocrPending = false;
let ocrError = "";
let gradingPending = false;
let gradingResult = null;
let gradingError = "";
let gradingAbortController = null;
let gradingRunId = 0;
let simulationRecorded = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeSearch(value) {
  return String(value)
    .toLocaleLowerCase("hr")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("đ", "d");
}

function slugPart(value) {
  return normalizeSearch(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTerm(term) {
  return termAliases[term] || term;
}

function formatTerm(term) {
  return termLabels[normalizeTerm(term)] || term;
}

function essayExamIdForTerm(exam, term) {
  return `hrvatski-${exam.year}-${slugPart(term)}-${exam.kind}`;
}

function essayStorageKeyForId(id) {
  return `asistent-za-mature:croatian-writing:${id}`;
}

function essayStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => essayExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(essayStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(essayExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: essayExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function loadDraft(exam) {
  try {
    for (const key of essayStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        return typeof stored.writingText === "string" ? stored.writingText : "";
      }
    }
  } catch {
    return "";
  }
  return "";
}

function saveDraft() {
  if (simulation.active) return;

  const key = essayStorageKeyForId(solverExam.id);
  const trimmed = essayText.trim();
  if (!trimmed) {
    localStorage.removeItem(key);
    return;
  }

  localStorage.setItem(
    key,
    JSON.stringify({
      writingText: essayText,
      updatedAt: new Date().toISOString(),
    }),
  );
}

function countWords(value) {
  return String(value || "").match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu)?.length || 0;
}

function renderTaskText(text) {
  return String(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}

function hasValidSourceImage(source) {
  const crop = source?.crop;
  return (
    Boolean(source?.url) &&
    Number(source?.width) > 0 &&
    Number(source?.height) > 0 &&
    Number(crop?.width) > 0 &&
    Number(crop?.height) > 0
  );
}

function renderCroppedImage(source, alt) {
  if (!hasValidSourceImage(source)) return "";

  const crop = source.crop;
  const width = (source.width / crop.width) * 100;
  const offsetX = (-crop.x / source.width) * 100;
  const offsetY = (-crop.y / source.height) * 100;

  return `
    <figure class="pdf-source-figure">
      <div
        class="pdf-source-crop"
        style="aspect-ratio: ${crop.width} / ${crop.height}"
      >
        <img
          src="${escapeHtml(source.url)}"
          alt="${escapeHtml(alt)}"
          loading="lazy"
          style="
            width: ${width}%;
            max-width: none;
            transform: translate(${offsetX}%, ${offsetY}%);
          "
        />
      </div>
    </figure>
  `;
}

function renderTaskSourceImages(exam) {
  const images = Array.isArray(exam.sourceImages) ? exam.sourceImages : [];
  const rendered = images
    .map((source, index) =>
      renderCroppedImage(
        source,
        `Službeni prikaz zadatka za ${solverExam?.partLabel?.toLocaleLowerCase("hr") || "pisanje"}, stranica ${index + 1}.`,
      ),
    )
    .filter(Boolean);

  if (!rendered.length) return "";
  return `<div class="essay-task-source pdf-source-list">${rendered.join("")}</div>`;
}

function renderTaskSourceContent(exam) {
  return (
    renderTaskSourceImages(exam) ||
    `<div class="essay-task-text">
      ${renderTaskText(exam.taskText)}
    </div>`
  );
}

function renderMissingExam() {
  document.body.classList.remove("solver-page", "essay-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani pisani zadatak iz hrvatskoga jezika nije dostupan.</p>
      <a class="start-link" href="${croatianSubjectUrl}">Vrati se na Hrvatski jezik</a>
    </div>
  `;
}

function writingName(exam = solverExam) {
  return exam?.partLabel || "Pisani zadatak";
}

function writingNameLower(exam = solverExam) {
  return writingName(exam).toLocaleLowerCase("hr");
}

function renderCriteriaRows(exam) {
  return (exam.criteria || [])
    .map(
      (criterion) => `
        <div>
          <dt>${escapeHtml(criterion.label)}</dt>
          <dd data-result-criterion="${escapeHtml(criterion.id)}"></dd>
        </div>
      `,
    )
    .join("");
}

function renderSolver(exam) {
  document.body.classList.add("solver-page", "essay-solver-active");
  solverExam = exam;
  essayText = simulation.active ? "" : loadDraft(exam);
  ocrPending = false;
  ocrError = "";
  gradingPending = false;
  gradingResult = null;
  gradingError = "";
  gradingAbortController = null;
  simulationRecorded = false;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Hrvatski",
      part: exam.partLabel,
      exam,
      backHref: croatianSubjectUrl,
      backLabel: "← Natrag na Hrvatski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      summaryHtml: `
        ${simulation.renderTimer()}
        <strong id="essay-word-summary"></strong>
        <span id="essay-score-summary"></span>
      `,
    })}

    ${simulation.renderNotice()}

    <div class="essay-practice-layout">
      <section class="essay-task-panel" aria-labelledby="essay-task-title">
        <h3 id="essay-task-title">Službeni zadatak</h3>
        ${renderTaskSourceContent(exam)}
      </section>

      <section class="essay-writing-panel" aria-labelledby="essay-writing-title">
        <div class="essay-writing-panel__heading">
          <div>
            <h3 id="essay-writing-title">Tvoj ${escapeHtml(writingNameLower(exam))}</h3>
            <span id="essay-word-pill" class="essay-word-pill"></span>
          </div>
          <label class="secondary-button essay-photo-upload__button">
            <svg class="essay-photo-upload__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <use href="./assets/lucide-icons.svg?v=20260603-essay-layout#camera"></use>
            </svg>
            <span id="essay-photo-label">Iščitaj fotografiju</span>
            <input
              id="essay-photo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              capture="environment"
              ${simulation.inputDisabledAttribute()}
            />
          </label>
        </div>
        <div id="essay-ocr-status" class="essay-ocr-status" aria-live="polite"></div>

        <label class="essay-textarea-field">
          <textarea
            id="essay-text"
            aria-label="${escapeHtml(writingName(exam))}"
            placeholder="Napiši ${escapeHtml(writingNameLower(exam))} ovdje..."
            rows="18"
            spellcheck="false"
            ${simulation.inputDisabledAttribute()}
          >${escapeHtml(essayText)}</textarea>
        </label>

        <div id="essay-grading-panel"></div>
      </section>
    </div>

    <footer class="solver-sticky-footer solver-sticky-footer--essay">
      <div class="solver-sticky-footer__inner">
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <div class="solver-sticky-footer__status-copy">
              <strong id="footer-essay-word-summary"></strong>
              <span id="footer-essay-score-summary"></span>
            </div>
          </div>
          <div class="solver-sticky-footer__actions">
            <button class="primary-button" id="grade-essay" type="button">
              <svg class="solver-sticky-footer__action-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <use href="./assets/lucide-icons.svg#circle-check"></use>
              </svg>
              <span id="grade-essay-label">${simulation.active ? "Predaj i ocijeni" : `Ocijeni ${escapeHtml(writingNameLower(exam))}`}</span>
            </button>
          </div>
        </div>
      </div>
    </footer>

    <div class="exam-results-dialog" id="exam-results-dialog" role="dialog" aria-modal="true" aria-labelledby="exam-results-title" hidden>
      <div class="exam-results-dialog__backdrop"></div>
      <section class="exam-results-dialog__panel">
        <button class="exam-results-dialog__close" id="close-exam-results" type="button" aria-label="Zatvori rezultat">
          &times;
        </button>
        <svg class="exam-results-dialog__clock" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26"></circle>
          <path d="M32 16v16l11 7" class="exam-results-dialog__clock-hand"></path>
        </svg>
        <svg class="exam-results-dialog__check" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28"></circle>
          <path d="m20 33 8 8 17-18"></path>
        </svg>
        <p class="eyebrow" id="exam-results-eyebrow">Rezultat</p>
        <h2 id="exam-results-title">Tekst je ocijenjen</h2>
        <div class="exam-results-dialog__metrics" id="exam-results-metrics">
          <div>
            <strong id="exam-results-percentage"></strong>
            <span>Postotak</span>
          </div>
          <div>
            <strong id="exam-results-score"></strong>
            <span>Bodovi</span>
          </div>
        </div>
        <div class="exam-results-dialog__criteria" id="exam-results-criteria">
          <strong>Kriteriji ocjenjivanja</strong>
          <dl>
            ${renderCriteriaRows(exam)}
          </dl>
        </div>
        <details class="exam-results-dialog__comment" id="exam-results-comment-panel">
          <summary>AI komentar</summary>
          <p id="exam-results-comment"></p>
        </details>
        <p id="exam-results-description">
          Rezultat je AI procjena prema službenim kriterijima. Zatvori prozor za nastavak uređivanja ili ponovno ocjenjivanje.
        </p>
      </section>
    </div>
  `;

  document.querySelector("#essay-text").addEventListener("input", handleEssayInput);
  document.querySelector("#essay-photo").addEventListener("change", handlePhotoSelection);
  document.querySelector("#grade-essay").addEventListener("click", gradeEssay);
  document.querySelector("#close-exam-results").addEventListener("click", closeResultsDialog);
  document.querySelector(".exam-results-dialog__backdrop").addEventListener("click", closeResultsDialog);
  document.addEventListener("keydown", closeResultsDialogOnEscape);
  window.addEventListener("pagehide", abortPendingGrading);

  renderEssaySummary();
  renderOcrStatus();
  renderGradingPanel();
  simulation.start(exam.durationMinutes);
}

function handleEssayInput(event) {
  essayText = event.target.value;
  saveDraft();
  gradingResult = null;
  gradingError = "";
  renderEssaySummary();
  renderGradingPanel();
}

async function handlePhotoSelection(event) {
  const input = event.target;
  const [file] = event.target.files || [];
  gradingResult = null;
  gradingError = "";
  ocrError = "";

  if (!file) {
    renderOcrStatus();
    renderGradingPanel();
    return;
  }

  if (
    essayText.trim() &&
    !window.confirm("Zamijeniti postojeći tekst tekstom iščitanim s fotografije?")
  ) {
    input.value = "";
    renderOcrStatus();
    return;
  }

  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    ocrError = "Podržane su samo JPEG, PNG i WEBP slike.";
    input.value = "";
    renderOcrStatus();
    renderGradingPanel();
    return;
  }

  if (file.size > maximumImageBytes) {
    ocrError = "Slika je prevelika. Najveća dopuštena veličina je 8 MB.";
    input.value = "";
    renderOcrStatus();
    renderGradingPanel();
    return;
  }

  ocrPending = true;
  updateOcrControls();
  updateGradeButton();
  renderOcrStatus();
  renderGradingPanel();

  try {
    const dataUrl = await readImageAsDataUrl(file);
    const payload = await requestEssayOcr({
      dataUrl,
      name: file.name,
      type: file.type,
    });
    const extractedText = String(payload.text || "").trim();
    if (!extractedText) {
      throw new Error("Na fotografiji nije pronađen tekst za ocjenjivanje.");
    }

    essayText = extractedText;
    const textarea = document.querySelector("#essay-text");
    if (textarea) textarea.value = essayText;
    saveDraft();
  } catch (error) {
    ocrError = error.message || "Tekst s fotografije nije moguće iščitati.";
  } finally {
    ocrPending = false;
    input.value = "";
    updateOcrControls();
    updateGradeButton();
    renderOcrStatus();
    renderEssaySummary();
    renderGradingPanel();
  }
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Sliku nije moguće učitati.")));
    reader.readAsDataURL(file);
  });
}

function renderOcrStatus() {
  const target = document.querySelector("#essay-ocr-status");
  if (!target) return;

  if (ocrPending) {
    target.innerHTML = `<p class="essay-ocr-message">Iščitavam tekst s fotografije.</p>`;
    return;
  }

  if (ocrError) {
    target.innerHTML = `<p class="essay-ocr-message essay-ocr-message--error">${escapeHtml(ocrError)}</p>`;
    return;
  }

  target.innerHTML = "";
}

function updateOcrControls() {
  const input = document.querySelector("#essay-photo");
  const label = document.querySelector("#essay-photo-label");
  if (input) input.disabled = ocrPending || simulation.finished;
  if (label) label.textContent = ocrPending ? "Iščitavam..." : "Iščitaj fotografiju";
}

function scorePercentage(result) {
  const total = Number(result?.total);
  return Number.isFinite(total) ? Math.round((total / solverExam.maxScore) * 100) : 0;
}

function renderGradingPanel() {
  const target = document.querySelector("#essay-grading-panel");
  if (!target) return;

  if (gradingError) {
    target.innerHTML = `
      <div class="essay-grading-panel">
        <p class="practice-notice practice-notice--error">${escapeHtml(gradingError)}</p>
      </div>
    `;
    return;
  }

  target.innerHTML = "";
}

function renderEssaySummary() {
  const words = countWords(essayText);
  const range = solverExam.wordRange;
  const maximum = range.max == null ? null : Number(range.max);
  const wordText = `${words} riječi`;
  const scoreText = gradingResult ? `${gradingResult.total}/${solverExam.maxScore} bodova` : "";
  const inRange = words >= range.min && (!Number.isFinite(maximum) || words <= maximum);
  const rangeText = Number.isFinite(maximum) ? `${range.min}-${maximum}` : `${range.min}+`;
  const pill = document.querySelector("#essay-word-pill");

  document.querySelector("#essay-word-summary").textContent = wordText;
  document.querySelector("#footer-essay-word-summary").textContent = wordText;
  document.querySelector("#essay-score-summary").textContent = scoreText;
  document.querySelector("#footer-essay-score-summary").textContent = scoreText;

  if (pill) {
    pill.textContent = `${wordText} / ${rangeText}`;
    pill.dataset.state = words ? (inRange ? "ok" : "warn") : "";
  }
}

function setInputsDisabled(disabled) {
  document.querySelectorAll("#essay-text, #essay-photo").forEach((control) => {
    control.disabled = disabled;
  });
}

function updateGradeButton() {
  const button = document.querySelector("#grade-essay");
  const label = document.querySelector("#grade-essay-label");
  if (!button || !label) return;

  button.disabled = gradingPending || ocrPending;
  label.textContent =
    simulation.active && !simulation.finished
      ? "Predaj i ocijeni"
      : `Ocijeni ${writingNameLower()}`;
}

async function gradeEssay() {
  if (gradingPending || ocrPending) return;

  if (!essayText.trim()) {
    gradingError = `Upiši ${writingNameLower()} ili prvo iščitaj fotografiju rukopisa.`;
    renderGradingPanel();
    return;
  }

  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i poslati tekst na ocjenjivanje?")) return;
    simulation.finish("submitted");
  }

  gradingPending = true;
  gradingError = "";
  gradingResult = null;
  gradingAbortController = new AbortController();
  const runId = gradingRunId + 1;
  gradingRunId = runId;
  updateGradeButton();
  renderGradingPanel();
  openGradingPendingDialog();

  try {
    const payload = await requestEssayGrade(gradingAbortController.signal);
    if (runId !== gradingRunId) return;
    gradingResult = payload.grade;
    recordSubmittedSimulation();
  } catch (error) {
    if (runId !== gradingRunId) return;
    gradingError = isAbortError(error) ? "" : error.message || "Ocjenjivanje nije uspjelo.";
  } finally {
    if (runId !== gradingRunId) return;
    gradingPending = false;
    gradingAbortController = null;
    updateGradeButton();
    renderEssaySummary();
    renderGradingPanel();
    if (gradingResult) openResultsDialog();
    else hideResultsDialog({ restoreFocus: false });
  }
}

function essayResultComment() {
  const comment = String(gradingResult?.comment || "").trim();
  return comment || "Komentar nije dostupan za ovo ocjenjivanje.";
}

function resultDescription() {
  if (gradingResult?.invalidLength) {
    return solverExam.kind === "sazetak"
      ? "Sažetak se prema službenim pravilima ne vrednuje ako ima manje od 180 ili više od 275 riječi."
      : "Školski esej se prema službenim pravilima ne vrednuje ako ima manje od 396 riječi.";
  }
  if (gradingResult?.unfulfilledTask) {
    return "Tekst se prema službenim pravilima ne vrednuje jer zadatak nije ispunjen.";
  }
  return "Rezultat je AI procjena prema službenim kriterijima. Zatvori prozor za nastavak uređivanja ili ponovno ocjenjivanje.";
}

function criterionScore(value, maximum = 3) {
  const score = Math.round(Number(value));
  return Number.isFinite(score)
    ? `${Math.max(0, Math.min(maximum, score))}/${maximum}`
    : `-/${maximum}`;
}

function setResultsDialogCopy({ state, eyebrow, title, description, closeLabel }) {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  dialog.dataset.state = state;
  document.querySelector("#exam-results-eyebrow").textContent = eyebrow;
  document.querySelector("#exam-results-title").textContent = title;
  document.querySelector("#exam-results-description").textContent = description;
  document.querySelector("#close-exam-results").setAttribute("aria-label", closeLabel);
}

function openGradingPendingDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  setResultsDialogCopy({
    state: "grading",
    eyebrow: "AI ocjenjivanje",
    title: "Ocjenjivanje je u tijeku",
    description: "Ako zatvoriš ovaj prozor ili napustiš stranicu, ocjenjivanje će se prekinuti.",
    closeLabel: "Prekini ocjenjivanje",
  });
  document.querySelector("#exam-results-comment-panel").open = false;
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results").focus();
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || !gradingResult) return;

  setResultsDialogCopy({
    state: "result",
    eyebrow: `Rezultat: ${writingNameLower()}`,
    title: `${writingName()} je ocijenjen`,
    description: resultDescription(),
    closeLabel: "Zatvori rezultat",
  });
  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage(gradingResult)}%`;
  document.querySelector("#exam-results-score").textContent = `${gradingResult.total}/${solverExam.maxScore}`;
  for (const criterion of gradingResult.criteria || []) {
    const target = [...document.querySelectorAll("[data-result-criterion]")].find(
      (item) => item.dataset.resultCriterion === criterion.id,
    );
    if (target) target.textContent = criterionScore(criterion.score, criterion.maxScore);
  }
  document.querySelector("#exam-results-comment").textContent = essayResultComment();
  document.querySelector("#exam-results-comment-panel").open = false;
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results").focus();
}

function closeResultsDialog(options = {}) {
  if (gradingPending) {
    abortPendingGrading();
    return;
  }

  hideResultsDialog(options);
}

function hideResultsDialog(options = {}) {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || dialog.hidden) return;

  const restoreFocus = options?.restoreFocus !== false;
  dialog.hidden = true;
  delete dialog.dataset.state;
  document.body.classList.remove("exam-results-dialog-open");
  if (restoreFocus) document.querySelector("#grade-essay")?.focus();
}

function closeResultsDialogOnEscape(event) {
  if (event.key === "Escape") closeResultsDialog();
}

function abortPendingGrading() {
  if (!gradingPending) return;

  gradingRunId += 1;
  gradingAbortController?.abort();
  gradingAbortController = null;
  gradingPending = false;
  gradingError = "";
  updateGradeButton();
  renderGradingPanel();
  hideResultsDialog({ restoreFocus: false });
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

async function requestEssayOcr(image) {
  const response = await fetch("/api/croatian-writing/ocr", {
    body: JSON.stringify({ image }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("API za OCR nije dostupan. Pokreni stranicu preko Node servera.");
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "OCR fotografije nije uspio.");
  return payload;
}

async function requestEssayGrade(signal) {
  const response = await fetch("/api/croatian-writing/grade", {
    body: JSON.stringify({
      examId: solverExam.id,
      writingText: essayText,
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal,
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("API za ocjenjivanje nije dostupan. Pokreni stranicu preko Node servera.");
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Ocjenjivanje nije uspjelo.");
  return payload;
}

function finishSimulation(reason) {
  setInputsDisabled(true);
  updateOcrControls();
  updateGradeButton();

  if (reason === "expired") {
    window.alert(`Vrijeme za simulaciju je isteklo. ${writingName()} se više ne može mijenjati.`);
  }
}

function recordSubmittedSimulation() {
  if (!simulation.active || !simulation.finished || simulationRecorded || !window.AsistentProfile) {
    return;
  }

  simulationRecorded = true;
  window.AsistentProfile.recordSimulationAttempt({
    solver: "croatian-writing",
    subject: "Hrvatski jezik",
    part: solverExam.partLabel,
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: essayText.trim() ? 1 : 0,
    totalQuestions: 1,
    score: gradingResult?.total ?? null,
    maxScore: solverExam.maxScore,
    checkingSupported: true,
  });
}

function startEssayPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(croatianSubjectUrl);
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}

if (!simulation.active && window.AsistentProfile?.ready) {
  window.AsistentProfile.ready.finally(startEssayPage);
} else {
  startEssayPage();
}
