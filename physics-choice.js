const data = window.ASISTENT_ZA_MATURE_PHYSICS_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Fizike.");
}

const app = document.querySelector("#physics-app");

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

const taskTypes = {
  choice: "visestruki-izbor",
  open: "otvoreni-zadatci",
};
const taskTypeAliases = {
  "visestruki-izbor": taskTypes.choice,
  "produzeni-odgovor": taskTypes.open,
  "otvoreni-zadatci": taskTypes.open,
};

let solverExam;
let questionByNumber = new Map();
let responses = {};
let openScores = {};
let activeTaskTypeId = "visestruki-izbor";
let checked = false;
let activeQuestionNumber;
let quickSelectFrame;
const simulation = window.createExamSimulation({ onFinish: finishSimulation });

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function icon(iconName, className) {
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

function choiceExamIdForTerm(exam, term) {
  return `fizika-${exam.year}-${slugPart(term)}`;
}

function choiceStorageKeyForId(id) {
  return `asistent-za-mature:physics-choice:${id}`;
}

function choiceStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => choiceExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(choiceStorageKeyForId);
}

function openScoreStorageKeys(exam) {
  return choiceStorageKeys(exam).map((key) => `${key}:open-scores`);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(choiceExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: choiceExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function taskQuestions(tasks = []) {
  return tasks.flatMap((task) => task.questions.map((question) => question.number));
}

function choiceTasks(exam = solverExam) {
  return exam?.tasks || [];
}

function openTasks(exam = solverExam) {
  return exam?.openTasks || [];
}

function choiceQuestions(exam = solverExam) {
  return taskQuestions(choiceTasks(exam));
}

function openQuestions(exam = solverExam) {
  return taskQuestions(openTasks(exam));
}

function allQuestions(exam = solverExam) {
  return [...choiceQuestions(exam), ...openQuestions(exam)];
}

function questionsForTaskType(taskTypeId, exam = solverExam) {
  return taskTypeId === taskTypes.open
    ? openQuestions(exam)
    : choiceQuestions(exam);
}

function buildQuestionMap(exam) {
  return new Map(
    [
      ...choiceTasks(exam).flatMap((task) =>
        task.questions.map((question) => [
          String(question.number),
          { ...question, kind: taskTypes.choice },
        ]),
      ),
      ...openTasks(exam).flatMap((task) =>
        task.questions.map((question) => [
          String(question.number),
          { ...question, kind: taskTypes.open },
        ]),
      ),
    ],
  );
}

function questionKind(question) {
  return questionByNumber.get(String(question))?.kind || taskTypes.choice;
}

function isValidStoredResponse(question, answer) {
  if (typeof answer !== "string" || !answer.trim()) return false;
  return /^[A-D]$/.test(answer);
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    questionByNumber = questionByNumber.size ? questionByNumber : buildQuestionMap(exam);
    const knownQuestions = new Set(choiceQuestions(exam).map(String));
    for (const key of choiceStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) =>
          knownQuestions.has(question) && isValidStoredResponse(question, answer),
      ),
    );
  } catch {
    return {};
  }
}

function saveResponses() {
  if (simulation.active) return;

  try {
    localStorage.setItem(choiceStorageKeyForId(solverExam.id), JSON.stringify(responses));
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function maxPointsForOpenQuestion(question) {
  const configuredMaximum = Number(question?.maxPoints);
  if (Number.isInteger(configuredMaximum) && configuredMaximum >= 0) {
    return configuredMaximum;
  }

  const match = String(question?.points || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function isValidStoredOpenScore(question, score) {
  const maximum = maxPointsForOpenQuestion(question);
  if (!Number.isInteger(maximum)) return false;
  if (!Number.isInteger(score)) return false;
  return score >= 0 && score <= maximum;
}

function loadOpenScores(exam) {
  const storedScores = {};
  try {
    const knownQuestions = new Set(openQuestions(exam).map(String));
    for (const key of openScoreStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedScores, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedScores).filter(([question, score]) => {
        const sourceQuestion = questionByNumber.get(question);
        return knownQuestions.has(question) && isValidStoredOpenScore(sourceQuestion, score);
      }),
    );
  } catch {
    return {};
  }
}

function saveOpenScores() {
  if (simulation.active) return;

  try {
    localStorage.setItem(
      `${choiceStorageKeyForId(solverExam.id)}:open-scores`,
      JSON.stringify(openScores),
    );
  } catch {
    // Self-review still works if storage is unavailable.
  }
}

function hasOpenScore(question) {
  return Object.prototype.hasOwnProperty.call(openScores, question);
}

function openScoredCount() {
  return openQuestions().filter((question) => hasOpenScore(question)).length;
}

function answeredCount(exam = solverExam, storedResponses = responses, storedOpenScores = openScores) {
  const choiceAnswered = choiceQuestions(exam).filter(
    (question) => storedResponses[question]?.trim(),
  ).length;
  const openReviewed = openQuestions(exam).filter((question) =>
    Object.prototype.hasOwnProperty.call(storedOpenScores, question),
  ).length;
  return choiceAnswered + openReviewed;
}

function choiceAnsweredCount() {
  return choiceQuestions().filter((question) => responses[question]?.trim()).length;
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function normalizeTaskTypeId(taskTypeId) {
  return taskTypeAliases[taskTypeId] || taskTypes.choice;
}

function selectedTaskTypeId() {
  const params = new URLSearchParams(window.location.search);
  return normalizeTaskTypeId(params.get("vrsta") || params.get("cjelina"));
}

function examUrl(exam, taskTypeId = "visestruki-izbor") {
  const params = new URLSearchParams({ exam: exam.id });
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId !== taskTypes.choice) {
    params.set("vrsta", normalizedTaskTypeId);
  }
  if (simulation.active) params.set("nacin", "simulacija");
  return `./fizika.html?${params.toString()}`;
}

function physicsSubjectUrl() {
  return "./?predmet=Fizika";
}

function renderText(value) {
  return escapeHtml(value).replace(/\n/g, "<br>");
}

function correctAnswers(question) {
  const answer = solverExam.answers[question];
  return Array.isArray(answer) ? answer : [answer].filter(Boolean);
}

function isCorrectAnswer(question, answer) {
  return correctAnswers(question).includes(answer);
}

function questionOptions(question) {
  const sourceQuestion = questionByNumber.get(String(question));
  return Object.keys(sourceQuestion?.options || { A: "", B: "", C: "", D: "" });
}

function renderMissingExam() {
  document.body.classList.remove("solver-page", "physics-solver-page");
  app.classList.remove("physics-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit iz Fizike nije dostupan.</p>
      <a class="start-link" href="${physicsSubjectUrl()}">Vrati se na Fiziku</a>
    </div>
  `;
}

function renderSolver(exam, taskTypeId = "visestruki-izbor") {
  document.body.classList.add("solver-page", "physics-solver-page");
  app.classList.add("physics-solver-active");
  solverExam = exam;
  questionByNumber = buildQuestionMap(exam);
  responses = simulation.active ? {} : loadResponses(exam);
  openScores = simulation.active ? {} : loadOpenScores(exam);
  activeTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (activeTaskTypeId === taskTypes.open && !openQuestions(exam).length) {
    activeTaskTypeId = taskTypes.choice;
  }
  checked = false;
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0] || allQuestions(exam)[0];

  app.innerHTML = `
    ${renderSolverHeader({
      subject: "Fizika",
      exam,
      backHref: physicsSubjectUrl(),
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
        <p>
          Rezultat obuhvaća sve vrste zadataka. Zatvori prozor i pregledaj
          označene odgovore i službena rješenja.
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
  const choiceAnswered = choiceAnsweredCount();
  const choiceTotal = choiceQuestions().length;
  const openTotal = openQuestions().length;
  const openScored = openScoredCount();
  const openNavigation = openTotal
    ? `<a
        class="task-button${activeTaskTypeId === taskTypes.open ? " task-button--active" : ""}"
        href="${examUrl(solverExam, taskTypes.open)}"
        data-task-type="${taskTypes.open}"
        ${activeTaskTypeId === taskTypes.open ? 'aria-current="true"' : ""}
      >
        <strong>Otvoreni zadatci</strong>
        <small>${openScored}/${openTotal}</small>
      </a>`
    : "";

  const navigationHtml = `
    <a
      class="task-button${activeTaskTypeId === taskTypes.choice ? " task-button--active" : ""}"
      href="${examUrl(solverExam)}"
      data-task-type="${taskTypes.choice}"
      ${activeTaskTypeId === taskTypes.choice ? 'aria-current="true"' : ""}
    >
      <strong>Zadatci višestrukoga izbora</strong>
      <small>${choiceAnswered}/${choiceTotal}</small>
    </a>
    ${openNavigation}
  `;

  document.querySelectorAll("[data-task-type-navigation]").forEach((navigation) => {
    navigation.innerHTML = navigationHtml;
  });
  bindTaskTypeNavigation();
}

function bindTaskTypeNavigation() {
  document.querySelectorAll("[data-task-type]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectTaskType(link.dataset.taskType);
    });
  });
}

function selectTaskType(taskTypeId) {
  const normalizedTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (normalizedTaskTypeId === activeTaskTypeId) return;
  if (normalizedTaskTypeId === taskTypes.open && !openQuestions().length) return;

  activeTaskTypeId = normalizedTaskTypeId;
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId)[0];
  history.replaceState(null, "", examUrl(solverExam, activeTaskTypeId));
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  document.querySelector("#section-content")?.scrollIntoView({ block: "start" });
}

function renderTaskTypeContent() {
  if (activeTaskTypeId === taskTypes.open && !openQuestions().length) {
    document.querySelector("#section-content").innerHTML = `
      <div class="empty-state practice-section-empty">
        <h2>Otvoreni zadatci</h2>
        <p>Nema definiranih otvorenih zadataka za ovaj ispit.</p>
        <a class="start-link" href="${examUrl(solverExam)}">Vrati se na višestruki izbor</a>
      </div>
    `;
    return;
  }

  document.querySelector("#section-content").innerHTML = `
    <div class="solver-question-layout">
      <section class="task-content-panel physics-task-content-panel" id="task-content-panel"></section>
      <aside class="question-quickselect" aria-label="Brzi odabir pitanja">
        <div class="question-quickselect__heading">
          <strong>Brzi odabir</strong>
          <small>Pitanja</small>
        </div>
        <nav class="question-quickselect__list" id="question-quickselect"></nav>
      </aside>
    </div>
  `;

  renderTaskContent();
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

  const scoreSummary = document.querySelector("#score-summary");
  const footerScoreSummary = document.querySelector("#footer-score-summary");
  const score = checked ? `${totalScore()}/${maximumScore()} bodova` : "";
  scoreSummary.textContent = score;
  footerScoreSummary.textContent = score;
}

function renderTaskContent() {
  const questions = questionsForTaskType(activeTaskTypeId)
    .map((question) => questionByNumber.get(String(question)))
    .filter(Boolean);
  const isOpenTaskType = activeTaskTypeId === taskTypes.open;
  const title = isOpenTaskType
    ? "Otvoreni zadatci"
    : "Zadatci višestrukoga izbora";
  const eyebrow = isOpenTaskType ? "Pitanja i službena rješenja" : "Pitanja iz knjižice";
  const summary = isOpenTaskType
    ? "Pregledaj službeno rješenje i upiši osvojene bodove."
    : `Pitanja ${questions[0].number}-${questions[questions.length - 1].number}`;

  document.querySelector("#task-content-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h3>${title}</h3>
      </div>
      <small>${summary}</small>
    </div>
    <div class="task-source physics-source-list">
      ${questions.map(renderSourceQuestion).join("")}
    </div>
  `;
  bindResponseListeners();
  renderQuickSelect();
  bindQuickSelectTracking();
}

function renderSourceQuestion(question) {
  const sourceImage = renderSourceImage(question);
  return `
    <article
      class="physics-source-question${sourceImage ? " physics-source-question--image" : ""}"
      id="pitanje-${question.number}"
      data-question-number="${question.number}"
    >
      ${sourceImage ? "" : `<h4>${question.number}.</h4>`}
      ${renderOpenQuestionMeta(question)}
      <div class="physics-source-question__body">
        ${sourceImage || renderSourceTranscript(question)}
      </div>
      ${renderQuestionResponse(question)}
    </article>
  `;
}

function renderOpenQuestionMeta(question) {
  if (question.kind !== taskTypes.open) return "";
  const points = question.points
    ? `<span>${escapeHtml(question.points)}</span>`
    : "";
  return `
    <div class="physics-source-question__meta">
      <strong>${question.number}. zadatak</strong>
      ${points}
    </div>
  `;
}

function renderSourceImage(question) {
  const alt = `Izvorni prikaz ${question.number}. pitanja iz službene PDF knjižice.`;
  return renderCroppedImage(question.sourceImage, alt);
}

function renderSolutionImage(question) {
  const alt = `Službena stranica rješenja za ${question.number}. pitanje iz ključa za odgovore.`;
  return renderCroppedImage(question.solutionImage, alt);
}

function renderCroppedImage(source, alt) {
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

  return `
    <figure class="physics-source-figure">
      <div
        class="physics-source-crop"
        style="aspect-ratio: ${crop.width} / ${crop.height}"
      >
        <img
          src="${escapeHtml(source.url)}"
          alt="${escapeHtml(alt)}"
          width="${source.width}"
          height="${source.height}"
          loading="lazy"
          decoding="async"
          style="width: ${width}%; transform: translate(${offsetX}%, ${offsetY}%);"
        >
      </div>
    </figure>
  `;
}

function renderSourceTranscript(question) {
  return `
    <p>${renderText(question.text)}</p>
    ${
      question.options
        ? `<div class="physics-source-options">
            ${Object.entries(question.options)
              .map(([option, text]) => renderSourceOption(option, text))
              .join("")}
          </div>`
        : ""
    }
  `;
}

function renderSourceOption(option, text) {
  return `
    <div class="physics-source-option">
      <strong>${escapeHtml(option)}</strong>
      <span>${text ? renderText(text) : "Grafička opcija iz službene PDF knjižice."}</span>
    </div>
  `;
}

function bindResponseListeners() {
  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });
  document.querySelectorAll("[data-open-score]").forEach((input) => {
    input.addEventListener("input", () => updateOpenScore(input.dataset.openScore, input.value, input));
  });
  document.querySelectorAll("[data-open-solution]").forEach((button) => {
    button.addEventListener("click", () => toggleOpenSolution(button));
  });
}

function renderQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = questionsForTaskType(activeTaskTypeId);
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 2;

  quickSelect.innerHTML = questions
    .map((question) => {
      const answer = responses[question];
      const isChoiceTaskType = activeTaskTypeId === taskTypes.choice;
      const isOpenTaskScored = !isChoiceTaskType && hasOpenScore(question);
      const stateClass = (isChoiceTaskType && answer) || isOpenTaskScored
        ? " question-quickselect__link--answered"
        : "";
      const resultClass = checked && isChoiceTaskType
        ? isCorrectAnswer(question, answer)
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const answerState = isChoiceTaskType
        ? answer
          ? "odgovoreno"
          : "nije odgovoreno"
        : isOpenTaskScored
          ? "odgovoreno"
          : "nije odgovoreno";
      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}"
          href="#pitanje-${question}"
          data-quick-question="${question}"
          aria-label="Pitanje ${question}, ${answerState}"
        >
          ${question}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const questionNumber = Number(link.dataset.quickQuestion);
      const target = document.getElementById(`pitanje-${questionNumber}`);
      activeQuestionNumber = questionNumber;
      updateQuickSelectActiveState();
      target?.scrollIntoView({ block: "start", behavior: "auto" });
      if (target) history.replaceState(null, "", `#pitanje-${questionNumber}`);
    });
  });
  updateQuickSelectActiveState();
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

  const nextQuestionNumber = Number(activeQuestion.dataset.questionNumber);
  if (nextQuestionNumber === activeQuestionNumber) return;
  activeQuestionNumber = nextQuestionNumber;
  updateQuickSelectActiveState();
}

function updateQuickSelectActiveState() {
  document.querySelectorAll("[data-quick-question]").forEach((link) => {
    const isActive = Number(link.dataset.quickQuestion) === activeQuestionNumber;
    link.classList.toggle("question-quickselect__link--active", isActive);
    if (isActive) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function renderQuestionResponse(question) {
  if (question.kind === taskTypes.open) {
    return renderOpenSolution(question);
  }
  return renderQuestion(question.number);
}

function renderQuestion(question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? isCorrectAnswer(question, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="physics-inline-response ${resultClass}">
      <legend>Odgovor na ${question}. pitanje</legend>
      <span class="physics-inline-response__label">Odaberi odgovor</span>
      <div class="choice-list">
        ${questionOptions(question)
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = isCorrectAnswer(question, option);
  let resultClass = "";
  if (checked && correct) resultClass = " answer-choice--correct";
  if (checked && selected && !correct) resultClass = " answer-choice--wrong";

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
  if (!checked) return "";
  const answers = correctAnswers(question);
  if (answers.includes(answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function renderOpenSolution(question) {
  const solutionImage = renderSolutionImage(question);
  if (!solutionImage) {
    return `
      <div class="physics-open-solution">
        <p>Službeno rješenje nije pronađeno u ključu za odgovore.</p>
      </div>
    `;
  }

  const bodyId = `rjesenje-${question.number}`;
  return `
    <div class="physics-open-solution">
      <div class="physics-open-solution__controls">
        <button
          class="physics-open-solution__toggle"
          type="button"
          data-open-solution="${question.number}"
          aria-controls="${bodyId}"
          aria-expanded="false"
        >
          Otvori rješenje
        </button>
        ${renderOpenScoreInput(question)}
      </div>
      <div class="physics-open-solution__body" id="${bodyId}" hidden>
        ${solutionImage}
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

function renderOpenScoreInput(question) {
  const maximum = maxPointsForOpenQuestion(question);
  if (!Number.isInteger(maximum)) return "";

  const value = hasOpenScore(question.number) ? openScores[question.number] : "";
  return `
    <label class="physics-open-score">
      <span>Bodovi</span>
      <input
        data-open-score="${question.number}"
        type="number"
        min="0"
        max="${maximum}"
        step="1"
        inputmode="numeric"
        value="${value}"
        aria-label="Dodijeljeni bodovi za ${question.number}. zadatak"
        ${simulation.inputDisabledAttribute()}
      >
      <strong>/ ${maximum}</strong>
    </label>
  `;
}

function updateOpenScore(question, value, input) {
  if (simulation.finished) return;

  const sourceQuestion = questionByNumber.get(String(question));
  const maximum = maxPointsForOpenQuestion(sourceQuestion);
  const normalizedValue = String(value).trim();
  if (normalizedValue === "") {
    input.setCustomValidity("");
    delete openScores[question];
    saveOpenScores();
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
  saveOpenScores();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  checked = false;
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  saveResponses();
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderQuickSelect();
  if (wasChecked) renderTaskTypeContent();
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  if (checked) {
    checked = false;
    closeResultsDialog();
    renderTaskTypeNavigation();
    renderSolverSummary();
    renderTaskTypeContent();
    return;
  }

  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  openResultsDialog();
}

function finishSimulation(reason) {
  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();

  if (reason === "submitted") recordSubmittedSimulation();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
  openResultsDialog();
}

function recordSubmittedSimulation() {
  if (!window.AsistentProfile) return;

  window.AsistentProfile.recordSimulationAttempt({
    solver: "physics-choice",
    subject: "Fizika",
    part: "Cijeli ispit",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(solverExam),
    totalQuestions: allQuestions(solverExam).length,
    score: totalScore(),
    maxScore: maximumScore(),
    percentage: scorePercentage(),
    checkingSupported: true,
  });
}

function totalScore() {
  return scoreForQuestions(choiceQuestions()) + openScoreTotal();
}

function openScoreTotal() {
  return openQuestions().reduce((score, question) => {
    return score + (hasOpenScore(question) ? openScores[question] : 0);
  }, 0);
}

function maximumScore() {
  return choiceQuestions().length + openQuestions().reduce((score, question) => {
    return score + (maxPointsForOpenQuestion(questionByNumber.get(String(question))) || 0);
  }, 0);
}

function scoreForQuestions(questions) {
  return questions.filter((question) => isCorrectAnswer(question, responses[question])).length;
}

function scorePercentage() {
  const maximum = maximumScore();
  return maximum ? Math.round((totalScore() / maximum) * 100) : 0;
}

function openResultsDialog() {
  const dialog = document.querySelector("#exam-results-dialog");
  if (!dialog) return;

  document.querySelector("#exam-results-percentage").textContent = `${scorePercentage()}%`;
  document.querySelector("#exam-results-score").textContent = `${totalScore()}/${maximumScore()}`;
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
  if (event.key === "Escape") closeResultsDialog();
}

const id = selectedExamId();
if (!id) {
  window.location.replace(physicsSubjectUrl());
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam, selectedTaskTypeId());
  else renderMissingExam();
}
