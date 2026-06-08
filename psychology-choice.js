const data = window.ASISTENT_ZA_MATURE_PSYCHOLOGY_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Psihologije.");
}

const app = document.querySelector("#psychology-app");

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
  return `psihologija-${exam.year}-${slugPart(term)}`;
}

function historyStorageKeyForId(id) {
  return `asistent-za-mature:psychology-choice:${id}`;
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

function isExcludedQuestion(question) {
  const item = typeof question === "object"
    ? question
    : questionByNumber.get(String(question));
  return window.isExcludedExamTask(item);
}

function scoredTaskQuestions(task) {
  return (task?.questions || [])
    .filter((question) => !isExcludedQuestion(question))
    .map((question) => String(question.number));
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
  return `./psihologija.html?${params.toString()}`;
}

function historySubjectUrl() {
  return "./?predmet=Psihologija";
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
    openScores: {},
  };

  try {
    for (const key of historyStorageKeys(exam).reverse()) {
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
        knownClosed.has(question) && typeof answer === "string" && /^[A-D]$/.test(answer),
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
      historyStorageKeyForId(solverExam.id),
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
  const closedMaximum = closedQuestionNumbers().length;
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
  return closedQuestionNumbers().filter((question) =>
    isCorrectAnswer(question, closedResponses[question]),
  ).length;
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
  const closed = resolvedClosedQuestions().filter((question) =>
    isCorrectAnswer(question, closedResponses[question]),
  ).length;
  return closed + resolvedOpenScore();
}

function resolvedMaximum() {
  const closedMaximum = resolvedClosedQuestions().length;
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
      <p>Odabrani ispit iz Psihologije nije dostupan.</p>
      <a class="start-link" href="${historySubjectUrl()}">Vrati se na Psihologiju</a>
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
      subject: "Psihologija",
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
  if (question.type === "open") return renderOpenPrompt(question);
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

  document.querySelectorAll("textarea[data-open-question]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      updateOpenResponse(textarea.dataset.openQuestion, textarea.value);
      const container = textarea.closest(".history-open-question");
      const scoreInput = container?.querySelector("[data-open-score]");
      if (scoreInput) scoreInput.value = "";
      container?.classList.remove("history-open-question--reviewed");
    });
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

function renderClosedFeedback(question, answer) {
  if (!isChecked(question)) return "";
  const answers = correctAnswers(question);
  if (answers.includes(answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function renderOpenQuestionResponse(question, number) {
  const answer = openResponses[number] || "";
  const maximum = maxPointsForOpenQuestion(number);
  const resultClass = hasOpenScore(number) ? " history-open-question--reviewed" : "";

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
        >${escapeHtml(answer)}</textarea>
      </label>
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
        <p>Službeno rješenje nije pronađeno u ključu za odgovore.</p>
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
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) openResponses[question] = String(answer);
  else delete openResponses[question];
  delete openScores[question];
  saveState();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
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
    solver: "psychology-choice",
    subject: "Psihologija",
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
