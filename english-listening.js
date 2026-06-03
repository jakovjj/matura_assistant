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

let solverExam;
let responses = {};
let activeTaskNumber;
let activeQuestionNumber;
let activeAudioIndex = 0;
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
    <svg class="solver-sticky-footer__action-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      <use href="./assets/lucide-icons.svg#${checkButtonIcon()}"></use>
    </svg>
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
  return (
    renderTaskSourceImages(task) ||
    `<div class="task-source">${renderTaskSource(task.text)}</div>`
  );
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

function selectedExamId() {
  return new URLSearchParams(window.location.search).get("exam");
}

function examUrl(exam) {
  return `./engleski-slusanje.html?exam=${encodeURIComponent(exam.id)}`;
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

  return (plan.tasks?.[String(taskNumber)] || [])
    .map((entry) => audioEntry(entry.audioIndex, entry.label, entry.kind))
    .filter(Boolean);
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

function firstTaskAudioIndex(taskNumber) {
  return taskAudioEntries(taskNumber)[0]?.audioIndex;
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
          Za razdoblje od 2016. do 2018. godine audiosnimke nisu objavljene
          unutar arhivskih ZIP paketa.
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
  activeTaskNumber = exam.tasks[0].number;
  activeQuestionNumber = exam.tasks[0].firstQuestion;
  activeAudioIndex = 0;

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

    <div class="solver-question-layout solver-question-layout--workspace solver-question-layout--single">
      <div class="solver-workspace">
        <section class="task-content-panel" id="task-content-panel"></section>

        <section class="answer-panel" id="answer-panel" aria-live="polite"></section>
      </div>
    </div>

    <footer class="solver-sticky-footer">
      <div class="solver-sticky-footer__inner">
        <nav class="task-navigation" id="task-navigation" aria-label="Zadatci slušanja"></nav>
        <div class="solver-sticky-footer__controls">
          <div class="solver-sticky-footer__status">
            <svg class="solver-sticky-footer__status-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
              <use href="./assets/lucide-icons.svg#list-checks"></use>
            </svg>
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
  `;

  document.querySelector("#check-answers")?.addEventListener("click", checkAnswers);

  renderTaskNavigation();
  renderSolverSummary();
  renderTaskContent();
  renderAnswerPanel();
  simulation.start(exam.durationMinutes);
}

function audioEntriesForTask(task) {
  const plan = certifiedAudioPlan();

  if (simulation.active) {
    const fullAudioIndex = plan?.fullAudioIndex;
    if (Number.isInteger(fullAudioIndex) && solverExam.audio[fullAudioIndex]) {
      return [audioEntry(fullAudioIndex, "Cijela snimka", "full")].filter(Boolean);
    }

    return allAudioEntries();
  }

  const taskEntries = taskAudioEntries(task.number);
  if (taskEntries.length) return taskEntries;
  return allAudioEntries();
}

function renderTaskAudioBlock(task) {
  const entries = audioEntriesForTask(task);
  if (!entries.length) return "";

  if (!entries.some((entry) => entry.audioIndex === activeAudioIndex)) {
    activeAudioIndex = entries[0].audioIndex;
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
      <audio controls preload="metadata" src="${escapeHtml(track.url)}">
        Vaš preglednik ne podržava reprodukciju audiosnimke.
      </audio>
      ${
        entries.length > 1
          ? `<div class="audio-track-list audio-track-list--compact" aria-label="Odabir audiosnimke za zadatak">
              ${entries.map(renderAudioTrackButton).join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

function bindTaskAudioControls() {
  document.querySelectorAll("[data-audio-index]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAudioIndex = Number(button.dataset.audioIndex);
      renderTaskContent();
    });
  });
}

function renderAudioTrackButton(entry) {
  const active = entry.audioIndex === activeAudioIndex;
  return `
    <button
      class="audio-track-button${active ? " audio-track-button--active" : ""}"
      data-audio-index="${entry.audioIndex}"
      type="button"
      ${active ? 'aria-current="true"' : ""}
    >
      ${escapeHtml(entry.label)}
    </button>
  `;
}

function renderTaskNavigation() {
  document.querySelector("#task-navigation").innerHTML = solverExam.tasks
    .map((task) => {
      const total = task.lastQuestion - task.firstQuestion + 1;
      const activeClass = task.number === activeTaskNumber ? " task-button--active" : "";
      return `
        <button class="task-button${activeClass}" data-task="${task.number}" type="button">
          <strong>Zadatak ${task.number}</strong>
          <small>${taskAnsweredCount(task)}/${total}</small>
        </button>
      `;
    })
    .join("");

  document.querySelectorAll(".task-button").forEach((button) => {
    button.addEventListener("click", () => selectTask(Number(button.dataset.task)));
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

  const score = checked ? `${totalScore()}/${total} točno` : "";
  document.querySelector("#score-summary").textContent = score;
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
    ${renderTaskAudioBlock(task)}
    ${renderTaskSourceContent(task)}
  `;
  bindTaskAudioControls();
}

function renderAnswerPanel() {
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);

  document.querySelector("#answer-panel").innerHTML = `
    <div class="panel-heading">
      <div>
        <p class="eyebrow">Digitalni list za odgovore</p>
        <h3>Zadatak ${task.number}</h3>
      </div>
      <small>Pitanja ${task.firstQuestion}–${task.lastQuestion}</small>
    </div>
    <div class="response-list">
      ${taskQuestions(task).map((question) => renderQuestion(task, question)).join("")}
    </div>
  `;

  document.querySelectorAll('input[type="radio"][data-question]').forEach((input) => {
    input.addEventListener("change", () => updateResponse(input.dataset.question, input.value));
  });

}

function renderQuestion(task, question) {
  const answer = responses[question] || "";
  const resultClass = checked
    ? answer === solverExam.answers[question]
      ? " response-question--correct"
      : " response-question--wrong"
    : "";

  return `
    <fieldset class="response-question ${resultClass}" id="odgovor-${question}">
      <legend>${question}.</legend>
      <div class="choice-list">
        ${task.options.map((option) => renderChoice(question, option, answer)).join("")}
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
  renderSolverSummary();
  if (wasChecked) renderAnswerPanel();
}

function selectTask(taskNumber) {
  activeTaskNumber = taskNumber;
  const task = solverExam.tasks.find((candidate) => candidate.number === activeTaskNumber);
  activeQuestionNumber = task?.firstQuestion || activeQuestionNumber;
  if (!simulation.active) {
    activeAudioIndex = firstTaskAudioIndex(taskNumber) ?? activeAudioIndex;
  }
  renderTaskNavigation();
  renderTaskContent();
  renderAnswerPanel();
  document.querySelector("#task-content-panel").scrollIntoView({ behavior: "smooth", block: "start" });
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
    renderSolverSummary();
    renderAnswerPanel();
    return;
  }

  checked = true;
  renderTaskNavigation();
  renderSolverSummary();
  renderAnswerPanel();
}

function finishSimulation(reason) {
  checked = solverExam.checkingSupported;
  renderTaskNavigation();
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

const id = selectedExamId();
if (!id) {
  window.location.replace(englishSubjectUrl);
} else {
  const exam = examsById.get(id);
  if (exam) renderSolver(exam);
  else renderMissingExam();
}
