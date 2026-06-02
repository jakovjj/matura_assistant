const data = window.ASISTENT_ZA_MATURE_ENGLISH_READING;

if (!data || !Array.isArray(data.exams)) {
  throw new Error("Nedostaje generirani indeks čitanja iz engleskoga jezika.");
}

const app = document.querySelector("#reading-app");

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

let solverExam;
let responses = {};
let activeTaskNumber;
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

function readingExamIdForTerm(exam, term) {
  return `engleski-${exam.level.toLocaleLowerCase("hr")}-${exam.year}-${slugPart(term)}`;
}

function readingStorageKeyForId(id) {
  return `asistent-za-mature:english-reading:${id}`;
}

function readingStorageKeys(exam) {
  const ids = [
    exam.id,
    ...(legacyTermAliases[exam.term] || []).map((term) => readingExamIdForTerm(exam, term)),
  ];

  return [...new Set(ids)].map(readingStorageKeyForId);
}

function buildExamMap(items) {
  const map = new Map();
  for (const exam of items) {
    map.set(exam.id, exam);
    for (const legacyTerm of legacyTermAliases[exam.term] || []) {
      map.set(readingExamIdForTerm(exam, legacyTerm), exam);
    }
  }
  return map;
}

const exams = data.exams.map((exam) => {
  const term = normalizeTerm(exam.term);
  return {
    ...exam,
    term,
    id: readingExamIdForTerm(exam, term),
  };
});
const examsById = buildExamMap(exams);

function highlightInline(value) {
  return escapeHtml(value)
    .replace(/\((\d+)\)\s*_{2,}/g, '<mark class="source-gap">($1) ____</mark>')
    .replace(/\b0→([A-Z])\b/g, '<mark class="source-example">0→$1</mark>');
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
  const optionItems = parseLeadingItems(block, /^([A-Z])\s+(.*)$/);
  const questionItems = parseLeadingItems(block, /^(\d{1,2})\s+(.*)$/);

  if (optionItems.length >= 2) {
    return renderSourceList(optionItems, "source-options");
  }

  if (questionItems.length >= 1) {
    return renderSourceList(questionItems, "source-questions");
  }

  if (/^(?:Which person|Which|What|Who|Where|Why|How)\b/i.test(text)) {
    return `<h5 class="source-subheading">${highlightInline(text)}</h5>`;
  }

  if (
    index < 2 ||
    /(?:For each question|Mark your answer|There is an example|Read the text|Read about|Complete the text|choose|Match each|Write your answer)/i.test(
      text,
    )
  ) {
    return `<div class="source-instructions">${highlightInline(text)}</div>`;
  }

  if (
    text.length <= 90 &&
    !/[.!?]$/.test(text) &&
    !/^(?:A|B|C|D|E|F|G|H|I|J|K|L|M|N)\b/.test(text)
  ) {
    return `<h4 class="source-title">${highlightInline(text)}</h4>`;
  }

  if (/^[A-Z]\s+[\p{Lu}0-9]/u.test(text) && text.length <= 80) {
    const [label, ...rest] = text.split(/\s+/);
    return `
      <h5 class="source-section-label">
        <span>${escapeHtml(label)}</span>
        ${highlightInline(rest.join(" "))}
      </h5>
    `;
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

function allQuestions(exam) {
  return exam.tasks.flatMap((task) => {
    const questions = [];
    for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
      questions.push(question);
    }
    return questions;
  });
}

function loadResponses(exam) {
  const storedResponses = {};
  try {
    const knownQuestions = new Set(allQuestions(exam).map(String));
    for (const key of readingStorageKeys(exam).reverse()) {
      const stored = JSON.parse(localStorage.getItem(key) || "{}");
      if (stored && typeof stored === "object" && !Array.isArray(stored)) {
        Object.assign(storedResponses, stored);
      }
    }
    return Object.fromEntries(
      Object.entries(storedResponses).filter(
        ([question, answer]) => knownQuestions.has(question) && typeof answer === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveResponses() {
  if (simulation.active) return;

  try {
    localStorage.setItem(readingStorageKeyForId(solverExam.id), JSON.stringify(responses));
  } catch {
    // Solving still works if storage is unavailable.
  }
}

function answeredCount(exam, storedResponses = responses) {
  return allQuestions(exam).filter((question) => storedResponses[question]?.trim()).length;
}

function taskQuestions(task) {
  const questions = [];
  for (let question = task.firstQuestion; question <= task.lastQuestion; question += 1) {
    questions.push(question);
  }
  return questions;
}

function taskAnsweredCount(task) {
  return taskQuestions(task).filter((question) => responses[question]?.trim()).length;
}

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function examUrl(exam) {
  return `./engleski-citanje.html?exam=${encodeURIComponent(exam.id)}`;
}

function renderPicker() {
  document.body.classList.remove("solver-page");
  const years = [...new Set(exams.map((exam) => exam.year))].sort((a, b) => b - a);

  app.innerHTML = `
    <div class="practice-overview">
      <div class="practice-overview__heading">
        <div>
          <p class="eyebrow">Čitanje</p>
          <h2>Odaberi ispit</h2>
        </div>
        <p>
          Dostupne su obje razine i oba godišnja roka od 2013. do 2025. godine.
          Pitanja su izdvojena iz izvornih knjižica i prikazana uz digitalni
          list za odgovore.
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

  return `
    <tr>
      <td><strong>${exam.year}.</strong></td>
      <td>${escapeHtml(formatTerm(exam.term))}</td>
      <td><span class="level-badge">${escapeHtml(exam.level)}</span></td>
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
      <p>Odabrani ispit čitanja nije dostupan.</p>
      <a class="start-link" href="./engleski-citanje.html">Vrati se na popis</a>
    </div>
  `;
}

function renderSolver(exam) {
  document.body.classList.add("solver-page");
  solverExam = exam;
  responses = simulation.active ? {} : loadResponses(exam);
  activeTaskNumber = exam.tasks[0].number;
  activeQuestionNumber = exam.tasks[0].firstQuestion;

  app.innerHTML = `
    <header class="solver-header">
      <div class="solver-header__toolbar">
        <a class="solver-header__back" href="./engleski-citanje.html">← Odaberi drugi ispit</a>
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
        <div>
          <p class="eyebrow">Engleski - čitanje</p>
          <h2>${exam.year}. · ${escapeHtml(formatTerm(exam.term))} · ${escapeHtml(exam.level)} razina</h2>
          <p>
            Vrijeme u izvornoj knjižici: ${exam.durationMinutes} min${
              exam.level === "B" ? " za čitanje i pisanje" : ""
            } ·
            školska godina ${escapeHtml(exam.schoolYear)}
          </p>
        </div>
        <div class="solver-summary">
          ${simulation.renderTimer()}
          <strong id="answer-progress"></strong>
          <span id="score-summary"></span>
        </div>
      </div>

      <p class="solver-header__footer">
        Pitanja su izdvojena iz službene PDF knjižice. Cijelu izvornu knjižicu
        možeš otvoriti poveznicom iznad.
      </p>
    </header>

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

    <div class="solver-question-layout solver-question-layout--workspace">
      <div class="solver-workspace">
        <section class="task-content-panel" id="task-content-panel"></section>

        <section class="answer-panel" id="answer-panel" aria-live="polite"></section>
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
        <nav class="task-navigation" id="task-navigation" aria-label="Zadatci čitanja"></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <strong id="footer-answer-progress"></strong>
            <span id="footer-score-summary"></span>
          </div>
          <div class="solver-sticky-footer__actions">
            <button class="secondary-button" id="clear-answers" type="button">
              Obriši odgovore
            </button>
            ${
              exam.checkingSupported || simulation.active
                ? `<button class="primary-button" id="check-answers" type="button">
                    ${simulation.active ? "Predaj simulaciju" : "Provjeri odgovore"}
                  </button>`
                : ""
            }
          </div>
        </div>
      </div>
    </footer>
  `;

  document.querySelector("#clear-answers").addEventListener("click", clearAnswers);
  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);

  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskContent();
  renderAnswerPanel();
  simulation.start(exam.durationMinutes);
}

function renderTaskNavigation() {
  document.querySelector("#task-navigation").innerHTML = solverExam.tasks
    .map((task) => {
      const total = task.lastQuestion - task.firstQuestion + 1;
      const activeClass = task.number === activeTaskNumber ? " task-button--active" : "";
      const score = checked ? ` · ${taskScore(task)}/${total} točno` : "";

      return `
        <button class="task-button${activeClass}" data-task="${task.number}" type="button">
          <strong>Zadatak ${task.number}</strong>
          <small>${taskAnsweredCount(task)}/${total} odgovora${score}</small>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".task-button").forEach((button) => {
    button.addEventListener("click", () => selectTask(Number(button.dataset.task)));
  });
}

function renderQuestionQuickSelect() {
  const quickSelect = document.querySelector("#question-quickselect");
  if (!quickSelect) return;

  const questions = allQuestions(solverExam);
  const quickSelectPanel = quickSelect.closest(".question-quickselect");
  if (quickSelectPanel) quickSelectPanel.hidden = questions.length <= 1;

  quickSelect.innerHTML = questions
    .map((question) => {
      const answer = responses[question];
      const stateClass = answer ? " question-quickselect__link--answered" : "";
      const resultClass = checked
        ? answer === solverExam.answers[question]
          ? " question-quickselect__link--correct"
          : " question-quickselect__link--wrong"
        : "";
      const activeClass =
        Number(question) === Number(activeQuestionNumber) ? " question-quickselect__link--active" : "";
      const answerState = answer ? "odgovoreno" : "nije odgovoreno";

      return `
        <a
          class="question-quickselect__link${stateClass}${resultClass}${activeClass}"
          href="#odgovor-${question}"
          data-quick-question="${question}"
          aria-label="Pitanje ${question}, ${answerState}"
          ${activeClass ? 'aria-current="true"' : ""}
        >
          ${question}
        </a>
      `;
    })
    .join("");

  quickSelect.querySelectorAll("[data-quick-question]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      selectQuestion(Number(link.dataset.quickQuestion));
    });
  });
}

function renderSolverSummary() {
  const complete = answeredCount(solverExam);
  const total = allQuestions(solverExam).length;
  document.querySelector("#answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#footer-answer-progress").textContent = `${complete}/${total} odgovora`;
  document.querySelector("#clear-answers").disabled = complete === 0 || simulation.finished;

  const checkButton = document.querySelector("#check-answers");
  if (checkButton) checkButton.disabled = complete === 0 || simulation.finished;

  const scoreSummary = document.querySelector("#score-summary");
  const score = checked ? `${totalScore()}/${total} točno` : "";
  scoreSummary.textContent = score;
  document.querySelector("#footer-score-summary").textContent = score;
}

function renderTaskContent() {
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  document.querySelector("#task-content-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Pitanja iz knjižice</p>
        <h3>Zadatak ${task.number}</h3>
      </div>
      <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
    </div>
    <div class="task-source">${renderTaskSource(task.text)}</div>
  `;
}

function renderAnswerPanel() {
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  const answerType =
    task.kind === "choice"
      ? "Odaberi jedan odgovor za svako pitanje."
      : "Upiši odgovor za svako pitanje.";

  document.querySelector("#answer-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Digitalni list za odgovore</p>
        <h3>Zadatak ${task.number}</h3>
      </div>
      <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
    </div>
    <p class="answer-panel__hint">${answerType}</p>

    <div class="response-list">
      ${taskQuestions(task).map((question) => renderQuestion(task, question)).join("")}
    </div>
  `;

  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });

  document.querySelectorAll('input[type="text"][data-question]').forEach((input) => {
    input.addEventListener("input", () => updateResponse(input.dataset.question, input.value));
  });

}

function renderQuestion(task, question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? answer === solverExam.answers[question]
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  if (task.kind === "text") {
    return `
      <label class="response-question response-question--text" id="odgovor-${question}">
        <strong>${question}.</strong>
        <input
          data-question="${question}"
          type="text"
          value="${escapeHtml(answer)}"
          autocomplete="off"
          aria-label="Odgovor na pitanje ${question}"
          ${simulation.inputDisabledAttribute()}
        >
      </label>
    `;
  }

  return `
    <fieldset class="response-question ${resultClass}" id="odgovor-${question}">
      <legend>${question}.</legend>
      <div class="choice-list">
        ${task.options
          .map((option) => renderChoice(question, option, answer))
          .join("")}
      </div>
      ${renderFeedback(question, answer)}
    </fieldset>
  `;
}

function renderChoice(question, option, answer) {
  const selected = option === answer;
  const correct = option === solverExam.answers[question];
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
  const correctAnswer = solverExam.answers[question];
  if (answer === correctAnswer) return `<small class="response-feedback">Točno.</small>`;
  return `<small class="response-feedback">Točan odgovor: ${correctAnswer}.</small>`;
}

function updateResponse(question, answer) {
  if (simulation.finished) return;

  const wasChecked = checked;
  checked = false;
  const normalizedAnswer = String(answer || "").trim();
  if (normalizedAnswer) responses[question] = normalizedAnswer;
  else delete responses[question];
  activeQuestionNumber = Number(question);
  saveResponses();
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  if (wasChecked) renderAnswerPanel();
}

function taskForQuestion(question) {
  return solverExam.tasks.find(
    (task) => question >= task.firstQuestion && question <= task.lastQuestion,
  );
}

function selectQuestion(question) {
  const task = taskForQuestion(question);
  if (!task) return;

  activeTaskNumber = task.number;
  activeQuestionNumber = question;
  renderTaskNavigation();
  renderTaskContent();
  renderAnswerPanel();
  renderQuestionQuickSelect();

  document
    .querySelector(`#odgovor-${question}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectTask(taskNumber) {
  activeTaskNumber = taskNumber;
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  activeQuestionNumber = task?.firstQuestion || activeQuestionNumber;
  renderTaskNavigation();
  renderTaskContent();
  renderAnswerPanel();
  renderQuestionQuickSelect();
  document.querySelector("#task-content-panel").scrollIntoView({ behavior: "smooth", block: "start" });
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
      for (const key of readingStorageKeys(solverExam)) {
        localStorage.removeItem(key);
      }
    } catch {
      // The in-memory reset still works if storage is unavailable.
    }
  }
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderTaskContent();
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
  checked = solverExam.checkingSupported;
  renderTaskNavigation();
  renderQuestionQuickSelect();
  renderSolverSummary();
  renderAnswerPanel();

  if (reason === "expired") {
    window.alert("Vrijeme za simulaciju je isteklo. Odgovori više nisu promjenjivi.");
  }
}

function taskScore(task) {
  return taskQuestions(task).filter(
    (question) => responses[question] === solverExam.answers[question],
  ).length;
}

function totalScore() {
  return solverExam.tasks.reduce((score, task) => score + taskScore(task), 0);
}

const id = selectedExamId();
if (!id) {
  renderPicker();
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
