const data = window.ASISTENT_ZA_MATURE_ABCD_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks ABCD zadataka.");
}

const app = document.querySelector("#abcd-app");

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

const subjectColors = {
  Biologija: "#2f5d50",
  Etika: "#5b4b63",
  Filozofija: "#574d3f",
  Geografija: "#3f5f3b",
  "Grčki jezik": "#4d5370",
  Informatika: "#2e5c72",
  Kemija: "#315f69",
  "Latinski jezik": "#5b5140",
  "Likovna umjetnost": "#6a4f3d",
  Matematika: "#4f4b78",
  "Mađarski jezik": "#4e5d47",
  "Mađarski jezik i književnost": "#465a4f",
  "Politika i gospodarstvo": "#5c4a42",
  Povijest: "#6a4b3d",
  Psihologija: "#5a4968",
  Sociologija: "#4e5960",
  "Srpski jezik": "#574a70",
  "Talijanski jezik i književnost": "#4b5a5f",
  Vjeronauk: "#4f5943",
};

const subjectIcons = {
  Biologija: "dna",
  Etika: "scale",
  Filozofija: "lightbulb",
  Geografija: "earth",
  "Grčki jezik": "omega",
  Informatika: "binary",
  Kemija: "flask-conical",
  "Latinski jezik": "amphora",
  "Likovna umjetnost": "palette",
  Matematika: "sigma",
  "Mađarski jezik": "languages",
  "Mađarski jezik i književnost": "library",
  "Politika i gospodarstvo": "landmark",
  Povijest: "history",
  Psihologija: "brain",
  Sociologija: "users-round",
  "Srpski jezik": "languages",
  "Talijanski jezik i književnost": "library",
  Vjeronauk: "church",
};

let solverExam;
let responses = {};
let activeQuestionNumber;
let checked = false;
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
  const level = exam.level ? `-${exam.level.toLocaleLowerCase("hr")}` : "";
  return `${slugPart(exam.subject)}${level}-${exam.year}-${slugPart(term)}`;
}

function choiceStorageKeyForId(id) {
  return `asistent-za-mature:abcd-choice:${id}`;
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

function questionIds(exam = solverExam) {
  return exam?.questions || [];
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function examUrl(exam, simulationMode = false) {
  const params = new URLSearchParams({ exam: exam.id });
  if (simulationMode) params.set("nacin", "simulacija");
  return `./abcd.html?${params.toString()}`;
}

function subjectUrl(exam = solverExam) {
  return `./?predmet=${encodeURIComponent(exam?.subject || "")}`;
}

function levelText(exam) {
  return exam.level ? `${exam.level} razina` : "Bez razine";
}

function allQuestions(exam) {
  return questionIds(exam);
}

function correctAnswers(question) {
  const answer = solverExam.answers[question];
  return Array.isArray(answer) ? answer : [answer].filter(Boolean);
}

function isCorrectAnswer(question, answer) {
  return correctAnswers(question).includes(answer);
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    const knownQuestions = new Set(allQuestions(exam));
    for (const key of choiceStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) =>
          knownQuestions.has(question) && typeof answer === "string" && /^[A-D]$/.test(answer),
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

function renderMissingExam() {
  document.body.classList.remove("solver-page", "abcd-solver-page");
  app.classList.remove("abcd-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ABCD zadatci nisu dostupni.</p>
      <a class="start-link" href="./">Vrati se na predmete</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.title = `Asistent za Mature - ${exam.subject}`;
  document.body.classList.add("solver-page", "abcd-solver-page");
  app.classList.add("abcd-solver-active");
  solverExam = exam;
  responses = simulation.active ? {} : loadResponses(exam);
  activeQuestionNumber = questionIds(exam)[0];
  checked = false;

  const subjectColor = subjectColors[exam.subject] || "#001d4d";
  const subjectIcon = subjectIcons[exam.subject] || "book-open";
  app.innerHTML = `
    ${renderSolverHeader({
      subjectColor,
      backHref: subjectUrl(exam),
      backLabel: "← Odaberi drugi ispit",
      paperUrl: exam.paperUrl,
      archiveUrl: exam.archiveUrl,
      eyebrow: exam.subject,
      title: `${exam.year}. · ${formatTerm(exam.term)} · ${levelText(exam)}`,
      iconName: subjectIcon,
      summaryHtml: `
        ${simulation.renderTimer()}
        <strong id="answer-progress"></strong>
        <span id="score-summary"></span>
      `,
    })}

    ${simulation.renderNotice()}

    <div class="solver-question-layout solver-question-layout--workspace">
      <div class="solver-workspace croatian-practice-layout">
        <section class="task-content-panel croatian-document-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Ispitna knjižica</p>
              <h3>ABCD zadatci</h3>
            </div>
            <small>${questionIds(exam).length} pitanja</small>
          </div>
          <div class="croatian-pdf-frame">
            <iframe
              src="${escapeHtml(exam.paperUrl)}"
              title="Službena PDF knjižica"
              loading="lazy"
            ></iframe>
          </div>
        </section>

        <section class="answer-panel croatian-answer-panel" id="answer-panel" aria-live="polite"></section>
      </div>

      <aside class="question-quickselect" aria-label="Brzi odabir pitanja">
        <div class="question-quickselect__heading">
          <strong>Brzi odabir</strong>
          <small>Pitanja</small>
        </div>
        <nav class="question-quickselect__list" id="question-quickselect"></nav>
      </aside>
    </div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav class="task-navigation" id="task-navigation" aria-label="ABCD zadatci"></nav>
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
  `;

  document.querySelector("#check-answers").addEventListener("click", checkAnswers);

  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();
  simulation.start(exam.durationMinutes);
}

function renderSolverSummary() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  const checkButton = document.querySelector("#check-answers");
  checkButton.disabled =
    (simulation.finished && solverExam?.checkingSupported === false) ||
    (complete === 0 && !checked && !simulation.finished);
  checkButton.className = checkButtonClass();
  checkButton.innerHTML = renderCheckButtonContent();

  const score = checked ? `${totalScore()}/${total} točno` : "";
  document.querySelector("#score-summary").textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskNavigation() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#task-navigation").innerHTML = `
    <span class="task-button task-button--active" aria-current="true">
      <strong>ABCD zadatci</strong>
      <small>${complete}/${total}</small>
    </span>
  `;
}

function renderQuestionQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = questionIds();
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 2;

  quickSelect.innerHTML = questions
    .map((question) => {
      const answer = responses[question];
      const stateClass = answer ? " question-quickselect__link--answered" : "";
      const resultClass = checked
        ? isCorrectAnswer(question, answer)
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const activeClass =
        String(question) === String(activeQuestionNumber) ? " question-quickselect__link--active" : "";
      const answerState = answer ? "odgovoreno" : "nije odgovoreno";

      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}${activeClass}"
          href="#odgovor-${escapeHtml(question)}"
          data-quick-question="${escapeHtml(question)}"
          aria-label="Pitanje ${escapeHtml(question)}, ${answerState}"
          ${activeClass ? 'aria-current="true"' : ""}
        >
          ${escapeHtml(question)}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectQuestion(link.dataset.quickQuestion);
    });
  });
}

function renderAnswerPanel() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Digitalni list za odgovore</p>
        <h3>ABCD zadatci</h3>
      </div>
      <small>${complete}/${total}</small>
    </div>
    <p class="answer-panel__hint">
      Odaberi jedan odgovor za svako pitanje. Polazni tekstovi i grafički prilozi ostaju u PDF knjižici.
    </p>

    <div class="response-list croatian-response-list">
      ${questionIds().map((question) => renderQuestion(question)).join("")}
    </div>
  `;

  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });
}

function renderQuestion(question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? isCorrectAnswer(question, answer)
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="response-question ${resultClass}" id="odgovor-${escapeHtml(question)}">
      <legend>${escapeHtml(question)}.</legend>
      <div class="choice-list">
        ${["A", "B", "C", "D"]
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

function renderFeedback(question, answer) {
  if (!checked) return "";
  const answers = correctAnswers(question);
  if (answers.includes(answer)) return `<small class="response-feedback">Točno.</small>`;
  const label = answers.length > 1 ? "Točni odgovori" : "Točan odgovor";
  return `<small class="response-feedback">${label}: ${answers.join(" ili ")}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  checked = false;
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  activeQuestionNumber = question;
  saveResponses();
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();
}

function selectQuestion(question) {
  activeQuestionNumber = question;
  renderQuestionQuickSelect();
  document.getElementById(`odgovor-${question}`)?.scrollIntoView({
    behavior: "smooth",
    block: "center",
  });
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
    return;
  }

  if (checked) {
    checked = false;
    renderTaskNavigation();
    renderQuestionQuickSelect();
    renderSolverSummary();
    renderAnswerPanel();
    return;
  }

  checked = true;
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();
}

function finishSimulation(reason) {
  checked = true;
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();

  if (reason === "submitted") recordSubmittedSimulation();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
}

function recordSubmittedSimulation() {
  if (!window.AsistentProfile) return;

  const total = allQuestions(solverExam).length;

  window.AsistentProfile.recordSimulationAttempt({
    solver: "abcd-choice",
    subject: solverExam.subject,
    part: "ABCD zadatci",
    examId: solverExam.id,
    year: solverExam.year,
    term: solverExam.term,
    level: solverExam.level,
    schoolYear: solverExam.schoolYear,
    durationMinutes: solverExam.durationMinutes,
    answered: answeredCount(solverExam),
    totalQuestions: total,
    score: totalScore(),
    maxScore: total,
    checkingSupported: solverExam.checkingSupported !== false,
  });
}

function totalScore() {
  return allQuestions(solverExam).filter((question) =>
    isCorrectAnswer(question, responses[question]),
  ).length;
}

const id = selectedExamId();
if (!id) {
  window.location.replace("./");
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
