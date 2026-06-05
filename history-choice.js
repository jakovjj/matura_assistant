const data = window.ASISTENT_ZA_MATURE_HISTORY_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Povijesti.");
}

const app = document.querySelector("#history-app");

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
  "kratki-odgovor": "kratki-odgovor",
  kronologija: defaultTaskTypeId,
  "uz-polazni-sadrzaj": "uz-polazni-sadrzaj",
  "produzeni-odgovor": "produzeni-odgovor",
};

let solverExam;
let questionByNumber = new Map();
let closedResponses = {};
let openResponses = {};
let openGrades = {};
let activeTaskTypeId = defaultTaskTypeId;
let activeQuestionNumber;
let checked = false;
let gradingPending = false;
let gradingError = "";
let quickSelectFrame;
let simulationRecorded = false;
let finishingSimulationByCheck = false;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });
const selfCheck = window.createTaskSelfCheck();

function isChecked(question) {
  return checked || selfCheck.has(question);
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
  if (gradingPending) return "Ocjenjivanje...";
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

function historyExamIdForTerm(exam, term) {
  return `povijest-${exam.year}-${slugPart(term)}`;
}

function historyStorageKeyForId(id) {
  return `asistent-za-mature:history-choice:${id}`;
}

function historyStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => historyExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(historyStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(historyExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: historyExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function sourceTasks(exam = solverExam) {
  return exam?.tasks || [];
}

function questionSortKey(question) {
  const [whole, decimal = "0"] = String(question.number || question).split(".");
  return [Number(whole) || 0, Number(decimal) || 0];
}

function sortedQuestions(questions) {
  return [...questions].sort((left, right) => {
    const [leftWhole, leftDecimal] = questionSortKey(left);
    const [rightWhole, rightDecimal] = questionSortKey(right);
    return leftWhole - rightWhole || leftDecimal - rightDecimal;
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

function allQuestions(exam = solverExam) {
  return tasks(exam).flatMap(taskQuestions);
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
  return new Map(
    tasks(exam).flatMap((task) =>
      task.questions.map((question) => [String(question.number), question]),
    ),
  );
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
  return `./povijest.html?${params.toString()}`;
}

function historySubjectUrl() {
  return "./?predmet=Povijest";
}

function correctAnswers(question) {
  const answer = solverExam.answers[question];
  return Array.isArray(answer) ? answer : [answer].filter(Boolean);
}

function isCorrectAnswer(question, answer) {
  return correctAnswers(question).includes(answer);
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
    openGrades: {},
  };

  try {
    for (const key of historyStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (!stored || typeof stored !== "object" || Array.isArray(stored)) continue;

      Object.assign(state.closedResponses, stored.closedResponses || {});
      Object.assign(state.openResponses, stored.openResponses || {});
      Object.assign(state.openGrades, stored.openGrades || {});
    }
  } catch {
    return state;
  }

  state.closedResponses = Object.fromEntries(
    Object.entries(state.closedResponses).filter(
      ([question, answer]) =>
        knownClosed.has(question) && typeof answer === "string" && /^[A-D]$/.test(answer),
    ),
  );
  state.openResponses = Object.fromEntries(
    Object.entries(state.openResponses).filter(
      ([question, answer]) =>
        knownOpen.has(question) && typeof answer === "string" && answer.trim(),
    ),
  );
  state.openGrades = Object.fromEntries(
    Object.entries(state.openGrades).filter(([question, grade]) => {
      const response = state.openResponses[question];
      return (
        knownOpen.has(question) &&
        grade &&
        typeof grade === "object" &&
        !Array.isArray(grade) &&
        typeof grade.answer === "string" &&
        grade.answer === response &&
        Number.isFinite(Number(grade.points))
      );
    }),
  );

  return state;
}

function saveState() {
  if (simulation.active) return;

  try {
    localStorage.setItem(
      historyStorageKeyForId(solverExam.id),
      JSON.stringify({
        closedResponses,
        openResponses,
        openGrades,
      }),
    );
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam = solverExam) {
  const closed = closedQuestionNumbers(exam).filter((question) => closedResponses[question]?.trim()).length;
  const open = openQuestionNumbers(exam).filter((question) => openResponses[question]?.trim()).length;
  return closed + open;
}

function taskAnsweredCount(task) {
  return taskQuestions(task).filter((question) =>
    isOpenQuestion(question) ? openResponses[question]?.trim() : closedResponses[question]?.trim(),
  ).length;
}

function maxScore() {
  const closedMaximum = closedQuestionNumbers().length;
  const openMaximum = openQuestionNumbers().reduce(
    (sum, question) => sum + maxPointsForOpenQuestion(question),
    0,
  );
  return closedMaximum + openMaximum;
}

function openScore() {
  return openQuestionNumbers().reduce((sum, question) => {
    const grade = openGrades[question];
    if (!grade) return sum;
    return sum + Math.max(0, Math.min(maxPointsForOpenQuestion(question), Number(grade.points) || 0));
  }, 0);
}

function closedScore() {
  return closedQuestionNumbers().filter((question) =>
    isCorrectAnswer(question, closedResponses[question]),
  ).length;
}

function totalScore() {
  return closedScore() + openScore();
}

// Running result over revealed tasks: individually checked closed questions
// plus any AI-graded open questions (all of them once the whole exam is
// checked). Matches totalScore()/maxScore() when checked is true.
function resolvedClosedQuestions() {
  return closedQuestionNumbers().filter((question) => isChecked(question));
}

function resolvedScore() {
  const closed = resolvedClosedQuestions().filter((question) =>
    isCorrectAnswer(question, closedResponses[question]),
  ).length;
  return closed + openScore();
}

function resolvedMaximum() {
  const closedMaximum = resolvedClosedQuestions().length;
  const openMaximum = (checked
    ? openQuestionNumbers()
    : openQuestionNumbers().filter((question) => openGrades[question])
  ).reduce((sum, question) => sum + maxPointsForOpenQuestion(question), 0);
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
      <p>Odabrani ispit iz Povijesti nije dostupan.</p>
      <a class="start-link" href="${historySubjectUrl()}">Vrati se na Povijest</a>
    </div>
  `;
}

function renderSolver(exam, taskTypeId) {
  document.body.classList.add("solver-page", "history-solver-page");
  app.classList.add("history-solver-active");
  solverExam = exam;
  questionByNumber = buildQuestionMap(exam);
  const state = simulation.active ? { closedResponses: {}, openResponses: {}, openGrades: {} } : loadState(exam);
  closedResponses = state.closedResponses;
  openResponses = state.openResponses;
  openGrades = state.openGrades;
  activeTaskTypeId = normalizeTaskTypeId(taskTypeId, exam);
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0] || allQuestions(exam)[0];
  checked = false;
  selfCheck.reset();
  gradingPending = false;
  gradingError = "";
  simulationRecorded = false;

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Povijest",
      exam,
      backHref: historySubjectUrl(),
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

    <div id="history-grading-status" aria-live="polite"></div>

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
        <p>
          Rezultat obuhvaća ABCD zadatke i otvorene zadatke koji su AI ocijenjeni.
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
  renderGradingStatus();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskTypeNavigation() {
  const navigationHtml = tasks()
    .map((task) => {
      const isActive = task.id === activeTaskTypeId;
      const gradingNote = taskQuestions(task).some((question) => isOpenQuestion(question))
        ? `<em class="task-button__grading">(AI ispravljanje)</em>`
        : "";
      return `
        <a
          class="task-button${isActive ? " task-button--active" : ""}"
          href="${examUrl(solverExam, task.id)}"
          data-task-type="${task.id}"
          ${isActive ? 'aria-current="true"' : ""}
        >
          <strong>${escapeHtml(task.label)}</strong>
          <small>${taskAnsweredCount(task)}/${taskQuestions(task).length}</small>
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
  checkButton.disabled = gradingPending || (complete === 0 && !checked && !simulation.finished);
  checkButton.className = checkButtonClass();
  checkButton.innerHTML = renderCheckButtonContent();

  const resolvedMax = resolvedMaximum();
  const score = resolvedMax ? `${resolvedScore()}/${resolvedMax} bodova` : "";
  document.querySelector("#score-summary").textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderGradingStatus() {
  const target = document.querySelector("#history-grading-status");
  if (!target) return;

  if (gradingPending) {
    target.innerHTML = `<p class="practice-notice">AI ocjenjivanje otvorenih zadataka je u tijeku.</p>`;
    return;
  }

  if (gradingError) {
    target.innerHTML = `<p class="practice-notice practice-notice--error">${escapeHtml(gradingError)}</p>`;
    return;
  }

  target.innerHTML = "";
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
  if (question.type === "open") return renderOpenPrompt(question);
  return `
    <p class="history-open-question__prompt">
      Pronađi ${escapeHtml(number)}. zadatak u službenoj PDF knjižici i odaberi odgovor.
    </p>
  `;
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateClosedResponse(input.dataset.question, input.value));
  });

  document.querySelectorAll("textarea[data-open-question]").forEach((textarea) => {
    textarea.addEventListener("input", () => updateOpenResponse(textarea.dataset.openQuestion, textarea.value));
  });

  selfCheck.bind(document.querySelector("#task-content-panel"), toggleSelfCheck);
}

function toggleSelfCheck(question) {
  if (simulation.active || checked) return;
  selfCheck.toggle(question, Boolean(closedResponses[question]));
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
}

function quickSelectGroupNumber(question) {
  return String(question).split(".")[0];
}

function quickSelectItems() {
  const items = [];
  for (const question of questionsForTaskType()) {
    const number = String(question);
    const group = quickSelectGroupNumber(number);
    const previousItem = items[items.length - 1];
    if (previousItem?.group === group) {
      previousItem.questions.push(number);
      continue;
    }

    items.push({
      label: group,
      target: number,
      group,
      questions: [number],
    });
  }
  return items;
}

function quickSelectAnswerState(item) {
  const answeredCountForItem = item.questions.filter((question) =>
    isOpenQuestion(question) ? openResponses[question]?.trim() : closedResponses[question]?.trim(),
  ).length;
  if (answeredCountForItem === item.questions.length) return "odgovoreno";
  if (answeredCountForItem > 0) return "djelomično odgovoreno";
  return "nije odgovoreno";
}

function activeQuickSelectGroup() {
  return quickSelectGroupNumber(activeQuestionNumber);
}

function quickSelectResultIsCorrect(item) {
  return item.questions.every((question) => {
    if (isOpenQuestion(question)) {
      const grade = openGrades[question];
      return grade && Number(grade.points) >= maxPointsForOpenQuestion(question);
    }
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
      const isAnswered = item.questions.every((question) =>
        isOpenQuestion(question) ? openResponses[question]?.trim() : closedResponses[question]?.trim(),
      );
      const stateClass = isAnswered ? " question-quickselect__link--answered" : "";
      const itemResolved = item.questions.every((question) =>
        isOpenQuestion(question) ? Boolean(openGrades[question]) : isChecked(question),
      );
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
  if (question.type === "open") return renderOpenQuestionResponse(question, number);
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
      <span class="physics-inline-response__label">Odaberi odgovor</span>
      <div class="choice-list">
        ${["A", "B", "C", "D"]
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${selfCheck.renderButton(question, {
        answered: Boolean(answer),
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

function renderClosedFeedback(question, answer) {
  if (!isChecked(question)) return "";
  const answers = correctAnswers(question);
  if (answers.includes(answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function renderOpenQuestionResponse(question, number) {
  const answer = openResponses[number] || "";
  const grade = openGrades[number];
  const maximum = maxPointsForOpenQuestion(number);
  const resultClass = checked && grade
    ? Number(grade.points) >= maximum
      ? " history-open-question--correct"
      : " history-open-question--reviewed"
    : "";

  return `
    <div class="history-open-question${resultClass}">
      <div class="history-open-question__heading">
        <h4>${escapeHtml(number)}.</h4>
        <span>${maximum} ${maximum === 1 ? "bod" : "bodova"}</span>
      </div>
      <label class="history-open-question__field">
        <span>Odgovor</span>
        <textarea
          data-open-question="${escapeHtml(number)}"
          rows="${maximum > 1 ? 8 : 3}"
          ${simulation.inputDisabledAttribute()}
          ${gradingPending ? "disabled" : ""}
        >${escapeHtml(answer)}</textarea>
      </label>
      ${renderOpenFeedback(number, grade)}
    </div>
  `;
}

function renderOpenPrompt(question) {
  const prompt = String(question.prompt || "").trim();
  if (!prompt) {
    return `<p class="history-open-question__prompt">Pronađi zadatak u službenoj PDF knjižici i upiši odgovor.</p>`;
  }

  return `
    <div class="history-open-question__prompt">
      ${prompt
        .split("\n")
        .map((line) => `<p>${escapeHtml(line)}</p>`)
        .join("")}
    </div>
  `;
}

function renderCroppedImage(source, alt, options = {}) {
  const crop = source?.crop;
  const dimensions = [
    source?.width,
    source?.height,
    crop?.x,
    crop?.y,
    crop?.width,
    crop?.height,
  ].map(Number);
  if (!source?.url || dimensions.some((value) => !Number.isFinite(value) || value < 0)) return "";
  if (!source.width || !source.height || !crop.width || !crop.height) return "";

  const width = (source.width / crop.width) * 100;
  const offsetX = (-crop.x / source.width) * 100;
  const offsetY = (-crop.y / source.height) * 100;
  const cropClass = options.cropClass ? ` ${options.cropClass}` : "";

  return `
    <figure class="physics-source-figure">
      <div class="physics-source-crop${cropClass}" style="aspect-ratio: ${crop.width} / ${crop.height}">
        <img
          src="${escapeHtml(source.url)}"
          alt="${escapeHtml(alt)}"
          width="${source.width}"
          height="${source.height}"
          loading="lazy"
          decoding="async"
          style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
        >
        ${options.overlayHtml || ""}
      </div>
    </figure>
  `;
}

function renderOpenFeedback(question, grade) {
  if (!checked) return "";
  if (!openResponses[question]?.trim()) {
    return `<p class="response-feedback">Nema upisanoga odgovora.</p>`;
  }
  if (!grade) {
    return `<p class="response-feedback">Ovaj otvoreni zadatak još nije AI ocijenjen.</p>`;
  }

  const maximum = maxPointsForOpenQuestion(question);
  return `
    <div class="history-open-feedback">
      <strong>${escapeHtml(grade.points)}/${maximum} bodova</strong>
      <p>${escapeHtml(grade.comment || "AI komentar nije dostupan.")}</p>
      <details>
        <summary>Službeni model odgovora</summary>
        ${renderOfficialModelAnswer(solverExam.openAnswers?.[question]?.modelAnswer)}
      </details>
    </div>
  `;
}

function renderOfficialModelAnswer(value) {
  const blocks = officialModelAnswerBlocks(value);
  if (!blocks.length) {
    return `<p class="history-model-answer history-model-answer--empty">Službeni model odgovora nije dostupan.</p>`;
  }

  return `
    <div class="history-model-answer">
      ${blocks.map(renderOfficialModelAnswerBlock).join("")}
    </div>
  `;
}

function renderOfficialModelAnswerBlock(block) {
  if (block.type === "list") {
    return `
      <ul>
        ${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    `;
  }

  return `<p>${escapeHtml(block.text)}</p>`;
}

function officialModelAnswerBlocks(value) {
  const lines = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replaceAll("\uf0b7", "•")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.trim());
  const blocks = [];
  let paragraph = "";
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph) return;
    blocks.push({ type: "paragraph", text: paragraph });
    paragraph = "";
  };
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  };

  for (const line of lines) {
    if (!line || /^MODEL MOGU[ĆC]EGA TO[ČC]NOG[ A]* ODGOVORA:?$/i.test(line)) {
      flushParagraph();
      flushList();
      continue;
    }

    const listMatch = line.match(/^[•*▪▫‣-]\s*(.+)$/u);
    if (listMatch) {
      flushParagraph();
      listItems.push(listMatch[1].trim());
      continue;
    }

    flushList();
    paragraph = paragraph ? `${paragraph} ${line}` : line;
    if (/[.!?]$/.test(line) && paragraph.length >= 360) flushParagraph();
  }

  flushParagraph();
  flushList();
  return blocks;
}

function updateClosedResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  const wasSelfChecked = selfCheck.has(question);
  checked = false;
  selfCheck.delete(question);
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) closedResponses[question] = normalizedAnswer;
  else delete closedResponses[question];
  saveState();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
  if (wasChecked || wasSelfChecked) renderTaskTypeContent();
}

function updateOpenResponse(question, answer) {
  if (simulation.finished) return;

  checked = false;
  gradingError = "";
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) openResponses[question] = String(answer);
  else delete openResponses[question];
  delete openGrades[question];
  saveState();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderGradingStatus();
  renderQuickSelect();
}

async function checkAnswers() {
  if (gradingPending) return;

  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    finishingSimulationByCheck = true;
    simulation.finish("submitted");
    await completeCheck("submitted");
    finishingSimulationByCheck = false;
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
  await gradeOpenAnswersForCheck();
  checked = true;
  selfCheck.reset();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderGradingStatus();
  renderTaskTypeContent();
  openResultsDialog();
  if (reason === "submitted" || reason === "expired") recordSubmittedSimulation();
}

function openAnswersNeedingGrade() {
  return Object.fromEntries(
    openQuestionNumbers()
      .filter((question) => {
        const answer = openResponses[question]?.trim();
        if (!answer) return false;
        return openGrades[question]?.answer !== openResponses[question];
      })
      .map((question) => [question, openResponses[question]]),
  );
}

async function gradeOpenAnswersForCheck() {
  const answers = openAnswersNeedingGrade();
  if (!Object.keys(answers).length) {
    gradingError = "";
    return;
  }

  gradingPending = true;
  gradingError = "";
  renderGradingStatus();
  renderSolverSummary();
  renderTaskTypeContent();

  try {
    const payload = await requestOpenGrades(answers);
    for (const grade of payload.grades || []) {
      const question = String(grade.question);
      if (!openResponses[question]) continue;
      openGrades[question] = {
        answer: openResponses[question],
        points: Math.max(0, Math.min(maxPointsForOpenQuestion(question), Number(grade.points) || 0)),
        comment: String(grade.comment || "").trim(),
      };
    }
    saveState();
  } catch (error) {
    gradingError = error.message || "AI ocjenjivanje otvorenih zadataka nije uspjelo.";
  } finally {
    gradingPending = false;
  }
}

async function requestOpenGrades(answers) {
  const response = await fetch("/api/history/grade-open", {
    body: JSON.stringify({
      examId: solverExam.id,
      answers,
    }),
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("API za AI ocjenjivanje nije dostupan. Pokreni stranicu preko Node servera.");
  }

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "AI ocjenjivanje nije uspjelo.");
  return payload;
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
    solver: "history-choice",
    subject: "Povijest",
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
  dialog.hidden = false;
  document.body.classList.add("exam-results-dialog-open");
  document.querySelector("#close-exam-results").focus();
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

function startHistoryPage() {
  const id = selectedExamId();
  if (!id) {
    window.location.replace(historySubjectUrl());
    return;
  }

  const exam = examsById.get(id);
  if (exam) renderSolver(exam, selectedTaskTypeId(exam));
  else renderMissingExam();
}

if (!simulation.active && window.AsistentProfile?.ready) {
  window.AsistentProfile.ready.finally(startHistoryPage);
} else {
  startHistoryPage();
}
