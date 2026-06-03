const data = window.ASISTENT_ZA_MATURE_ENGLISH_ESSAY;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks eseja iz engleskoga jezika.");
}

const app = document.querySelector("#essay-app");
const englishSubjectUrl = "./?predmet=Engleski%20jezik";
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

const rubricRows = [
  ["taskCompletion", "Izvršenje zadatka"],
  ["coherenceCohesion", "Koherencija i kohezija"],
  ["vocabulary", "Vokabular"],
  ["grammar", "Gramatika"],
];

let solverExam;
let essayText = "";
let ocrPending = false;
let ocrError = "";
let gradingPending = false;
let gradingResult = null;
let gradingError = "";
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
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function essayStorageKeyForId(id) {
  return `asistent-za-mature:english-essay:${id}`;
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
        return typeof stored.essayText === "string" ? stored.essayText : "";
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
      essayText,
      updatedAt: new Date().toISOString(),
    }),
  );
}

function countWords(value) {
  const words = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

function renderTaskText(text) {
  const normalized = text
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

function renderRubric() {
  return `
    <div class="essay-rubric">
      <h3>Kriteriji ocjenjivanja</h3>
      <p>Ukupno 20 bodova. Svaki kriterij nosi 0-5 bodova.</p>
      <div class="essay-rubric__grid">
        ${rubricRows
          .map(
            ([, label]) => `
              <div>
                <strong>${escapeHtml(label)}</strong>
                <span>0-5 bodova</span>
              </div>
            `,
          )
          .join("")}
      </div>
      <a href="${escapeHtml(data.rubricSource?.url || "#")}" target="_blank" rel="noreferrer">
        Službeni NCVVO kriteriji
      </a>
    </div>
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
  essayText = simulation.active ? "" : loadDraft(exam);
  ocrPending = false;
  ocrError = "";
  gradingPending = false;
  gradingResult = null;
  gradingError = "";
  simulationRecorded = false;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Engleski",
      part: "Esej",
      exam,
      backHref: englishSubjectUrl,
      backLabel: "← Natrag na Engleski jezik",
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
        <p class="eyebrow">Zadatak</p>
        <h3 id="essay-task-title">Writing paper</h3>
        ${renderTaskSourceContent(exam)}
        <div class="essay-instructions">
          <h3>Upute</h3>
          <ul>
            <li>Napiši raspravljački esej od ${exam.wordRange.min}-${exam.wordRange.max} riječi.</li>
            <li>Esej treba imati uvod, glavni dio i zaključak.</li>
            <li>Razradi zadana gledišta i jasno navedi vlastito mišljenje.</li>
          </ul>
        </div>
        ${renderRubric()}
      </section>

      <section class="essay-writing-panel" aria-labelledby="essay-writing-title">
        <div class="essay-writing-panel__heading">
          <h3 id="essay-writing-title">Tvoj esej</h3>
          <span id="essay-word-pill" class="essay-word-pill"></span>
        </div>

        <div class="essay-ocr-row">
          <p>Fotografija služi samo za OCR: iščitani tekst upisuje se u polje eseja.</p>
          <label class="secondary-button essay-photo-upload__button">
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
            aria-label="Esej"
            placeholder="Napiši svoj esej ovdje..."
            rows="18"
            spellcheck="false"
            ${simulation.inputDisabledAttribute()}
          >${escapeHtml(essayText)}</textarea>
        </label>

        <div id="essay-grading-panel"></div>
      </section>
    </div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <svg class="solver-sticky-footer__status-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <use href="./assets/lucide-icons.svg#file-pen-line"></use>
            </svg>
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
              <span id="grade-essay-label">${simulation.active ? "Predaj i ocijeni" : "Ocijeni esej"}</span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  `;

  document.querySelector("#essay-text").addEventListener("input", handleEssayInput);
  document.querySelector("#essay-photo").addEventListener("change", handlePhotoSelection);
  document.querySelector("#grade-essay").addEventListener("click", gradeEssay);

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
    !window.confirm("Zamijeniti postojeći tekst eseja tekstom iščitanim s fotografije?")
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
      throw new Error("Na fotografiji nije pronađen tekst eseja.");
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

  if (gradingPending) {
    target.innerHTML = `
      <div class="essay-grading-panel">
        <p class="practice-notice">Ocjenjivanje je u tijeku.</p>
      </div>
    `;
    return;
  }

  if (gradingError) {
    target.innerHTML = `
      <div class="essay-grading-panel">
        <p class="practice-notice practice-notice--error">${escapeHtml(gradingError)}</p>
      </div>
    `;
    return;
  }

  if (!gradingResult) {
    target.innerHTML = "";
    return;
  }

  target.innerHTML = `
    <div class="essay-grading-panel">
      <div class="essay-grade-summary">
        <div>
          <span>Ukupno</span>
          <strong>${escapeHtml(gradingResult.total)}/${solverExam.maxScore}</strong>
        </div>
        <div>
          <span>Postotak</span>
          <strong>${scorePercentage(gradingResult)}%</strong>
        </div>
      </div>
      <table class="essay-grade-table">
        <thead>
          <tr>
            <th>Kriterij</th>
            <th>Bodovi</th>
          </tr>
        </thead>
        <tbody>
          ${rubricRows
            .map(
              ([key, label]) => `
                <tr>
                  <td>${escapeHtml(label)}</td>
                  <td>${escapeHtml(gradingResult[key])}/5</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
      <p class="essay-grade-note">
        Prikazuju se samo bodovi po kriterijima, bez generiranog komentara.
      </p>
    </div>
  `;
}

function renderEssaySummary() {
  const words = countWords(essayText);
  const range = solverExam.wordRange;
  const wordText = `${words} riječi`;
  const scoreText = gradingResult ? `${gradingResult.total}/${solverExam.maxScore} bodova` : "";
  const inRange = words >= range.min && words <= range.max;
  const pill = document.querySelector("#essay-word-pill");

  document.querySelector("#essay-word-summary").textContent = wordText;
  document.querySelector("#footer-essay-word-summary").textContent = wordText;
  document.querySelector("#essay-score-summary").textContent = scoreText;
  document.querySelector("#footer-essay-score-summary").textContent = scoreText || "Esej se ocjenjuje po 4 kriterija.";

  if (pill) {
    pill.textContent = `${wordText} / ${range.min}-${range.max}`;
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
  label.textContent = simulation.active && !simulation.finished ? "Predaj i ocijeni" : "Ocijeni esej";
}

async function gradeEssay() {
  if (gradingPending || ocrPending) return;

  if (!essayText.trim()) {
    gradingError = "Upiši esej ili prvo iščitaj fotografiju rukopisa.";
    renderGradingPanel();
    return;
  }

  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i poslati esej na ocjenjivanje?")) return;
    simulation.finish("submitted");
  }

  gradingPending = true;
  gradingError = "";
  gradingResult = null;
  updateGradeButton();
  renderGradingPanel();

  try {
    const payload = await requestEssayGrade();
    gradingResult = payload.grade;
    recordSubmittedSimulation();
  } catch (error) {
    gradingError = error.message || "Ocjenjivanje nije uspjelo.";
  } finally {
    gradingPending = false;
    updateGradeButton();
    renderEssaySummary();
    renderGradingPanel();
  }
}

async function requestEssayOcr(image) {
  const response = await fetch("/api/english-essay/ocr", {
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

async function requestEssayGrade() {
  const response = await fetch("/api/english-essay/grade", {
    body: JSON.stringify({
      examId: solverExam.id,
      essayText,
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
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
    window.alert("Vrijeme za simulaciju je isteklo. Esej se više ne može mijenjati.");
  }
}

function recordSubmittedSimulation() {
  if (!simulation.active || !simulation.finished || simulationRecorded || !window.AsistentProfile) {
    return;
  }

  simulationRecorded = true;
  window.AsistentProfile.recordSimulationAttempt({
    solver: "english-essay",
    subject: "Engleski jezik",
    part: "Esej",
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

const id = selectedExamId();
if (!id) {
  window.location.replace(englishSubjectUrl);
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
