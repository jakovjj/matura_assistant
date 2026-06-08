const data = window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks eseja iz engleskoga jezika.");
}

const app = document.querySelector("#essay-app");
const englishSubjectUrl = "./?predmet=Engleski%20jezik";

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

function essayExamIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
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

function renderTaskText(text) {
  const normalized = String(text || "")
    .replace("Your essay must have an introduction, body and conclusion.", "$&\n")
    .replace(/(?=\b(?:Some|Others|For some|For others|All people|Young drivers|Students)\b)/g, "\n")
    .replace(/(?=\bDiscuss\b)/g, "\n");

  return normalized
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
  return window.renderSourceImageCrop(source, alt, { variant: "pdf" });
}

function renderTaskSourceImages(exam) {
  const images = Array.isArray(exam.sourceImages) ? exam.sourceImages : [];
  const rendered = images
    .map((source, index) => renderCroppedImage(source, `Službeni prikaz zadatka za esej, stranica ${index + 1}.`))
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

function renderPreviewNotice() {
  return `
    <p class="practice-notice">
      Možeš upisivati tekst za sebe, ali ne sprema se i ne ocjenjuje.
    </p>
  `;
}

function renderScratchPanel() {
  return `
    <section class="essay-writing-panel essay-writing-panel--scratch" aria-labelledby="essay-scratch-title">
      <div class="essay-writing-panel__heading">
        <div>
          <h3 id="essay-scratch-title">Tvoj esej</h3>
          <span class="essay-word-pill">Radni prostor bez spremanja</span>
        </div>
      </div>
      <label class="essay-textarea-field">
        <textarea
          id="essay-scratch"
          aria-label="Prostor za pisanje eseja"
          placeholder="Napiši svoj esej ovdje..."
          rows="12"
          spellcheck="false"
          ${simulation.inputDisabledAttribute()}
        ></textarea>
      </label>
    </section>
  `;
}

function renderMissingExam() {
  document.body.classList.remove("solver-page", "essay-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani esej iz engleskoga jezika nije dostupan.</p>
      <a class="start-link" href="${englishSubjectUrl}">Vrati se na Engleski jezik</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.body.classList.add("solver-page", "essay-solver-active");
  solverExam = exam;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Engleski",
      part: "Esej",
      exam,
      backHref: englishSubjectUrl,
      backLabel: "← Natrag na Engleski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      summaryHtml: simulation.renderTimer(),
    })}

    ${simulation.renderNotice()}
    ${renderPreviewNotice()}

    <div class="essay-practice-layout essay-practice-layout--preview">
      <section class="essay-task-panel" aria-labelledby="essay-task-title">
        <h3 id="essay-task-title">Writing paper</h3>
        ${renderTaskSourceContent(exam)}
      </section>
      ${renderScratchPanel()}
    </div>
  `;

  simulation.start(exam.durationMinutes);
}

function finishSimulation(reason) {
  document.querySelectorAll("#essay-scratch").forEach((control) => {
    control.disabled = true;
  });

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Pregled zadatka je završen.");
  }
}

function startEssayPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(englishSubjectUrl);
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}

startEssayPage();
