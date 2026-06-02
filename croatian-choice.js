const data = window.ASISTENT_ZA_MATURE_CROATIAN_CHOICE;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks interaktivnih zadataka iz Hrvatskoga jezika.");
}

const app = document.querySelector("#croatian-app");

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

const croatianSubjectColor = "#7a3f4a";

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
  return `hrvatski${level}-${exam.year}-${slugPart(term)}`;
}

function choiceStorageKeyForId(id) {
  return `asistent-za-mature:croatian-choice:${id}`;
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
  return `./hrvatski.html?${params.toString()}`;
}

function croatianSubjectUrl() {
  return "./?predmet=Hrvatski%20jezik";
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
  document.body.classList.remove("solver-page", "croatian-solver-page");
  app.classList.remove("croatian-solver-active");
  app.innerHTML = `
    <div class="empty-state">
      <h2>Ispit nije pronađen</h2>
      <p>Odabrani ispit iz Hrvatskoga jezika nije dostupan.</p>
      <a class="start-link" href="${croatianSubjectUrl()}">Vrati se na Hrvatski jezik</a>
    </div>
  `;
}

function levelText(exam) {
  return exam.level ? `${exam.level} razina` : "Bez razine";
}

function renderSolver(exam) {
  document.body.classList.add("solver-page", "croatian-solver-page");
  app.classList.add("croatian-solver-active");
  solverExam = exam;
  responses = simulation.active ? {} : loadResponses(exam);
  activeQuestionNumber = questionIds(exam)[0];
  checked = false;

  app.innerHTML = `
    <header class="solver-header" style="--subject-color: ${croatianSubjectColor}">
      <div class="solver-header__toolbar">
        <a class="solver-header__back" href="${croatianSubjectUrl()}">← Odaberi drugi ispit</a>
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
            ${icon("book-open-text", "subject-symbol__icon")}
          </span>
          <div>
            <p class="eyebrow">Hrvatski jezik</p>
            <h2>${exam.year}. · ${escapeHtml(formatTerm(exam.term))} · ${escapeHtml(levelText(exam))}</h2>
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
        Knjižica se prikazuje iz službenog PDF-a. Odgovore označi u digitalnom
        ABCD listu za odgovore.
      </p>
    </header>

    ${simulation.renderNotice()}

    <div class="solver-question-layout solver-question-layout--workspace">
      <div class="solver-workspace croatian-practice-layout">
        <section class="task-content-panel croatian-document-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">Ispitna knjižica</p>
              <h3>Čitanje, književnost i hrvatski jezik</h3>
            </div>
            <small>${questionIds(exam).length} pitanja</small>
          </div>
          <div class="croatian-pdf-frame">
            <iframe
              src="${escapeHtml(exam.paperUrl)}"
              title="Službena PDF knjižica iz Hrvatskoga jezika"
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
        <nav class="task-navigation" id="task-navigation" aria-label="Zadatci Hrvatskoga jezika"></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <strong id="footer-answer-progress"></strong>
            <span id="footer-score-summary"></span>
          </div>
          <div class="solver-sticky-footer__actions">
            <button class="secondary-button" id="clear-answers" type="button">
              Obriši odgovore
            </button>
            <button class="primary-button" id="check-answers" type="button">
              ${simulation.active ? "Predaj simulaciju" : "Provjeri odgovore"}
            </button>
          </div>
        </div>
      </div>
    </footer>
  `;

  document.querySelector("#clear-answers").addEventListener("click", clearAnswers);
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
  document.querySelector("#clear-answers").disabled = complete === 0 || simulation.finished;
  document.querySelector("#check-answers").disabled = complete === 0 || simulation.finished;

  const scoreSummary = document.querySelector("#score-summary");
  const score = checked ? `${totalScore()}/${total} točno` : "";
  scoreSummary.textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskNavigation() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  const score = checked ? ` · ${totalScore()}/${total} točno` : "";
  document.querySelector("#task-navigation").innerHTML = `
    <span class="task-button task-button--active" aria-current="true">
      <strong>ABCD zadatci</strong>
      <small>${complete}/${total} odgovora${score}</small>
    </span>
  `;
}

function renderQuestionQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = questionIds();
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 1;

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
      Odaberi jedan odgovor za svako pitanje. Polazni tekstovi ostaju u PDF knjižici.
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
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();
}

function checkAnswers() {
  if (simulation.active && !simulation.finished) {
    if (!window.confirm("Predati simulaciju i završiti rješavanje?")) return;
    simulation.finish("submitted");
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
  window.location.replace(croatianSubjectUrl());
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
