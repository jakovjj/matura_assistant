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

const physicsSubjectColor = "#225b67";
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

function allQuestions(exam) {
  return choiceQuestions(exam);
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
    const knownQuestions = new Set(allQuestions(exam).map(String));
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

function answeredCount(exam, storedResponses = responses) {
  return allQuestions(exam).filter((question) => storedResponses[question]?.trim()).length;
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
  activeTaskTypeId = normalizeTaskTypeId(taskTypeId);
  if (activeTaskTypeId === taskTypes.open && !openQuestions(exam).length) {
    activeTaskTypeId = taskTypes.choice;
  }
  checked = false;
  activeQuestionNumber = questionsForTaskType(activeTaskTypeId, exam)[0] || allQuestions(exam)[0];
  const isAnswerableTaskType = activeTaskTypeId === taskTypes.choice;

  app.innerHTML = `
    <header class="solver-header" style="--subject-color: ${physicsSubjectColor}">
      <div class="solver-header__toolbar">
        <a class="solver-header__back" href="${physicsSubjectUrl()}">← Odaberi drugi ispit</a>
        <nav class="solver-header__downloads" aria-label="Materijali ispita">
          <a href="${escapeHtml(exam.paperUrl)}" target="_blank" rel="noreferrer">
            Otvori službeni PDF
          </a>
          <a href="${escapeHtml(exam.archiveUrl)}" target="_blank" rel="noreferrer">
            Preuzmi ZIP
          </a>
        </nav>
      </div>

      <div class="solver-header__main">
        <div class="solver-header__identity">
          <span class="subject-symbol solver-header__subject-symbol">
            ${icon("atom", "subject-symbol__icon")}
          </span>
          <div>
            <p class="eyebrow">Fizika</p>
            <h2>${exam.year}. · ${escapeHtml(formatTerm(exam.term))}</h2>
            <p>
              Vrijeme u izvornoj knjižici: ${exam.durationMinutes} min ·
              školska godina ${escapeHtml(exam.schoolYear)}
            </p>
          </div>
        </div>
        <div class="solver-summary">
          ${simulation.renderTimer()}
          <strong id="answer-progress"></strong>
          <span id="score-summary"></span>
        </div>
      </div>

      <p class="solver-header__footer">
        Pitanja su prikazana izravno iz službene PDF knjižice. Cijelu izvornu
        knjižicu možeš otvoriti poveznicom iznad.
      </p>
    </header>

    ${simulation.renderNotice()}

    <div id="section-content"></div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav class="task-navigation" id="task-type-navigation" aria-label="Vrste zadataka u ispitu"></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <strong id="footer-answer-progress"></strong>
            <span id="footer-score-summary"></span>
          </div>
          ${
            isAnswerableTaskType
              ? `<div class="solver-sticky-footer__actions">
                  <button class="secondary-button" id="clear-answers" type="button">
                    Obriši odgovore
                  </button>
                  <button class="primary-button" id="check-answers" type="button">
                    ${simulation.active ? "Predaj simulaciju" : "Provjeri odgovore"}
                  </button>
                </div>`
              : ""
          }
        </div>
      </div>
    </footer>
  `;

  document.querySelector("#clear-answers")?.addEventListener("click", clearAnswers);
  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);

  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
  simulation.start(exam.durationMinutes);
}

function renderTaskTypeNavigation() {
  const choiceAnswered = choiceAnsweredCount();
  const choiceTotal = choiceQuestions().length;
  const choiceScore = checked ? ` · ${scoreForQuestions(choiceQuestions())}/${choiceTotal} točno` : "";
  const openTotal = openQuestions().length;
  const openNavigation = openTotal
    ? `<a
        class="task-button${activeTaskTypeId === taskTypes.open ? " task-button--active" : ""}"
        href="${examUrl(solverExam, taskTypes.open)}"
        ${activeTaskTypeId === taskTypes.open ? 'aria-current="true"' : ""}
      >
        <strong>Otvoreni zadatci</strong>
        <small>${openTotal} zadataka · službena rješenja</small>
      </a>`
    : "";

  document.querySelector("#task-type-navigation").innerHTML = `
    <a
      class="task-button${activeTaskTypeId === taskTypes.choice ? " task-button--active" : ""}"
      href="${examUrl(solverExam)}"
      ${activeTaskTypeId === taskTypes.choice ? 'aria-current="true"' : ""}
    >
      <strong>Zadatci višestrukoga izbora</strong>
      <small>${choiceAnswered}/${choiceTotal} odgovora${choiceScore}</small>
    </a>
    ${openNavigation}
  `;
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
  if (activeTaskTypeId === taskTypes.open) {
    const summary = `${openQuestions().length} zadataka · bez bodovanja`;
    document.querySelector("#answer-progress").textContent = summary;
    document.querySelector("#footer-answer-progress").textContent = summary;
    document.querySelector("#score-summary").textContent = "";
    document.querySelector("#footer-score-summary").textContent = "";
    return;
  }

  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const clearButton = document.querySelector("#clear-answers");
  const checkButton = document.querySelector("#check-answers");
  if (clearButton) clearButton.disabled = complete === 0 || simulation.finished;
  if (checkButton) checkButton.disabled = complete === 0 || simulation.finished;

  const scoreSummary = document.querySelector("#score-summary");
  const footerScoreSummary = document.querySelector("#footer-score-summary");
  const score = checked ? `${totalScore()}/${total} točno` : "";
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
    ? "Bez bodovanja u aplikaciji. Bodovi su preuzeti iz ispitne knjižice."
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
}

function renderQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  quickSelect.innerHTML = questionsForTaskType(activeTaskTypeId)
    .map((question) => {
      const answer = responses[question];
      const isChoiceTaskType = activeTaskTypeId === taskTypes.choice;
      const stateClass = isChoiceTaskType && answer ? " question-quickselect__link--answered" : "";
      const resultClass = checked && isChoiceTaskType
        ? isCorrectAnswer(question, answer)
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const answerState = isChoiceTaskType
        ? answer
          ? "odgovoreno"
          : "nije odgovoreno"
        : "otvoreni zadatak";
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

  return `
    <details class="physics-open-solution">
      <summary>Otvori rješenje</summary>
      <div class="physics-open-solution__body">
        ${solutionImage}
      </div>
    </details>
  `;
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

function clearAnswers() {
  if (simulation.finished) return;
  const prompt = simulation.active
    ? "Obrisati odgovore iz ove simulacije?"
    : "Obrisati spremljene odgovore za ovaj ispit?";
  if (!window.confirm(prompt)) return;
  responses = {};
  checked = false;
  if (!simulation.active) {
    try {
      for (const key of choiceStorageKeys(solverExam)) {
        localStorage.removeItem(key);
      }
    } catch {
      // The in-memory reset still works if storage is unavailable.
    }
  }
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();
}

function finishSimulation(reason) {
  checked = true;
  renderTaskTypeNavigation();
  renderSolverSummary();
  renderTaskTypeContent();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
}

function totalScore() {
  return scoreForQuestions(allQuestions(solverExam));
}

function scoreForQuestions(questions) {
  return questions.filter((question) => isCorrectAnswer(question, responses[question])).length;
}

const id = selectedExamId();
if (!id) {
  window.location.replace(physicsSubjectUrl());
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam, selectedTaskTypeId());
  else renderMissingExam();
}
