const data = window.ASISTENT_ZA_MATURE_ART_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Likovne umjetnosti.");
}

const app = document.querySelector("#art-app");

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

const defaultTaskTypeId = "visestruki-izbor";
const combinedChoiceTaskIds = new Set(["visestruki-izbor", "kronologija"]);
const taskTypeAliases = {
  abcd: defaultTaskTypeId,
  "visestruki-izbor": defaultTaskTypeId,
  "visestruke-kombinacije": "visestruke-kombinacije",
  povezivanje: "povezivanje",
  "kratki-odgovor": "kratki-odgovor",
  kronologija: defaultTaskTypeId,
  "uz-polazni-sadrzaj": "uz-polazni-sadrzaj",
  "produzeni-odgovor": "produzeni-odgovor",
};

let solverExam;
let questionByNumber = new Map();
let closedResponses = {};
let openResponses = {};
let openScores = {};
let activeTaskTypeId = defaultTaskTypeId;
let activeQuestionNumber;
let checked = false;
let quickSelectFrame;
let simulationRecorded = false;
let finishingSimulationByCheck = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });
const selfCheck = window.createTaskSelfCheck();

function isChecked(question) {
  return checked || selfCheck.has(question) || selfCheck.has(parentQuestionId(question));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(iconName, className) {
  if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

  return `
    <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${iconName}"></use>
    </svg>
  `;
}

function checkButtonLabel() {
  if (simulation.active && !simulation.finished) return "Predaj simulaciju";
  return checked ? "Sakrij rješenja" : "Provjeri rješenja";
}

function checkButtonIcon() {
  return checked && !(simulation.active && !simulation.finished) ? "eye-off" : "circle-check";
}

function checkButtonClass() {
  return checked && !(simulation.active && !simulation.finished)
    ? "primary-button primary-button--muted"
    : "primary-button";
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

function artExamIdForTerm(exam, term) {
  return `likovna-umjetnost-${exam.year}-${slugPart(term)}`;
}

function artStorageKeyForId(id) {
  return `asistent-za-mature:art-choice:${id}`;
}

function artStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => artExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(artStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(artExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: artExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function sourceTasks(exam = solverExam) {
  return exam?.tasks || [];
}

function questionSortKey(question) {
  const match = String(question.number || question).match(/^(\d+)(?:\.(\d+|[A-Z]))?$/);
  if (!match) return [9999, 9999, String(question.number || question)];
  const suffix = match[2] || "";
  return [Number(match[1]) || 0, /^\d+$/.test(suffix) ? Number(suffix) : 0, suffix];
}

function sortedQuestions(questions) {
  return [...questions].sort((left, right) => {
    const [leftWhole, leftDecimal, leftSuffix] = questionSortKey(left);
    const [rightWhole, rightDecimal, rightSuffix] = questionSortKey(right);
    return leftWhole - rightWhole
      || leftDecimal - rightDecimal
      || String(leftSuffix).localeCompare(String(rightSuffix), "hr");
  });
}

function tasks(exam = solverExam) {
  const examTasks = sourceTasks(exam);
  const choiceTasks = examTasks.filter((task) => combinedChoiceTaskIds.has(task.id));
  if (choiceTasks.length < 2) {
    return examTasks.map((task) =>
      task.id === "kronologija"
        ? {
            ...task,
            id: defaultTaskTypeId,
            label: "Zadatci višestrukoga izbora",
          }
        : task,
    );
  }

  const combinedChoiceTask = {
    ...(choiceTasks.find((task) => task.id === defaultTaskTypeId) || choiceTasks[0]),
    id: defaultTaskTypeId,
    label: "Zadatci višestrukoga izbora",
    description: "Odaberi jedan točan odgovor za svako pitanje.",
    questions: sortedQuestions(choiceTasks.flatMap((task) => task.questions || [])),
  };
  const visibleTasks = [];
  let combinedChoiceInserted = false;

  for (const task of examTasks) {
    if (!combinedChoiceTaskIds.has(task.id)) {
      visibleTasks.push(task);
      continue;
    }
    if (combinedChoiceInserted) continue;
    visibleTasks.push(combinedChoiceTask);
    combinedChoiceInserted = true;
  }

  return visibleTasks;
}

function taskQuestions(task) {
  return (task?.questions || []).map((question) => String(question.number));
}

function matchingItemId(questionNumber, itemLabel) {
  return `${questionNumber}.${itemLabel}`;
}

function parentQuestionId(question) {
  const match = String(question).match(/^(\d+)\.[A-Z]$/);
  return match ? match[1] : String(question);
}

function scoredQuestionIds(question) {
  if (isExcludedQuestion(question)) return [];
  if (question?.type === "matching") {
    return (question.scoredItems || []).map((item) => matchingItemId(question.number, item));
  }
  return [String(question.number)];
}

function isExcludedQuestion(question) {
  const item = typeof question === "object"
    ? question
    : questionByNumber.get(String(question));
  return window.isExcludedExamTask(item);
}

function scoredTaskQuestions(task) {
  return (task?.questions || []).flatMap(scoredQuestionIds);
}

function allQuestions(exam = solverExam) {
  return tasks(exam).flatMap(scoredTaskQuestions);
}

function closedQuestionNumbers(exam = solverExam) {
  return (exam?.questions || []).map(String);
}

function openQuestionNumbers(exam = solverExam) {
  return (exam?.openQuestions || []).map(String);
}

function taskForId(taskTypeId, exam = solverExam) {
  return tasks(exam).find((task) => task.id === taskTypeId) || tasks(exam)[0];
}

function questionsForTaskType(taskTypeId = activeTaskTypeId, exam = solverExam) {
  return taskQuestions(taskForId(taskTypeId, exam));
}

function buildQuestionMap(exam) {
  const entries = [];
  for (const task of tasks(exam)) {
    for (const question of task.questions || []) {
      entries.push([String(question.number), question]);
      if (question.type === "matching") {
        for (const item of question.scoredItems || []) {
          entries.push([matchingItemId(question.number, item), question]);
        }
      }
    }
  }
  return new Map(entries);
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function normalizeTaskTypeId(taskTypeId, exam = solverExam) {
  const normalized = taskTypeAliases[taskTypeId] || taskTypeId || defaultTaskTypeId;
  return taskForId(normalized, exam)?.id || tasks(exam)[0]?.id || defaultTaskTypeId;
}

function selectedTaskTypeId(exam) {
  const params = new URLSearchParams(window.location.search);
  return normalizeTaskTypeId(params.get("vrsta") || params.get("cjelina"), exam);
}

function examUrl(exam, taskTypeId = defaultTaskTypeId) {
  const params = new URLSearchParams({ exam: exam.id });
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  if (normalizedTaskTypeId !== tasks(exam)[0]?.id) {
    params.set("vrsta", normalizedTaskTypeId);
  }
  if (simulation.active) params.set("nacin", "simulacija");
  return `./likovna.html?${params.toString()}`;
}

function artSubjectUrl() {
  return "./?predmet=Likovna umjetnost";
}

function correctAnswers(question) {
  const answer = solverExam.answers[question];
  return Array.isArray(answer) ? answer : [answer].filter(Boolean);
}

function selectedAnswers(answer) {
  return String(answer || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isCorrectAnswer(question, answer) {
  const correct = correctAnswers(question);
  if (correct.length <= 1) return correct.includes(answer);

  const selected = selectedAnswers(answer);
  return selected.length === correct.length
    && correct.every((option) => selected.includes(option));
}

function maxPointsForClosedQuestion(question) {
  return Math.max(1, correctAnswers(question).length);
}

function closedQuestionScore(question) {
  return isCorrectAnswer(question, closedResponses[question])
    ? maxPointsForClosedQuestion(question)
    : 0;
}

function isOpenQuestion(question) {
  const number = typeof question === "object" ? String(question.number) : String(question);
  return questionByNumber.get(number)?.type === "open" || openQuestionNumbers().includes(number);
}

function maxPointsForOpenQuestion(question) {
  return Number(solverExam.openAnswers?.[question]?.maxPoints || questionByNumber.get(question)?.maxPoints || 1);
}

function loadState(exam) {
  const knownClosed = new Set(closedQuestionNumbers(exam));
  const knownOpen = new Set(openQuestionNumbers(exam));
  const state = {
    closedResponses: {},
    openResponses: {},
    openScores: {},
  };

  try {
    for (const key of artStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;

      Object.assign(state.closedResponses, stored.closedResponses || {});
      Object.assign(state.openResponses, stored.openResponses || {});
      Object.assign(state.openScores, stored.openScores || stored.openGrades || {});
    }
  } catch {
    return state;
  }

  state.closedResponses = Object.fromEntries(
    Object.entries(state.closedResponses).filter(
      ([question, answer]) =>
        knownClosed.has(question) && typeof answer === "string" && answer.trim(),
    ),
  );
  state.openResponses = Object.fromEntries(
    Object.entries(state.openResponses).filter(
      ([question, answer]) =>
        knownOpen.has(question) && typeof answer === "string" && answer.trim(),
    ),
  );
  state.openScores = Object.fromEntries(
    Object.entries(state.openScores).flatMap(([question, value]) => {
      const score = Number(value && typeof value === "object" ? value.points : value);
      const maximum = maxPointsForOpenQuestion(question);
      if (!knownOpen.has(question) || !Number.isInteger(score)) return [];
      return [[question, Math.min(Math.max(score, 0), maximum)]];
    }),
  );

  return state;
}

function saveState() {
  if (simulation.active) return;

  try {
    localStorage.setItem(
      artStorageKeyForId(solverExam.id),
      JSON.stringify({
        closedResponses,
        openResponses,
        openScores,
      }),
    );
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam = solverExam) {
  const closed = closedQuestionNumbers(exam).filter((question) => closedResponses[question]?.trim()).length;
  const open = openQuestionNumbers(exam).filter(
    (question) => openResponses[question]?.trim() || hasOpenScore(question),
  ).length;
  return closed + open;
}

function taskAnsweredCount(task) {
  return scoredTaskQuestions(task).filter((question) =>
    isOpenQuestion(question)
      ? openResponses[question]?.trim() || hasOpenScore(question)
      : closedResponses[question]?.trim(),
  ).length;
}

function hasOpenScore(question) {
  return Object.prototype.hasOwnProperty.call(openScores, question);
}

function maxScore() {
  const closedMaximum = closedQuestionNumbers().reduce(
    (sum, question) => sum + maxPointsForClosedQuestion(question),
    0,
  );
  const openMaximum = openQuestionNumbers().reduce(
    (sum, question) => sum + maxPointsForOpenQuestion(question),
    0,
  );
  return closedMaximum + openMaximum;
}

function openScore() {
  return openQuestionNumbers().reduce((sum, question) => {
    return sum + (hasOpenScore(question) ? openScores[question] : 0);
  }, 0);
}

function resolvedOpenQuestions() {
  if (checked) return openQuestionNumbers();
  return openQuestionNumbers().filter((question) => hasOpenScore(question));
}

function resolvedOpenScore() {
  return resolvedOpenQuestions().reduce((sum, question) => {
    return sum + (hasOpenScore(question) ? openScores[question] : 0);
  }, 0);
}

function closedScore() {
  return closedQuestionNumbers().reduce(
    (sum, question) => sum + closedQuestionScore(question),
    0,
  );
}

function totalScore() {
  return closedScore() + openScore();
}

// Running result over individually revealed tasks. Once the whole exam is
// checked, it matches totalScore()/maxScore().
function resolvedClosedQuestions() {
  return closedQuestionNumbers().filter((question) => isChecked(question));
}

function resolvedScore() {
  const closed = resolvedClosedQuestions().reduce(
    (sum, question) => sum + closedQuestionScore(question),
    0,
  );
  return closed + resolvedOpenScore();
}

function resolvedMaximum() {
  const closedMaximum = resolvedClosedQuestions().reduce(
    (sum, question) => sum + maxPointsForClosedQuestion(question),
    0,
  );
  const openMaximum = resolvedOpenQuestions().reduce(
    (sum, question) => sum + maxPointsForOpenQuestion(question),
    0,
  );
  return closedMaximum + openMaximum;
}

function scorePercentage() {
  const maximum = maxScore();
  return maximum ? Math.round((totalScore() / maximum) * 100) : 0;
}

function renderMissingExam() {
  document.body.classList.remove("solver-page", "history-solver-page");
  app.classList.remove("history-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit iz Likovne umjetnosti nije dostupan.</p>
      <a class="start-link" href="${artSubjectUrl()}">Vrati se na Likovnu umjetnost</a>
    </div>
  `;
}

function renderSolver(exam, taskTypeId) {
  document.body.classList.add("solver-page", "history-solver-page");
  app.classList.add("history-solver-active");
  solverExam = exam;
  questionByNumber = buildQuestionMap(exam);
  const state = simulation.active ? { closedResponses: {}, openResponses: {}, openScores: {} } : loadState(exam);
  closedResponses = state.closedResponses;
  openResponses = state.openResponses;
  openScores = state.openScores;
  activeTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0] || allQuestions(exam)[0];
  checked = false;
  selfCheck.reset();
  simulationRecorded = false;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Likovna umjetnost",
      exam,
      backHref: artSubjectUrl(),
      backLabel: "← Odaberi drugi ispit",
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
          aria-label="Vrste zadataka u ispitnom zaglavlju"
        ></nav>
      `,
    })}

    ${simulation.renderNotice()}

    <div id="section-content"></div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav
          class="task-navigation"
          data-task-type-navigation
          aria-label="Vrste zadataka u ispitu"
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
            <button class="${checkButtonClass()}" id="check-answers" type="button">
              ${renderCheckButtonContent()}
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
        <p id="exam-results-note">
          Rezultat uključuje zatvorene zadatke i bodove koje si sam dodijelio nakon pregleda službenih rješenja.
          Zatvori prozor i pregledaj označene odgovore u svakoj vrsti zadatka.
        </p>
      </section>
    </div>
  `;

  document.querySelector("#check-answers").addEventListener("click", checkAnswers);
  document.querySelector("#close-exam-results").addEventListener("click", closeResultsDialog);
  document.querySelector(".exam-results-dialog__backdrop").addEventListener("click", closeResultsDialog);
  document.addEventListener("keydown", closeResultsDialogOnEscape);

  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskTypeNavigation() {
  const navigationHtml = tasks()
    .map((task) => {
      const isActive = task.id === activeTaskTypeId;
      const gradingNote = taskQuestions(task).some((question) => isOpenQuestion(question))
        ? `<em class="task-button__grading">(Ručno ispravljanje)</em>`
        : "";
      return `
        <a
          class="task-button${isActive ? " task-button--active" : ""}"
          href="${examUrl(solverExam, task.id)}"
          data-task-type="${task.id}"
          ${isActive ? 'aria-current="true"' : ""}
        >
          <strong>${escapeHtml(task.label)}</strong>
          <small>${taskAnsweredCount(task)}/${scoredTaskQuestions(task).length}</small>
          ${gradingNote}
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

function renderTaskTypePager() {
  const all = tasks();
  if (all.length <= 1) return "";
  const index = all.findIndex((task) => task.id === activeTaskTypeId);
  if (index === -1) return "";
  const prev = all[index - 1];
  const next = all[index + 1];
  if (!prev && !next) return "";

  const button = (task, direction) => {
    const label = direction === "prev" ? "Prethodni zadaci" : "Sljedeći zadaci";
    const arrow = direction === "prev"
      ? icon("arrow-left", "task-type-pager__icon")
      : icon("arrow-right", "task-type-pager__icon");
    const copy = `
      <span class="task-type-pager__copy">
        <small>${label}</small>
        <strong>${escapeHtml(task.label)}</strong>
      </span>
    `;
    return `
      <button
        type="button"
        class="task-type-pager__button task-type-pager__button--${direction}"
        data-task-pager="${task.id}"
      >
        ${direction === "prev" ? arrow + copy : copy + arrow}
      </button>
    `;
  };

  return `
    <nav class="task-type-pager" aria-label="Navigacija među vrstama zadataka">
      ${prev ? button(prev, "prev") : "<span></span>"}
      ${next ? button(next, "next") : "<span></span>"}
    </nav>
  `;
}

function bindTaskTypePager() {
  document.querySelectorAll("[data-task-pager]").forEach((control) => {
    control.addEventListener("click", () => selectTaskType(control.dataset.taskPager));
  });
}

function selectTaskType(taskTypeId) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId === activeTaskTypeId) return;

  activeTaskTypeId = normalizedTaskTypeId;
  activeQuestionNumber = questionsForTaskType()[0];
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  document.querySelector("#task-content-panel")?.scrollIntoView({ block: "start" });
}

function renderSolverSummary() {
  const complete = answeredCount();
  const total = allQuestions().length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const checkButton = document.querySelector("#check-answers");
  checkButton.disabled = complete === 0 && !checked && !simulation.finished;
  checkButton.className = checkButtonClass();
  checkButton.innerHTML = renderCheckButtonContent();

  const resolvedMax = resolvedMaximum();
  const score = resolvedMax ? `${resolvedScore()}/${resolvedMax} bodova` : "";
  document.querySelector("#score-summary").textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskTypeContent() {
  const task = taskForId(activeTaskTypeId);
  const questions = task.questions || [];

  document.querySelector("#section-content").innerHTML = `
    <div class="solver-question-layout">
      <div class="solver-question-main">
        <section class="task-content-panel physics-task-content-panel" id="task-content-panel" aria-live="polite">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Pitanja iz knjižice</p>
              <h3>${escapeHtml(task.label)}</h3>
            </div>
            <small>${questions.length} zadataka</small>
          </div>
          ${task.description ? `<p class="history-task-description">${escapeHtml(task.description)}</p>` : ""}
          <div class="task-source physics-source-list history-source-list">
            ${renderQuestionGroups(questions)}
          </div>
        </section>
        ${renderTaskTypePager()}
      </div>

      <aside class="question-quickselect" aria-label="Brzi odabir pitanja">
        <div class="question-quickselect__heading">
          <strong>Brzi odabir</strong>
          <small>Zadatci</small>
        </div>
        <nav class="question-quickselect__list" id="question-quickselect"></nav>
      </aside>
    </div>
  `;

  bindResponseListeners();
  renderQuickSelect();
  bindQuickSelectTracking();
  bindTaskTypePager();
}

function renderQuestionGroups(questions) {
  return groupedQuestions(questions)
    .map((group) => {
      const contextImages = uniqueContextImages(group.questions);
      return `
        ${renderContextImages(contextImages, "Polazni sadržaj")}
        ${group.questions.map(renderSourceQuestion).join("")}
      `;
    })
    .join("");
}

function groupedQuestions(questions) {
  const groups = [];
  for (const question of questions) {
    const number = String(question.number);
    const group = quickSelectGroupNumber(number);
    const previousGroup = groups[groups.length - 1];
    if (previousGroup?.group === group) {
      previousGroup.questions.push(question);
      continue;
    }

    groups.push({
      group,
      questions: [question],
    });
  }
  return groups;
}

function uniqueContextImages(questions) {
  const images = [];
  const seen = new Set();
  for (const question of questions) {
    for (const image of question.contextImages || []) {
      const key = `${image.url}:${image.crop?.x}:${image.crop?.y}:${image.crop?.width}:${image.crop?.height}`;
      if (seen.has(key)) continue;
      seen.add(key);
      images.push(image);
    }
  }
  return images;
}

function renderContextImages(images = [], title) {
  if (!images.length) return "";
  return `
    <section class="croatian-source-context history-source-context">
      <p class="eyebrow">${escapeHtml(title)}</p>
      ${images
        .map((image, index) =>
          renderCroppedImage(image, `${title}, službeni prikaz ${index + 1}.`),
        )
        .join("")}
    </section>
  `;
}

function renderSourceQuestion(question) {
  const number = String(question.number);
  const sourceImage = renderCroppedImage(
    question.sourceImage,
    `Izvorni prikaz ${number}. zadatka iz službene PDF knjižice.`,
  );

  return `
    <article
      class="physics-source-question history-source-question${sourceImage ? " physics-source-question--image" : ""}"
      id="pitanje-${escapeHtml(number)}"
      data-question-number="${escapeHtml(number)}"
    >
      ${sourceImage ? "" : `<h4>${escapeHtml(number)}</h4>`}
      <div class="physics-source-question__body">
        ${sourceImage || renderQuestionFallback(question, number)}
      </div>
      ${renderQuestionResponse(question, number)}
    </article>
  `;
}

function renderQuestionFallback(question, number) {
  if (question.type === "open") {
    return `<p class="history-open-question__prompt">Pronađi zadatak u službenoj PDF knjižici i ručno dodijeli bodove.</p>`;
  }
  return `
    <p class="history-open-question__prompt">
      Pronađi ${escapeHtml(number)}. zadatak u službenoj PDF knjižici.
    </p>
  `;
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateClosedResponse(input.dataset.question, input.value));
  });
  document.querySelectorAll('input[type="checkbox"][data-multi-question]').forEach((input) => {
    input.addEventListener("change", () => updateMultiChoiceResponse(input.dataset.multiQuestion));
  });
  document.querySelectorAll("select[data-matching-question][data-matching-item]").forEach((select) => {
    select.addEventListener("change", () =>
      updateMatchingResponse(select.dataset.matchingQuestion, select.dataset.matchingItem, select.value),
    );
  });

  document.querySelectorAll("[data-open-score]").forEach((input) => {
    input.addEventListener("input", () => updateOpenScore(input.dataset.openScore, input.value, input));
  });
  document.querySelectorAll("[data-open-solution]").forEach((button) => {
    button.addEventListener("click", () => toggleOpenSolution(button));
  });

  selfCheck.bind(document.querySelector("#task-content-panel"), toggleSelfCheck);
}

function toggleSelfCheck(question) {
  if (simulation.active || checked || isOpenQuestion(question)) return;

  selfCheck.toggle(question);
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
}

function quickSelectGroupNumber(question) {
  return String(question).split(".")[0];
}

function quickSelectItems() {
  const items = [];
  for (const question of taskForId(activeTaskTypeId).questions || []) {
    const number = String(question.number);
    const group = quickSelectGroupNumber(number);
    const questionIds = scoredQuestionIds(question);
    const previousItem = items[items.length - 1];
    if (previousItem?.group === group) {
      previousItem.questions.push(...questionIds);
      continue;
    }

    items.push({
      label: group,
      target: number,
      group,
      questions: questionIds,
    });
  }
  return items;
}

function quickSelectAnswerState(item) {
  const scoredQuestions = item.questions.filter((question) => !isExcludedQuestion(question));
  if (!scoredQuestions.length) return "izuzet iz bodovanja";
  const answeredCountForItem = scoredQuestions.filter((question) =>
    isOpenQuestion(question)
      ? openResponses[question]?.trim() || hasOpenScore(question)
      : closedResponses[question]?.trim(),
  ).length;
  if (answeredCountForItem === scoredQuestions.length) return "odgovoreno";
  if (answeredCountForItem > 0) return "djelomično odgovoreno";
  return "nije odgovoreno";
}

function activeQuickSelectGroup() {
  return quickSelectGroupNumber(activeQuestionNumber);
}

function quickSelectResultIsCorrect(item) {
  return item.questions.filter((question) => !isExcludedQuestion(question)).every((question) => {
    if (isOpenQuestion(question)) return false;
    return isCorrectAnswer(question, closedResponses[question]);
  });
}

function renderQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const items = quickSelectItems();
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = items.length <= 2;

  quickSelect.innerHTML = items
    .map((item) => {
      const scoredQuestions = item.questions.filter((question) => !isExcludedQuestion(question));
      const isExcluded = !scoredQuestions.length;
      const isAnswered = !isExcluded && scoredQuestions.every((question) =>
        isOpenQuestion(question)
          ? openResponses[question]?.trim() || hasOpenScore(question)
          : closedResponses[question]?.trim(),
      );
      const stateClass = isExcluded
        ? " question-quickselect__link--excluded"
        : isAnswered
          ? " question-quickselect__link--answered"
          : "";
      const itemResolved =
        !isExcluded &&
        scoredQuestions.every((question) => !isOpenQuestion(question) && isChecked(question));
      const resultClass = itemResolved
        ? quickSelectResultIsCorrect(item)
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const activeClass =
        item.group === activeQuickSelectGroup() ? " question-quickselect__link--active" : "";
      const answerState = quickSelectAnswerState(item);
      const itemLabel = item.questions.length > 1 ? "Zadatak" : "Pitanje";
      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}${activeClass}"
          href="#pitanje-${escapeHtml(item.target)}"
          data-quick-question="${escapeHtml(item.target)}"
          data-quick-group="${escapeHtml(item.group)}"
          aria-label="${itemLabel} ${escapeHtml(item.label)}, ${answerState}"
          ${activeClass ? 'aria-current="true"' : ""}
        >
          ${escapeHtml(item.label)}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const question = link.dataset.quickQuestion;
      const target = document.getElementById(`pitanje-${question}`);
      activeQuestionNumber = question;
      updateQuickSelectActiveState();
      target?.scrollIntoView({ block: "start", behavior: "auto" });
      if (target) history.replaceState(null, "", `#pitanje-${question}`);
    });
  });
}

function bindQuickSelectTracking() {
  window.removeEventListener("scroll", queueActiveQuestionUpdate);
  window.addEventListener("scroll", queueActiveQuestionUpdate, { passive: true });
  updateActiveQuestionFromScroll();
}

function queueActiveQuestionUpdate() {
  if (quickSelectFrame) return;
  quickSelectFrame = window.requestAnimationFrame(updateActiveQuestionFromScroll);
}

function updateActiveQuestionFromScroll() {
  quickSelectFrame = undefined;
  const questions = [...document.querySelectorAll("[data-question-number]")];
  if (!questions.length) return;

  const focusLine = Math.min(window.innerHeight * 0.28, 240);
  let activeQuestion = questions[0];
  for (const question of questions) {
    if (question.getBoundingClientRect().top > focusLine) break;
    activeQuestion = question;
  }

  const nextQuestionNumber = activeQuestion.dataset.questionNumber;
  if (nextQuestionNumber === activeQuestionNumber) return;
  activeQuestionNumber = nextQuestionNumber;
  updateQuickSelectActiveState();
}

function updateQuickSelectActiveState() {
  const activeGroup = activeQuickSelectGroup();
  document.querySelectorAll("[data-quick-question]").forEach((link) => {
    const linkGroup = link.dataset.quickGroup || link.dataset.quickQuestion;
    const isActive = linkGroup === activeGroup;
    link.classList.toggle("question-quickselect__link--active", isActive);
    if (isActive) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function renderQuestionResponse(question, number) {
  if (isExcludedQuestion(question)) return window.renderExcludedExamTaskNotice();
  if (question.type === "open") return renderOpenQuestionResponse(question, number);
  if (question.type === "matching") return renderMatchingQuestionResponse(question, number);
  if (question.type === "multi-choice") return renderMultiChoiceQuestionResponse(question, number);
  return renderClosedQuestionResponse(number);
}

function renderClosedQuestionResponse(question) {
  const answer = closedResponses[question] || "";
  const resultClass = isChecked(question)
    ? isCorrectAnswer(question, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="physics-inline-response ${resultClass}">
      <legend>Odgovor na ${escapeHtml(question)}. zadatak</legend>
      <div class="choice-list">
        ${(questionByNumber.get(question)?.options || ["A", "B", "C", "D"])
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${selfCheck.renderButton(question, {
        hidden: simulation.active || checked,
      })}
      ${renderClosedFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = isCorrectAnswer(question, option);
  let resultClass = "";
  if (isChecked(question) && correct) resultClass = " answer-choice--correct";
  if (isChecked(question) && selected && !correct) resultClass = " answer-choice--wrong";

  return `
    <label class="answer-choice${resultClass}">
      <input
        data-question="${escapeHtml(question)}"
        type="radio"
        name="answer-${escapeHtml(question)}"
        value="${option}"
        ${selected ? "checked" : ""}
        ${simulation.inputDisabledAttribute()}
      >
      <span>${option}</span>
    </label>
  `;
}

function renderMultiChoiceQuestionResponse(question, number) {
  const answer = closedResponses[number] || "";
  const selected = selectedAnswers(answer);
  const resultClass = isChecked(number)
    ? isCorrectAnswer(number, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="physics-inline-response ${resultClass}">
      <legend>Odgovor na ${escapeHtml(number)}. zadatak</legend>
      <div class="choice-list">
        ${(question.options || ["A", "B", "C", "D"])
          .map((option) => renderMultiChoiceOption(number, option, selected))
          .join("")}
      </div>
      ${selfCheck.renderButton(number, {
        hidden: simulation.active || checked,
      })}
      ${renderClosedFeedback(number, answer)}
    </fieldset>
  `;
}

function renderMultiChoiceOption(question, option, selected) {
  const isSelected = selected.includes(option);
  const correct = correctAnswers(question).includes(option);
  let resultClass = "";
  if (isChecked(question) && correct) resultClass = " answer-choice--correct";
  if (isChecked(question) && isSelected && !correct) resultClass = " answer-choice--wrong";

  return `
    <label class="answer-choice${resultClass}">
      <input
        data-multi-question="${escapeHtml(question)}"
        type="checkbox"
        name="answer-${escapeHtml(question)}-${option}"
        value="${option}"
        ${isSelected ? "checked" : ""}
        ${simulation.inputDisabledAttribute()}
      >
      <span>${option}</span>
    </label>
  `;
}

function renderMatchingQuestionResponse(question, number) {
  const checkedClass = matchingItemIds(question).every((itemId) => closedResponses[itemId])
    ? " response-question--answered"
    : "";

  return `
    <fieldset class="physics-inline-response art-matching-response ${checkedClass}">
      <legend>Povezivanje u ${escapeHtml(number)}. zadatku</legend>
      <div class="art-matching-response__grid">
        ${(question.itemLabels || ["A", "B", "C", "D", "E", "F"])
          .map((item) => renderMatchingRow(question, item))
          .join("")}
      </div>
      ${selfCheck.renderButton(number, {
        hidden: simulation.active || checked,
      })}
      ${renderMatchingFeedback(question)}
    </fieldset>
  `;
}

function matchingItemIds(question) {
  return (question.scoredItems || []).map((item) => matchingItemId(question.number, item));
}

function renderMatchingRow(question, item) {
  const itemId = matchingItemId(question.number, item);
  const selected = closedResponses[itemId] || "";
  const isScored = correctAnswers(itemId).length > 0;
  const isResolved = isChecked(itemId);
  const isCorrect = isScored && isCorrectAnswer(itemId, selected);
  let resultClass = "";
  if (isResolved && isCorrect) resultClass = " art-matching-response__row--correct";
  if (isResolved && isScored && !isCorrect) resultClass = " art-matching-response__row--wrong";
  if (isResolved && !isScored && selected) resultClass = " art-matching-response__row--unused";

  return `
    <label class="art-matching-response__row${resultClass}">
      <span class="art-matching-response__item">${escapeHtml(item)}</span>
      <select
        data-matching-question="${escapeHtml(question.number)}"
        data-matching-item="${escapeHtml(item)}"
        ${simulation.inputDisabledAttribute()}
      >
        <option value="">-</option>
        ${(question.targetLabels || ["1", "2", "3", "4"])
          .map((target) => `
            <option value="${escapeHtml(target)}" ${selected === target ? "selected" : ""}>
              ${escapeHtml(target)}
            </option>
          `)
          .join("")}
      </select>
    </label>
  `;
}

function renderMatchingFeedback(question) {
  if (!isChecked(question.number)) return "";
  const wrongItems = matchingItemIds(question).filter(
    (itemId) => !isCorrectAnswer(itemId, closedResponses[itemId]),
  );
  if (!wrongItems.length) return `<small class="response-feedback">Točno.</small>`;
  const correct = matchingItemIds(question)
    .map((itemId) => `${itemId.split(".")[1]}-${correctAnswers(itemId)[0]}`)
    .join(", ");
  return `<small class="response-feedback">Točno povezivanje: ${escapeHtml(correct)}.</small>`;
}

function renderClosedFeedback(question, answer) {
  if (!isChecked(question)) return "";
  const answers = correctAnswers(question);
  if (isCorrectAnswer(question, answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${escapeHtml(answers.join(", "))}.</small>`;
}

function renderOpenQuestionResponse(question, number) {
  const maximum = maxPointsForOpenQuestion(number);
  const resultClass = hasOpenScore(number) ? " history-open-question--reviewed" : "";

  return `
    <div class="history-open-question${resultClass}">
      <div class="history-open-question__heading">
        <h4>${escapeHtml(number)}.</h4>
        <span>${maximum} ${maximum === 1 ? "bod" : "bodova"}</span>
      </div>
      ${renderOpenSolution(question, number)}
    </div>
  `;
}

function renderOpenSolution(question, number) {
  const images = Array.isArray(question.solutionImages)
    ? question.solutionImages
    : question.solutionImage
      ? [question.solutionImage]
      : [];
  const solutionHtml = images
    .map((image, index) =>
      renderCroppedImage(image, `Službeno rješenje ${number}. zadatka, dio ${index + 1}.`),
    )
    .join("");
  if (!solutionHtml) {
    return `
      <div class="physics-open-solution">
        <div class="physics-open-solution__controls">
          ${renderOpenScoreInput(number)}
        </div>
      </div>
    `;
  }

  const bodyId = `rjesenje-${slugPart(number)}`;
  return `
    <div class="physics-open-solution">
      <div class="physics-open-solution__controls">
        <button
          class="physics-open-solution__toggle"
          type="button"
          data-open-solution="${escapeHtml(number)}"
          aria-controls="${bodyId}"
          aria-expanded="false"
        >
          Otvori rješenje
        </button>
        ${renderOpenScoreInput(number)}
      </div>
      <div class="physics-open-solution__body" id="${bodyId}" hidden>
        ${solutionHtml}
      </div>
    </div>
  `;
}

function toggleOpenSolution(button) {
  const body = document.getElementById(button.getAttribute("aria-controls"));
  if (!body) return;

  const isOpen = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!isOpen));
  button.textContent = isOpen ? "Otvori rješenje" : "Sakrij rješenje";
  body.hidden = isOpen;
}

function renderOpenScoreInput(number) {
  const maximum = maxPointsForOpenQuestion(number);
  const value = hasOpenScore(number) ? openScores[number] : "";
  return `
    <label class="physics-open-score">
      <span>Bodovi</span>
      <input
        data-open-score="${escapeHtml(number)}"
        type="number"
        min="0"
        max="${maximum}"
        step="1"
        inputmode="numeric"
        value="${value}"
        aria-label="Dodijeljeni bodovi za ${escapeHtml(number)}. zadatak"
        ${simulation.inputDisabledAttribute()}
      >
      <strong>/ ${maximum}</strong>
    </label>
  `;
}

function renderCroppedImage(source, alt, options = {}) {
  return window.renderSourceImageCrop(source, alt, options);
}

function updateClosedResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  const parent = parentQuestionId(question);
  const wasSelfChecked = selfCheck.has(question) || selfCheck.has(parent);
  checked = false;
  selfCheck.delete(question);
  selfCheck.delete(parent);
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) closedResponses[question] = normalizedAnswer;
  else delete closedResponses[question];
  saveState();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
  if (wasChecked || wasSelfChecked) renderTaskTypeContent();
}

function updateMultiChoiceResponse(question) {
  if (simulation.finished) return;

  const selected = [...document.querySelectorAll("[data-multi-question]")]
    .filter((input) => input.dataset.multiQuestion === question && input.checked)
    .map((input) => input.value)
    .sort()
    .join(",");
  updateClosedResponse(question, selected);
}

function updateMatchingResponse(question, item, answer) {
  if (simulation.finished) return;

  const itemId = matchingItemId(question, item);
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) {
    const matchingQuestion = questionByNumber.get(String(question));
    for (const candidate of matchingQuestion?.itemLabels || []) {
      const candidateId = matchingItemId(question, candidate);
      if (candidateId !== itemId && closedResponses[candidateId] === normalizedAnswer) {
        delete closedResponses[candidateId];
        document.querySelectorAll("select[data-matching-question][data-matching-item]").forEach((select) => {
          if (
            select.dataset.matchingQuestion === question
            && select.dataset.matchingItem === candidate
            && select.value === normalizedAnswer
          ) {
            select.value = "";
          }
        });
      }
    }
  }
  updateClosedResponse(itemId, normalizedAnswer);
}

function updateOpenScore(question, value, input) {
  if (simulation.finished) return;

  const maximum = maxPointsForOpenQuestion(question);
  const normalizedValue = String(value).trim();
  if (normalizedValue === "") {
    input.setCustomValidity("");
    delete openScores[question];
    input.closest(".history-open-question")?.classList.remove("history-open-question--reviewed");
    saveState();
    renderTaskTypeNavigation();
    renderSolverSummary();
    renderQuickSelect();
    return;
  }

  const parsedScore = Number(normalizedValue);
  if (!Number.isInteger(parsedScore)) {
    input.setCustomValidity(`Upiši cijeli broj od 0 do ${maximum}.`);
    return;
  }

  const score = Math.min(Math.max(parsedScore, 0), maximum);
  input.setCustomValidity("");
  input.value = String(score);
  openScores[question] = score;
  input.closest(".history-open-question")?.classList.add("history-open-question--reviewed");
  saveState();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
}

async function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    finishingSimulationByCheck = true;
    simulation.finish("submitted");
    try {
      await completeCheck("submitted");
    } finally {
      finishingSimulationByCheck = false;
    }
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

  await completeCheck();
}

async function completeCheck(reason = "") {
  checked = true;
  selfCheck.reset();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  openResultsDialog();
  if (reason === "submitted" || reason === "expired") recordSubmittedSimulation();
  return true;
}

function finishSimulation(reason) {
  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
    completeCheck("expired");
    return;
  }

  if (!finishingSimulationByCheck) {
    completeCheck(reason);
  }
}

function recordSubmittedSimulation() {
  if (!simulation.active || !simulation.finished || simulationRecorded || !window.AsistentProfile) {
    return;
  }

  simulationRecorded = true;
  window.AsistentProfile.recordSimulationAttempt({
    solver: "art-choice",
    subject: "Likovna umjetnost",
    part: "Ispit",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(),
    totalQuestions: allQuestions().length,
    score: totalScore(),
    maxScore: maxScore(),
    percentage: scorePercentage(),
    checkingSupported: true,
  });
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage()}%`;
  document.querySelector("#exam-results-score").textContent = `${totalScore()}/${maxScore()}`;
  document.querySelector("#exam-results-note").textContent = resultsNoteText();
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results").focus();
}

function resultsNoteText() {
  return "Rezultat uključuje zatvorene zadatke i bodove koje si sam dodijelio nakon pregleda službenih rješenja.";
}

function closeResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog || dialog.hidden) return;

  dialog.hidden = true;
  document.body.classList.remove("exam-results-dialog-open");
  document.querySelector("#check-answers")?.focus();
}

function closeResultsDialogOnEscape(event) {
  if (event.key !== "Escape") return;
  closeResultsDialog();
}

function startArtPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(artSubjectUrl());
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam, selectedTaskTypeId(exam));
  else renderMissingExam();
}

if (!simulation.active && window.AsistentProfile?.ready) {
  window.AsistentProfile.ready.finally(startArtPage);
} else {
  startArtPage();
}
