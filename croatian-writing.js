const data = window.ASISTENT_ZA_MATURE_CROATIAN_WRITING;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks pisanih zadataka iz hrvatskoga jezika.");
}

const app = document.querySelector("#essay-app");
const croatianSubjectUrl = "./?predmet=Hrvatski%20jezik";

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
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `hrvatski${level}-${exam.year}-${slugPart(term)}-${exam.kind}`;
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

const rubricsById = new Map(
  Object.values(data.rubrics || {})
    .filter((rubric) => rubric?.id)
    .map((rubric) => [rubric.id, rubric]),
);
const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  const rubric = rubricsById.get(exam.rubricId);
  return {
    ...exam,
    term,
    id: essayExamIdForTerm(exam, term),
    rubric,
    criteria: rubric?.criteria || exam.criteria || [],
  };
});
const examsById = buildExamMap(exams);

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function renderTaskText(text) {
  return String(text || "")
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

function writingName(exam = solverExam) {
  return exam?.partLabel || "Pisani zadatak";
}

function writingNameLower(exam = solverExam) {
  return writingName(exam).toLocaleLowerCase("hr");
}

function acceptedWordRangeText(exam = solverExam) {
  const range = exam?.wordRange || {};
  const minimum = Number(range.acceptedMin ?? range.min);
  const maximum = range.acceptedMax == null ? null : Number(range.acceptedMax);
  if (!Number.isFinite(minimum)) return "nije definiran";
  return Number.isFinite(maximum) ? `${minimum}-${maximum} riječi` : `najmanje ${minimum} riječi`;
}

function renderRubricCriterion(criterion) {
  const levels = Array.isArray(criterion.levels) ? criterion.levels : [];
  const items = Array.isArray(criterion.items) ? criterion.items : [];
  const detailRows = levels.length
    ? levels
        .map(
          (level) => `
            <li>
              <strong>${escapeHtml(level.score)} bod.</strong>
              <span>${escapeHtml(level.description)}</span>
            </li>
          `,
        )
        .join("")
    : items
        .map(
          (item) => `
            <li>
              <strong>${escapeHtml(item.id)} · ${escapeHtml(item.maxScore)} bod.</strong>
              <span>${escapeHtml(item.label)}</span>
            </li>
          `,
        )
        .join("");

  return `
    <section class="essay-rubric__criterion">
      <h4>
        <span>${escapeHtml(criterion.label)}</span>
        <small>0-${escapeHtml(criterion.maxScore)} bodova</small>
      </h4>
      ${detailRows ? `<ul>${detailRows}</ul>` : ""}
    </section>
  `;
}

function renderRubric(exam) {
  const rubric = exam.rubric;
  const criteria = Array.isArray(exam.criteria) ? exam.criteria : [];
  if (!rubric || !criteria.length) return "";

  const rawMaximum = criteria.reduce(
    (sum, criterion) => sum + (Number(criterion.maxScore) || 0),
    0,
  );
  const multiplier = Number(exam.scoreMultiplier) || 1;
  const scoreNote =
    multiplier > 1
      ? `Sirovi zbroj do ${rawMaximum} množi se s ${multiplier}; najviše ${exam.maxScore} bodova.`
      : `Zbroj kriterija daje najviše ${exam.maxScore} bodova.`;
  const specialRules = Array.isArray(rubric.specialRules) ? rubric.specialRules : [];
  const source = rubric.source;

  return `
    <details class="essay-rubric">
      <summary>
        <span>Službeni kriteriji</span>
        <small>${escapeHtml(exam.maxScore)} bodova</small>
      </summary>
      <div class="essay-rubric__body">
        <p class="essay-rubric__score-note">
          ${escapeHtml(scoreNote)} Za vrednovanje: ${escapeHtml(acceptedWordRangeText(exam))}.
        </p>
        <div class="essay-rubric__criteria">
          ${criteria.map(renderRubricCriterion).join("")}
        </div>
        ${
          specialRules.length
            ? `
              <section class="essay-rubric__rules">
                <h4>Posebna pravila</h4>
                <ul>
                  ${specialRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}
                </ul>
              </section>
            `
            : ""
        }
        ${
          source?.url
            ? `
              <p class="essay-rubric__source">
                Izvor:
                <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">
                  ${escapeHtml(source.title || "NCVVO ispitni katalog")}
                </a>
              </p>
            `
            : ""
        }
      </div>
    </details>
  `;
}

function renderPreviewNotice(exam) {
  return `
    <p class="practice-notice">
      Možeš upisivati tekst za sebe, ali ne sprema se i ne ocjenjuje.
    </p>
  `;
}

function renderScratchPanel(exam) {
  return `
    <section class="essay-writing-panel essay-writing-panel--scratch" aria-labelledby="essay-scratch-title">
      <div class="essay-writing-panel__heading">
        <div>
          <h3 id="essay-scratch-title">Tvoj ${escapeHtml(writingNameLower(exam))}</h3>
          <span class="essay-word-pill">Radni prostor bez spremanja</span>
        </div>
      </div>
      <label class="essay-textarea-field">
        <textarea
          id="essay-scratch"
          aria-label="Prostor za pisanje ${escapeHtml(writingNameLower(exam))}"
          placeholder="Napiši ${escapeHtml(writingNameLower(exam))} ovdje..."
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
      <p>Odabrani pisani zadatak iz hrvatskoga jezika nije dostupan.</p>
      <a class="start-link" href="${croatianSubjectUrl}">Vrati se na Hrvatski jezik</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.body.classList.add("solver-page", "essay-solver-active");
  solverExam = exam;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Hrvatski",
      part: exam.partLabel,
      exam,
      backHref: croatianSubjectUrl,
      backLabel: "← Natrag na Hrvatski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      summaryHtml: simulation.renderTimer(),
    })}

    ${simulation.renderNotice()}
    ${renderPreviewNotice(exam)}

    <div class="essay-practice-layout essay-practice-layout--preview">
      <section class="essay-task-panel" aria-labelledby="essay-task-title">
        <h3 id="essay-task-title">Službeni zadatak</h3>
        ${renderTaskSourceContent(exam)}
        ${renderRubric(exam)}
      </section>
      ${renderScratchPanel(exam)}
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
    window.location.replace(croatianSubjectUrl);
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}

startEssayPage();
