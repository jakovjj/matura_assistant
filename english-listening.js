const data = window.ASISTENT_ZA_MATURE_ENGLISH_LISTENING;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks slušanja iz engleskoga jezika.");
}

const app = document.querySelector("#listening-app");
const englishSubjectUrl = "./?predmet=Engleski%20jezik";

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

const pickerState = {
  level: "",
  year: "",
};

const audioSettingsStorageKey = "asistent-za-mature:english-listening:audio-settings";
const audioPlaybackRates = [1, 1.5];

const audioIcons = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z"/></svg>',
  pause:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  volume:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M19 6a8 8 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  muted:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4Z"/><path d="m16 9 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

let solverExam;
let responses = {};
let activeTaskTypeId;
let activeQuestionNumber;
let activeAudioIndexes = new Map();
let audioSettings = loadAudioSettings();
let syncingAudioSettings = false;
let checked = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });
const selfCheck = window.createTaskSelfCheck();

const taskTypeDefinitions = {
  matching: {
    id: "povezivanje",
    label: "Zadatci povezivanja",
  },
  choice: {
    id: "visestruki-izbor",
    label: "Zadatci višestrukoga izbora",
  },
};

function isChecked(question) {
  return checked || selfCheck.has(question);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checkButtonLabel() {
  if (simulation.active && !simulation.finished) return "Predaj simulaciju";
  return checked ? "Sakrij rješenja" : "Provjeri odgovore";
}

function checkButtonIcon() {
  return checked && !(simulation.active && !simulation.finished) ? "eye-off" : "circle-check";
}

function checkButtonClass() {
  return checked && !(simulation.active && !simulation.finished)
    ? "primary-button primary-button--muted"
    : "primary-button";
}

function icon(iconName, className) {
  if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${iconName}"></use>
    </svg>
  `;
}

function renderCheckButtonContent() {
  return `
    ${icon(checkButtonIcon(), "solver-sticky-footer__action-icon")}
    ${checkButtonLabel()}
  `;
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

function listeningExamIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function listeningStorageKeyForId(id) {
  return `asistent-za-mature:english-listening:${id}`;
}

function normalizedVolume(value) {
  const volume = Number(value);
  if (!Number.isFinite(volume)) return null;
  return Math.min(1, Math.max(0, volume));
}

function normalizedPlaybackRate(value) {
  const playbackRate = Number(value);
  return audioPlaybackRates.includes(playbackRate) ? playbackRate : 1;
}

function loadAudioSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(audioSettingsStorageKey) || "{}");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};

    const volume = normalizedVolume(stored.volume);
    return {
      ...(volume === null ? {} : { volume }),
      ...(typeof stored.muted === "boolean" ? { muted: stored.muted } : {}),
      playbackRate: normalizedPlaybackRate(stored.playbackRate),
    };
  } catch {
    return {};
  }
}

function saveAudioSettings() {
  try {
    localStorage.setItem(audioSettingsStorageKey, JSON.stringify(audioSettings));
  } catch {
    // Audio playback still works if storage is unavailable.
  }
}

function listeningStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) =>
      listeningExamIdForTerm(exam, term),
    ),
  ];

  return [...new Set(ids)].map(listeningStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(listeningExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: listeningExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function highlightInline(value) {
  return escapeHtml(value).replace(/\b0→([A-Z])\b/g, '<mark class="source-example">0→$1</mark>');
}

function stripTaskHeading(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => !/^\s*Task\s+\d+\s*$/.test(line))
    .filter((line) => !/^\s*Questions\s+\d+\s*[-–]\s*\d+\s*$/.test(line))
    .join("\n")
    .trim();
}

function blockLines(block) {
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function blockText(block) {
  return blockLines(block).join(" ").replace(/\s+/g, " ");
}

function parseLeadingItems(block, pattern) {
  const items = [];

  for (const line of blockLines(block)) {
    const match = line.match(pattern);
    if (match) {
      items.push({ label: match[1], text: match[2].trim() });
    } else if (items.length) {
      items[items.length - 1].text = `${items[items.length - 1].text} ${line}`.trim();
    } else if (line) {
      return [];
    }
  }

  return items;
}

function renderSourceList(items, className) {
  return `
    <div class="${className}">
      ${items
        .map(
          (item) => `
            <div class="${className}__item">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${highlightInline(item.text)}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderSourceBlock(block, index) {
  const text = blockText(block);
  const optionItems = parseLeadingItems(block, /^([A-H])\s+(.*)$/);
  const questionItems = parseLeadingItems(block, /^(\d{1,2})\s+(.*)$/);

  if (optionItems.length >= 2) {
    return renderSourceList(optionItems, "source-options");
  }

  if (questionItems.length >= 1) {
    return renderSourceList(questionItems, "source-questions");
  }

  if (
    index < 2 ||
    /(?:You will hear|For each question|Match each|Match the|Use each|There are|You will hear the recording)/i.test(
      text,
    )
  ) {
    return `<div class="source-instructions">${highlightInline(text)}</div>`;
  }

  if (text.length <= 100 && !/[.!?]$/.test(text)) {
    return `<h4 class="source-title">${highlightInline(text)}</h4>`;
  }

  return `<p>${highlightInline(text)}</p>`;
}

function renderTaskSource(text) {
  const blocks = stripTaskHeading(text)
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  return blocks.map(renderSourceBlock).join("");
}

function validSourceImage(source) {
  const crop = source?.crop;
  const dimensions = [
    source?.width,
    source?.height,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
  ].map(Number);
  return Boolean(
    source?.url &&
      dimensions.every((value) => Number.isFinite(value) && value >= 0) &&
      source.width &&
      source.height &&
      crop.width &&
      crop.height,
  );
}

function renderCroppedImage(source, alt) {
  if (!validSourceImage(source)) return "";
  return window.renderSourceImageCrop(source, alt, { variant: "pdf" });
}

function renderTaskSourceImages(task) {
  const sourceImages = Array.isArray(task.sourceImages)
    ? task.sourceImages.filter(validSourceImage)
    : [];
  if (!sourceImages.length) return "";

  return `
    <div class="pdf-source-list">
      ${sourceImages
        .map((source) => {
          const pageLabel = Number.isInteger(Number(source.page))
            ? `, stranica ${source.page}`
            : "";
          return renderCroppedImage(
            source,
            `Izvorni prikaz zadatka ${task.number} iz službene PDF knjižice${pageLabel}.`,
          );
        })
        .join("")}
    </div>
  `;
}

function renderTaskSourceContent(task) {
  const sourceImages =
    renderTaskSourceImages(task) ||
    `<div class="task-source">${renderTaskSource(task.text)}</div>`;

  return `
    ${sourceImages}
    <div class="task-source english-reading-source english-listening-question-content">
      <div class="english-reading-question-list">
        ${taskQuestions(task)
          .map((question) => renderSourceQuestion(task, String(question)))
          .join("")}
      </div>
    </div>
  `;
}

function questionSourceImages(task, question) {
  const source = task?.questionImages?.[String(question)];
  const images = Array.isArray(source) ? source : [source];
  return images.filter(validSourceImage);
}

function renderSourceQuestion(task, question) {
  const sourceImages = questionSourceImages(task, question);
  const fallbackLabel = task.number === 1 ? `Snimka ${question}` : `Pitanje ${question}`;
  const sourceImage = sourceImages
    .map((source, index) => {
      const partLabel = sourceImages.length > 1 ? `, dio ${index + 1}` : "";
      return renderCroppedImage(
        source,
        `Izvorni prikaz ${question}. pitanja iz službene PDF knjižice${partLabel}.`,
      );
    })
    .join("");

  return `
    <article
      class="physics-source-question english-source-question${sourceImage ? " physics-source-question--image" : ""}"
      id="odgovor-${escapeHtml(question)}"
      data-question-number="${escapeHtml(question)}"
    >
      ${sourceImage ? "" : `<h4>${escapeHtml(question)}</h4>`}
      <div class="physics-source-question__body english-source-question__body">
        ${sourceImage || `<p>${escapeHtml(fallbackLabel)}</p>`}
      </div>
      ${renderQuestion(task, question, { inline: true, includeId: false })}
    </article>
  `;
}

function allQuestions(exam) {
  return exam.tasks.flatMap((task) => taskQuestions(task));
}

function taskQuestions(task) {
  const questions = [];
  for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
    questions.push(question);
  }
  return questions;
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    const knownQuestions = new Set(allQuestions(exam).map(String));
    for (const key of listeningStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) =>
          knownQuestions.has(question) && typeof answer === "string" && /^[A-H]$/.test(answer),
      ),
    );
  } catch {
    return {};
  }
}

function saveResponses() {
  if (simulation.active) return;

  try {
    localStorage.setItem(listeningStorageKeyForId(solverExam.id), JSON.stringify(responses));
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam, storedResponses = responses) {
  return allQuestions(exam).filter((question) => storedResponses[question]?.trim()).length;
}

function taskAnsweredCount(task) {
  return taskQuestions(task).filter((question) => responses[question]?.trim()).length;
}

function taskTypeDefinition(exam, task) {
  const matchingTaskNumbers = exam.level === "A" ? new Set([1, 3]) : new Set([1]);
  return matchingTaskNumbers.has(task.number)
    ? taskTypeDefinitions.matching
    : taskTypeDefinitions.choice;
}

function taskTypes(exam = solverExam) {
  const groups = new Map();

  for (const task of exam?.tasks || []) {
    const definition = taskTypeDefinition(exam, task);
    if (!groups.has(definition.id)) {
      groups.set(definition.id, { ...definition, tasks: [] });
    }
    groups.get(definition.id).tasks.push(task);
  }

  return [...groups.values()];
}

function normalizeTaskTypeId(taskTypeId, exam = solverExam) {
  const types = taskTypes(exam);
  return types.some((type) => type.id === taskTypeId) ? taskTypeId : types[0]?.id;
}

function tasksForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  return taskTypes(exam).find((type) => type.id === normalizedTaskTypeId)?.tasks || [];
}

function questionsForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  return tasksForTaskType(taskTypeId, exam).flatMap((task) => taskQuestions(task));
}

function taskTypeAnsweredCount(taskType) {
  return taskType.tasks.reduce((total, task) => total + taskAnsweredCount(task), 0);
}

function taskTypeQuestionCount(taskType) {
  return taskType.tasks.reduce((total, task) => total + taskQuestions(task).length, 0);
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function selectedTaskTypeId(exam) {
  return normalizeTaskTypeId(new URLSearchParams(window.location.search).get("vrsta"), exam);
}

function examUrl(exam, taskTypeId = activeTaskTypeId) {
  const params = new URLSearchParams({ exam: exam.id });
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  if (normalizedTaskTypeId) params.set("vrsta", normalizedTaskTypeId);
  if (simulation.active) params.set("nacin", "simulacija");
  return `./engleski-slusanje.html?${params.toString()}`;
}

function certifiedAudioPlan(exam = solverExam) {
  if (exam?.audioPlan?.mode !== "certified-task-tracks") return null;
  return exam.audioPlan;
}

function audioEntry(audioIndex, label, kind = "") {
  const audio = solverExam.audio[audioIndex];
  if (!audio) return null;
  return {
    audio,
    audioIndex,
    kind,
    label: label || audio.label,
  };
}

function taskAudioEntries(taskNumber) {
  const plan = certifiedAudioPlan();
  if (!plan) return [];

  const entries = (plan.tasks?.[String(taskNumber)] || [])
    .map((entry) => audioEntry(entry.audioIndex, entry.label, entry.kind))
    .filter(Boolean);

  const taskEntries = entries.filter((entry) => entry.kind !== "instruction");
  return taskEntries.length ? taskEntries : entries;
}

function allAudioEntries() {
  return solverExam.audio
    .map((audio, audioIndex) => ({
      audio,
      audioIndex,
      kind: "track",
      label: audio.label,
    }))
    .filter((entry) => entry.audio);
}

function renderPicker() {
  document.body.classList.remove("solver-page");
  const years = [...new Set(exams.map((exam) => exam.year))].sort((a, b) => b - a);

  app.innerHTML = `
    <div class="practice-overview">
      <div class="practice-overview__heading">
        <div>
          <p class="eyebrow">Slušanje</p>
          <h2>Odaberi ispit</h2>
        </div>
        <p>
          Dostupni su rokovi čiji arhivski paket sadrži službene audiosnimke.
          Stariji WMA zapisi pretvaraju se u MP3 tijekom pripreme podataka.
        </p>
      </div>

      <div class="practice-filter-bar">
        <label class="field">
          <span>Razina</span>
          <select id="practice-level-select">
            <option value="">Obje razine</option>
            <option value="A">A razina</option>
            <option value="B">B razina</option>
          </select>
        </label>
        <label class="field">
          <span>Godina ispita</span>
          <select id="practice-year-select">
            <option value="">Sve godine</option>
            ${years.map((year) => `<option value="${year}">${year}.</option>`).join("")}
          </select>
        </label>
      </div>

      <div id="practice-exam-list"></div>
    </div>
  `;

  document.querySelector("#practice-level-select").addEventListener("change", (event) => {
    pickerState.level = event.target.value;
    renderPickerList();
  });

  document.querySelector("#practice-year-select").addEventListener("change", (event) => {
    pickerState.year = event.target.value;
    renderPickerList();
  });

  renderPickerList();
}

function renderPickerList() {
  const filteredExams = exams.filter((exam) => {
    if (pickerState.level && exam.level !== pickerState.level) return false;
    return !pickerState.year || String(exam.year) === pickerState.year;
  });

  document.querySelector("#practice-exam-list").innerHTML = `
    <div class="practice-table-wrap">
      <table class="practice-exam-table">
        <thead>
          <tr>
            <th>Godina</th>
            <th>Rok</th>
            <th>Razina</th>
            <th>Snimke</th>
            <th>Napredak</th>
            <th>Provjera</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredExams.map(renderPickerRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPickerRow(exam) {
  const storedResponses = loadResponses(exam);
  const complete = answeredCount(exam, storedResponses);
  const total = allQuestions(exam).length;
  const checking = exam.checkingSupported
    ? `<span class="status-badge status-badge--available">Dostupna</span>`
    : `<span class="status-badge">Naknadno</span>`;
  const audioStatus = certifiedAudioPlan(exam)
    ? `${exam.audio.length} · po zadatku`
    : exam.audio.length;

  return `
    <tr>
      <td><strong>${exam.year}.</strong></td>
      <td>${escapeHtml(formatTerm(exam.term))}</td>
      <td><span class="level-badge">${escapeHtml(exam.level)}</span></td>
      <td>${audioStatus}</td>
      <td>${complete}/${total}</td>
      <td>${checking}</td>
      <td>
        <a class="start-link" href="${examUrl(exam)}">
          ${complete ? "Nastavi" : "Pokreni"}
        </a>
      </td>
    </tr>
  `;
}

function renderMissingExam() {
  document.body.classList.remove("solver-page");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit slušanja nije dostupan.</p>
      <a class="start-link" href="${englishSubjectUrl}">Vrati se na Engleski jezik</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.body.classList.add("solver-page");
  solverExam = exam;
  responses = simulation.active ? {} : loadResponses(exam);
  checked = false;
  selfCheck.reset();
  activeTaskTypeId = selectedTaskTypeId(exam);
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0];
  activeAudioIndexes = new Map();

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Engleski",
      part: "Slušanje",
      exam,
      backHref: englishSubjectUrl,
      backLabel: "← Natrag na Engleski jezik",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      summaryHtml: `
        ${simulation.renderTimer()}
        <strong id="answer-progress"></strong>
        <span id="score-summary"></span>
      `,
      navigationHtml: `
        <nav
          class="task-navigation solver-header__task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka slušanja u ispitnom zaglavlju"
        ></nav>
      `,
    })}

    ${simulation.renderNotice()}

    ${
      exam.checkingSupported
        ? ""
        : `<p class="practice-notice">
            Automatska provjera za stariji format još nije dostupna. Uneseni odgovori
            ${
              simulation.active
                ? "iz simulacije ne spremaju se."
                : "spremaju se u ovome pregledniku, a službeni ključ nalazi se u izvornome ZIP-u."
            }
          </p>`
    }

    <div id="section-content"></div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav
          class="task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka slušanja"
        ></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            ${icon("list-checks", "solver-sticky-footer__status-icon")}
            <div class="solver-sticky-footer__status-copy">
              <strong id="footer-answer-progress"></strong>
              <span id="footer-score-summary"></span>
            </div>
          </div>
          <div class="solver-sticky-footer__actions">
            ${
              exam.checkingSupported || simulation.active
                ? `<button class="${checkButtonClass()}" id="check-answers" type="button">
                    ${renderCheckButtonContent()}
                  </button>`
                : ""
            }
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
        <svg class="exam-results-dialog__check" aria-hidden="true" focusable="false" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28"></circle>
          <path d="m20 33 8 8 17-18"></path>
        </svg>
        <p class="eyebrow">Rezultat cijeloga ispita</p>
        <h2 id="exam-results-title">Rješenja su provjerena</h2>
        <div class="exam-results-dialog__metrics">
          <div>
            <strong id="exam-results-percentage"></strong>
            <span>Riješenost</span>
          </div>
          <div>
            <strong id="exam-results-score"></strong>
            <span>Bodovi</span>
          </div>
        </div>
        <p>
          Rezultat obuhvaća sve zadatke slušanja. Zatvori prozor i pregledaj
          označene odgovore po zadatcima.
        </p>
      </section>
    </div>
  `;

  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);
  document.querySelector("#close-exam-results")?.addEventListener("click", closeResultsDialog);
  document.querySelector(".exam-results-dialog__backdrop")?.addEventListener("click", closeResultsDialog);
  document.addEventListener("keydown", closeResultsDialogOnEscape);

  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function audioEntriesForTask(task) {
  const plan = certifiedAudioPlan();

  if (simulation.active) {
    const fullAudioIndex = plan?.fullAudioIndex;
    if (Number.isInteger(fullAudioIndex) && solverExam.audio[fullAudioIndex]) {
      return [audioEntry(fullAudioIndex, "Cijela snimka", "full")].filter(Boolean);
    }

    const taskEntries = taskAudioEntries(task.number);
    if (taskEntries.length) return taskEntries;
    return allAudioEntries();
  }

  const taskEntries = taskAudioEntries(task.number);
  if (taskEntries.length) return taskEntries;
  return allAudioEntries();
}

function renderTaskAudioBlock(task) {
  const entries = audioEntriesForTask(task);
  if (!entries.length) return "";

  let activeAudioIndex = activeAudioIndexes.get(task.number);
  if (!entries.some((entry) => entry.audioIndex === activeAudioIndex)) {
    activeAudioIndex = entries[0].audioIndex;
    activeAudioIndexes.set(task.number, activeAudioIndex);
  }

  const activeEntry =
    entries.find((entry) => entry.audioIndex === activeAudioIndex) || entries[0];
  const track = activeEntry.audio;

  return `
    <div class="task-audio" aria-label="Audio za zadatak">
      <div class="task-audio__heading">
        <p class="eyebrow">Audio</p>
        <strong>${escapeHtml(activeEntry.label)}</strong>
        <small>${escapeHtml(track.sourceName)}</small>
      </div>
      ${renderAudioPlayer(track, task.number, activeEntry.audioIndex)}
      ${
        entries.length > 1
          ? `<div class="audio-track-list audio-track-list--compact" aria-label="Odabir audiosnimke za zadatak">
              ${entries.map((entry) => renderAudioTrackButton(entry, task.number)).join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function renderAudioPlayer(track, taskNumber, audioIndex) {
  const accelerated = normalizedPlaybackRate(audioSettings.playbackRate) === 1.5;

  return `
    <div class="audio-player" data-audio-player>
      <button class="audio-player__button audio-player__play" type="button" data-audio-play aria-label="Pokreni snimku">
        <span class="audio-player__icon" data-audio-play-symbol>${audioIcons.play}</span>
      </button>
      <input
        class="audio-player__range audio-player__seek"
        type="range"
        min="0"
        max="1000"
        step="1"
        value="0"
        data-audio-seek
        aria-label="Položaj snimke"
      >
      <span class="audio-player__time" data-audio-time>0:00 / --:--</span>
      <button
        class="audio-player__rate${accelerated ? " is-active" : ""}"
        type="button"
        data-audio-rate-toggle
        title="Brzina reprodukcije"
        aria-label="${accelerated ? "Isključi ubrzanje 1.5x" : "Uključi ubrzanje 1.5x"}"
        aria-pressed="${accelerated ? "true" : "false"}"
      >
        <span data-audio-rate-label>${accelerated ? "1.5×" : "1×"}</span>
      </button>
      <div class="audio-player__volume-group">
        <button class="audio-player__button audio-player__mute" type="button" data-audio-mute aria-label="Isključi zvuk">
          <span class="audio-player__icon" data-audio-volume-symbol>${audioIcons.volume}</span>
        </button>
        <input
          class="audio-player__range audio-player__volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value="1"
          data-audio-volume
          aria-label="Glasnoća"
        >
      </div>
    </div>
    <audio
      preload="metadata"
      src="${escapeHtml(track.url)}"
      data-task-audio="${taskNumber}"
      data-audio-current-index="${audioIndex}"
    >
      Vaš preglednik ne podržava reprodukciju audiosnimke.
    </audio>
  `;
}

function audioPlaybackKey(audio) {
  return audio.dataset.audioCurrentIndex || audio.getAttribute("src") || "";
}

function captureAudioPlaybackState() {
  const section = document.querySelector("#section-content");
  if (!section) return new Map();

  const state = new Map();
  section.querySelectorAll("audio[data-task-audio]").forEach((audio) => {
    const key = audioPlaybackKey(audio);
    if (!key) return;

    state.set(key, {
      currentTime: audio.currentTime,
      playbackRate: audio.playbackRate,
      volume: audio.volume,
      muted: audio.muted,
      wasPlaying: !audio.paused && !audio.ended,
    });
  });
  return state;
}

function restoreAudioPlaybackState(state) {
  const section = document.querySelector("#section-content");
  if (!section) return;

  section.querySelectorAll("audio[data-task-audio]").forEach((audio) => {
    const saved = state.get(audioPlaybackKey(audio));
    if (!saved) return;

    audio.playbackRate = saved.playbackRate;
    audio.volume = saved.volume;
    audio.muted = saved.muted;
    updateAudioPlayerControls(audio);

    const restoreTime = () => {
      if (Number.isFinite(saved.currentTime)) {
        try {
          audio.currentTime = Math.min(saved.currentTime, audio.duration || saved.currentTime);
        } catch {
          // Some browsers reject seeking before the media is fully ready.
        }
      }
      const shouldResume = saved.wasPlaying && !saved.resumed;
      saved.resumed = saved.resumed || shouldResume;
      if (shouldResume) audio.play()?.catch?.(() => {});
      updateAudioPlayerControls(audio);
    };

    if (audio.readyState >= 1) restoreTime();
    else audio.addEventListener("loadedmetadata", restoreTime, { once: true });
  });
}

function applyAudioSettings(audio) {
  const volume = normalizedVolume(audioSettings.volume);
  if (volume !== null) audio.volume = volume;
  if (typeof audioSettings.muted === "boolean") audio.muted = audioSettings.muted;
  audio.playbackRate = normalizedPlaybackRate(audioSettings.playbackRate);
}

function applyAudioSettingsToRenderedAudio(sourceAudio) {
  const section = document.querySelector("#section-content");
  if (!section) return;

  syncingAudioSettings = true;
  section.querySelectorAll("audio[data-task-audio]").forEach((audio) => {
    if (audio !== sourceAudio) applyAudioSettings(audio);
    updateAudioPlayerControls(audio);
  });
  syncingAudioSettings = false;
}

function audioPlayerForAudio(audio) {
  const player = audio.previousElementSibling;
  return player?.matches?.("[data-audio-player]") ? player : null;
}

function formatAudioTime(value) {
  if (!Number.isFinite(value)) return "--:--";
  const totalSeconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function setAudioRangeFill(input, percent) {
  if (!input) return;
  input.style.setProperty("--audio-progress", `${Math.min(100, Math.max(0, percent))}%`);
}

function updateAudioPlayerControls(audio) {
  const player = audioPlayerForAudio(audio);
  if (!player) return;

  const playButton = player.querySelector("[data-audio-play]");
  const playSymbol = player.querySelector("[data-audio-play-symbol]");
  if (playButton && playSymbol) {
    const playing = !audio.paused && !audio.ended;
    playSymbol.innerHTML = playing ? audioIcons.pause : audioIcons.play;
    playButton.classList.toggle("is-playing", playing);
    playButton.setAttribute("aria-label", playing ? "Pauziraj snimku" : "Pokreni snimku");
  }

  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const progress = duration ? (audio.currentTime / duration) * 100 : 0;
  const seek = player.querySelector("[data-audio-seek]");
  if (seek && document.activeElement !== seek) {
    seek.value = duration ? String(Math.round((audio.currentTime / duration) * 1000)) : "0";
  }
  setAudioRangeFill(seek, progress);

  const time = player.querySelector("[data-audio-time]");
  if (time) {
    time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(audio.duration)}`;
  }

  const accelerated = normalizedPlaybackRate(audio.playbackRate) === 1.5;
  const rateButton = player.querySelector("[data-audio-rate-toggle]");
  if (rateButton) {
    rateButton.classList.toggle("is-active", accelerated);
    rateButton.setAttribute("aria-pressed", accelerated ? "true" : "false");
    rateButton.setAttribute(
      "aria-label",
      accelerated ? "Isključi ubrzanje 1.5x" : "Uključi ubrzanje 1.5x",
    );
    const rateLabel = rateButton.querySelector("[data-audio-rate-label]");
    if (rateLabel) rateLabel.textContent = accelerated ? "1.5×" : "1×";
  }

  const muted = audio.muted || audio.volume === 0;
  const muteButton = player.querySelector("[data-audio-mute]");
  const volumeSymbol = player.querySelector("[data-audio-volume-symbol]");
  if (muteButton && volumeSymbol) {
    muteButton.setAttribute("aria-label", muted ? "Uključi zvuk" : "Isključi zvuk");
    muteButton.classList.toggle("is-muted", muted);
    volumeSymbol.innerHTML = muted ? audioIcons.muted : audioIcons.volume;
  }

  const volumeInput = player.querySelector("[data-audio-volume]");
  if (volumeInput && document.activeElement !== volumeInput) {
    const volume = muted ? 0 : normalizedVolume(audio.volume);
    volumeInput.value = String(volume ?? 1);
  }
  setAudioRangeFill(volumeInput, Number(volumeInput?.value || 0) * 100);
}

function bindCustomAudioPlayer(audio) {
  const player = audioPlayerForAudio(audio);
  if (!player) return;

  player.querySelector("[data-audio-play]")?.addEventListener("click", () => {
    if (audio.paused || audio.ended) audio.play()?.catch?.(() => {});
    else audio.pause();
    updateAudioPlayerControls(audio);
  });

  player.querySelector("[data-audio-seek]")?.addEventListener("input", (event) => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration) audio.currentTime = (Number(event.target.value) / 1000) * duration;
    updateAudioPlayerControls(audio);
  });

  player.querySelector("[data-audio-mute]")?.addEventListener("click", () => {
    audio.muted = !audio.muted;
    updateAudioPlayerControls(audio);
  });

  player.querySelector("[data-audio-volume]")?.addEventListener("input", (event) => {
    const volume = normalizedVolume(event.target.value);
    if (volume === null) return;

    audio.volume = volume;
    audio.muted = volume === 0;
    updateAudioPlayerControls(audio);
  });

  player.querySelector("[data-audio-rate-toggle]")?.addEventListener("click", () => {
    const currentRate = normalizedPlaybackRate(audioSettings.playbackRate);
    audioSettings = {
      ...audioSettings,
      playbackRate: currentRate === 1.5 ? 1 : 1.5,
    };
    saveAudioSettings();
    applyAudioSettingsToRenderedAudio();
  });

  [
    "durationchange",
    "ended",
    "loadedmetadata",
    "pause",
    "play",
    "ratechange",
    "timeupdate",
    "volumechange",
  ].forEach((eventName) => {
    audio.addEventListener(eventName, () => updateAudioPlayerControls(audio));
  });

  updateAudioPlayerControls(audio);
}

function bindAudioSettingsControls() {
  const section = document.querySelector("#section-content");
  if (!section) return;

  section.querySelectorAll("audio[data-task-audio]").forEach((audio) => {
    applyAudioSettings(audio);
    bindCustomAudioPlayer(audio);
    audio.addEventListener("volumechange", () => {
      if (syncingAudioSettings) return;

      const volume = normalizedVolume(audio.volume);
      audioSettings = {
        ...audioSettings,
        ...(volume === null ? {} : { volume }),
        muted: audio.muted,
      };
      saveAudioSettings();
      applyAudioSettingsToRenderedAudio(audio);
    });
  });
}

function bindTaskAudioControls() {
  document.querySelectorAll("[data-audio-index]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAudioIndexes.set(
        Number(button.dataset.audioTask),
        Number(button.dataset.audioIndex),
      );
      renderTaskTypeContent();
    });
  });
}

function renderAudioTrackButton(entry, taskNumber) {
  const active = entry.audioIndex === activeAudioIndexes.get(taskNumber);
  return `
    <button
      class="audio-track-button${active ? " audio-track-button--active" : ""}"
      data-audio-index="${entry.audioIndex}"
      data-audio-task="${taskNumber}"
      type="button"
      ${active ? 'aria-current="true"' : ""}
    >
      ${escapeHtml(entry.label)}
    </button>
  `;
}

function renderTaskTypeNavigation() {
  const navigationHtml = taskTypes()
    .map((taskType) => {
      const activeClass = taskType.id === activeTaskTypeId ? " task-button--active" : "";
      return `
        <a
          class="task-button${activeClass}"
          href="${examUrl(solverExam, taskType.id)}"
          data-task-type="${taskType.id}"
          ${taskType.id === activeTaskTypeId ? 'aria-current="true"' : ""}
        >
          <strong>${escapeHtml(taskType.label)}</strong>
          <small>${taskTypeAnsweredCount(taskType)}/${taskTypeQuestionCount(taskType)}</small>
        </a>
      `;
    })
    .join("");

  document.querySelectorAll("[data-task-type-navigation]").forEach((navigation) => {
    navigation.innerHTML = navigationHtml;
  });

  document.querySelectorAll("[data-task-type]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectTaskType(link.dataset.taskType);
    });
  });
}

function renderSolverSummary() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const checkButton = document.querySelector("#check-answers");
  if (checkButton) {
    checkButton.disabled =
      (simulation.finished && solverExam?.checkingSupported === false) ||
      (complete === 0 && !checked && !simulation.finished);
    checkButton.className = checkButtonClass();
    checkButton.innerHTML = renderCheckButtonContent();
  }

  const resolved = allQuestions(solverExam).filter(
    (question) => isChecked(question) && solverExam.answers[question],
  );
  const resolvedCorrect = resolved.filter(
    (question) => responses[question] === solverExam.answers[question],
  ).length;
  const score = resolved.length ? `${resolvedCorrect}/${resolved.length} točno` : "";
  document.querySelector("#score-summary").textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function shouldRenderTaskAudio(task, taskIndex) {
  return taskIndex === 0 || (!simulation.active && taskAudioEntries(task.number).length > 0);
}

function renderTaskTypeContent() {
  const audioPlaybackState = captureAudioPlaybackState();
  document.querySelector("#section-content").innerHTML = tasksForTaskType()
    .map(
      (task, taskIndex) => `
        <div
          class="solver-question-layout solver-question-layout--single english-listening-layout"
          data-task-number="${task.number}"
        >
          <section class="task-content-panel">
            <div class="panel-heading">
              <div>
                <p class="eyebrow">Pitanja iz knjižice</p>
                <h3>Zadatak ${task.number}</h3>
              </div>
              <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
            </div>
            ${shouldRenderTaskAudio(task, taskIndex) ? renderTaskAudioBlock(task) : ""}
            ${renderTaskSourceContent(task)}
          </section>
        </div>
      `,
    )
    .join("");

  bindTaskAudioControls();
  bindAudioSettingsControls();
  restoreAudioPlaybackState(audioPlaybackState);
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });
  selfCheck.bind(document.querySelector("#section-content"), toggleSelfCheck);
}

function toggleSelfCheck(question) {
  if (simulation.active || checked) return;
  selfCheck.toggle(question);
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
}

function renderQuestion(task, question, options = {}) {
  const answer = responses[question] || "";
  const correctAnswer = solverExam.answers[question];
  const resultClass = isChecked(question)
    ? answer === solverExam.answers[question]
      ? " response-question--correct"
      : " response-question--wrong"
    : "";
  const idAttribute = options.includeId === false ? "" : ` id="odgovor-${question}"`;
  const inlineClass = options.inline ? " physics-inline-response" : "";

  return `
    <fieldset class="response-question${inlineClass}${resultClass}"${idAttribute}>
      <legend>${question}.</legend>
      <div class="choice-list">
        ${task.options.map((option) => renderChoice(question, option, answer)).join("")}
      </div>
      ${selfCheck.renderButton(question, {
        hidden: simulation.active || checked || !correctAnswer,
      })}
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = option === solverExam.answers[question];
  let resultClass = "";
  if (isChecked(question) && correct) resultClass = " answer-choice--correct";
  if (isChecked(question) && selected && !correct) resultClass = " answer-choice--wrong";

  return `
    <label class="answer-choice${resultClass}">
      <input
        data-question="${question}"
        type="radio"
        name="answer-${question}"
        value="${option}"
        ${selected ? "checked" : ""}
        ${simulation.inputDisabledAttribute()}
      >
      <span>${option}</span>
    </label>
  `;
}

function renderFeedback(question, answer) {
  if (!isChecked(question)) return "";
  const correctAnswer = solverExam.answers[question];
  if (answer === correctAnswer) return `<small class="response-feedback">Točno.</small>`;
  return `<small class="response-feedback">Točan odgovor: ${correctAnswer}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  const wasSelfChecked = selfCheck.has(question);
  checked = false;
  selfCheck.delete(question);
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  activeQuestionNumber = Number(question);
  saveResponses();
  renderTaskTypeNavigation();
  renderSolverSummary();
  if (wasChecked || wasSelfChecked) renderTaskTypeContent();
}

function selectTaskType(taskTypeId) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId === activeTaskTypeId) return;

  activeTaskTypeId = normalizedTaskTypeId;
  activeQuestionNumber = questionsForTaskType()[0];
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  renderTaskTypeContent();
  document.querySelector("#section-content").scrollIntoView({ behavior: "smooth", block: "start" });
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  if (checked) {
    checked = false;
    selfCheck.reset();
    closeResultsDialog();
    renderTaskTypeNavigation();
    renderSolverSummary();
    renderTaskTypeContent();
    return;
  }

  checked = true;
  selfCheck.reset();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  openResultsDialog();
}

function finishSimulation(reason) {
  checked = solverExam.checkingSupported;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();

  if (reason === "submitted") recordSubmittedSimulation();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }

  if (checked) openResultsDialog();
}

function recordSubmittedSimulation() {
  if (!window.AsistentProfile) return;

  const total = allQuestions(solverExam).length;
  const checkingSupported = solverExam.checkingSupported !== false;
  const score = checkingSupported ? totalScore() : null;

  window.AsistentProfile.recordSimulationAttempt({
    solver: "english-listening",
    subject: "Engleski jezik",
    part: "Slušanje",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(solverExam),
    totalQuestions: total,
    score,
    maxScore: checkingSupported ? total : null,
    checkingSupported,
  });
}

function taskScore(task) {
  return taskQuestions(task).filter(
    (question) => responses[question] === solverExam.answers[question],
  ).length;
}

function totalScore() {
  return solverExam.tasks.reduce((score, task) => score + taskScore(task), 0);
}

function scorePercentage() {
  const total = allQuestions(solverExam).length;
  return total ? Math.round((totalScore() / total) * 100) : 0;
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  const total = allQuestions(solverExam).length;
  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage()}%`;
  document.querySelector("#exam-results-score").textContent = `${totalScore()}/${total}`;
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results")?.focus();
}

function closeResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || dialog.hidden) return;

  dialog.hidden = true;
  document.body.classList.remove("exam-results-dialog-open");
  document.querySelector("#check-answers")?.focus();
}

function closeResultsDialogOnEscape(event) {
  if (event.key === "Escape") closeResultsDialog();
}

function startListeningPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(englishSubjectUrl);
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}

if (!simulation.active && window.AsistentProfile?.ready) {
  window.AsistentProfile.ready.finally(startListeningPage);
} else {
  startListeningPage();
}
