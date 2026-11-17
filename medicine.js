(() => {
  "use strict";
  const home = "./?predmet=Prijemni%20za%20medicinu";
  const root = document.querySelector("#medicine-app");
  const data = window.MEDICINE_DATA;
  const core = window.MedicineCore;
  const paper = data?.sets.find((set) => set.id === new URLSearchParams(location.search).get("exam"));
  if (!paper) { location.replace(home); return; }
  if (paper.kind === "collection" && new URLSearchParams(location.search).get("nacin") === "simulacija") {
    const practiceUrl = new URL(location.href);
    practiceUrl.searchParams.delete("nacin");
    location.replace(practiceUrl.href);
    return;
  }
  const questionMap = new Map(data.questions.map((question) => [question.id, question]));
  const randomPaper = paper.kind === "random";
  const selfCheck = window.createTaskSelfCheck();
  const simulation = window.createExamSimulation({ onFinish: finish });
  const key = core.storageKey(paper.id);
  const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const number = (value) => value.toLocaleString("hr-HR");
  const icon = (name, className) => window.renderPhosphorIcon
    ? window.renderPhosphorIcon(name, className)
    : `<svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="./assets/phosphor-icons.svg#${name}"></use></svg>`;
  let saved = null;
  let storageFailed = false;
  if (!simulation.active) {
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); }
    catch { storageFailed = true; }
  }
  let selectedIds = randomPaper
    ? core.validSelection(saved?.questionIds, paper.questionIds, questionMap)
      ? saved.questionIds : core.selectRandomQuestions(paper.questionIds, questionMap)
    : paper.questionIds;
  let questions = selectedIds.map((id) => questionMap.get(id));
  let answers = !simulation.active && saved?.schemaVersion === 1 ? core.answersFor(questions, saved.answers) : {};
  let complete = !simulation.active && saved?.schemaVersion === 1 && saved.complete === true;
  if (!simulation.active && saved?.schemaVersion === 1 && Array.isArray(saved.checked)) {
    saved.checked.forEach((id) => { if (selectedIds.includes(id)) selfCheck.toggle(id); });
  }
  let activeSubject = questions[0].subject;
  let activeQuestionNumber = 1;
  let quickSelectFrame;
  const subjects = ["Biologija", "Fizika", "Kemija"].filter((subject) => questions.some((q) => q.subject === subject));
  const checkedSet = () => new Set(questions.filter((q) => selfCheck.has(q.id)).map((q) => q.id));
  const result = () => core.score(questions, answers, { checked: complete ? null : checkedSet(), threshold: paper.threshold });
  function save() {
    if (simulation.active) return;
    try {
      localStorage.setItem(key, JSON.stringify({ schemaVersion: 1, questionIds: selectedIds, answers, checked: [...checkedSet()], complete }));
      storageFailed = false;
    } catch { storageFailed = true; }
  }
  function mathText(value) {
    return escape(value).replace(/_\{([^{}]+)\}|_([A-Za-z]+)(?![A-Za-z_])/g, (_, group, letter) => `<sub>${group || letter}</sub>`);
  }
  function rich(blocks) {
    return `<div class="med-rich">${blocks.map((block) => {
      if (block.type === "text") return `<p>${mathText(block.text)}</p>`;
      if (block.type === "table") {
        const table = data.tables[block.id];
        return `<div class="med-table-wrap"><table><caption>${escape(table.caption)}</caption><thead><tr>${table.headers.map((h) => `<th scope="col">${mathText(h)}</th>`).join("")}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${mathText(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      }
      const figure = data.figures[block.id];
      return window.renderSourceImageCrop({ ...figure, crop: { x: 0, y: 0, width: figure.width, height: figure.height } }, figure.alt, { variant: "pdf", compact: true, cropClass: "med-figure" });
    }).join("")}</div>`;
  }
  const revealed = (q) => complete || selfCheck.has(q.id);
  // Same markup as the NCVVO solvers: numbered question, listed options, then
  // the A–E answer row with "Provjeri". Only the answer row is re-rendered
  // after an interaction, so nothing above the clicked control ever moves.
  function responseHtml(q, number) {
    const answer = answers[q.id] || "";
    const shown = revealed(q);
    const correct = answer === q.answer;
    return `<fieldset class="physics-inline-response${shown ? correct ? " response-question--correct" : " response-question--wrong" : ""}">
        <legend>Odgovor na ${number}. pitanje</legend>
        <div class="choice-list">${q.options.map((option) => `<label class="answer-choice${shown && option.id === q.answer ? " answer-choice--correct" : shown && option.id === answer ? " answer-choice--wrong" : ""}"><input type="radio" id="med-answer-${q.id}-${option.id}" name="medicine-answer-${q.id}" value="${option.id}" ${option.id === answer ? "checked" : ""}${simulation.inputDisabledAttribute()}><span>${option.id}</span></label>`).join("")}</div>
        <div class="solver-inline-actions">
          ${selfCheck.renderButton(q.id, { hidden: simulation.active || complete })}
          ${simulation.active || complete || q.reviewIssue ? "" : window.AsistentAI?.renderButton(q.id, { official: true }) || ""}
        </div>
        ${shown ? `<small class="response-feedback">${correct ? "Točno." : `Točan odgovor: ${q.answer}.`}${q.reviewIssue ? ` ${escape(q.reviewIssue)}` : ""}</small>` : ""}
      </fieldset>`;
  }
  function taskHtml(q, index) {
    const number = index + 1;
    return `<article class="physics-source-question med-question" id="pitanje-${number}" data-question-id="${q.id}" data-question-number="${number}">
      <h4>${number}.</h4>
      <div class="physics-source-question__body">
        ${rich(q.prompt)}
        ${q.reviewIssue ? '<p class="med-issue">Moguća nedosljednost izvornog pitanja ili ključa. Bodovanje slijedi izvorni ključ.</p>' : ""}
        <div class="physics-source-options">${q.options.map((option) => `<label class="physics-source-option" for="med-answer-${q.id}-${option.id}"><strong>${option.id}</strong>${rich(option.content)}</label>`).join("")}</div>
        <div data-response>${responseHtml(q, number)}</div>
      </div>
    </article>`;
  }
  function navigationHtml() {
    return subjects.map((subject) => {
      const count = questions.filter((q) => q.subject === subject).length;
      const answered = questions.filter((q) => q.subject === subject && answers[q.id]).length;
      return `<button class="task-button${subject === activeSubject ? " task-button--active" : ""}" type="button" data-subject="${subject}" aria-pressed="${subject === activeSubject}"><strong>${subject}</strong><small>${answered}/${count}</small></button>`;
    }).join("");
  }
  function renderShell() {
    root.innerHTML = `${window.renderSolverHeader({
      subject: "Prijemni za medicinu", iconName: "stethoscope", subjectColor: "#315f69",
      backHref: home, backLabel: "← Odaberi drugi ispit", title: paper.title,
      eyebrow: "Prijemni za medicinu",
      summaryHtml: `${simulation.active ? '<div class="simulation-timer"><span><span>Simulacija prijemnog</span><strong data-simulation-timer>Čeka potvrdu</strong></span></div>' : ""}<strong id="answer-progress"></strong><span id="score-summary"></span>`,
      navigationHtml: `<nav class="task-navigation solver-header__task-navigation" data-medicine-navigation aria-label="Područja ispita"></nav>`,
    })}
      ${simulation.active ? `<p class="practice-notice simulation-mode-notice"><strong>Simulacija prijemnog:</strong> vremensko ograničenje ${paper.durationMinutes} min. Odgovori i napredak ovog pokušaja ne spremaju se.</p>` : ""}
      ${storageFailed ? '<p class="med-storage-error">Spremanje u ovom pregledniku nije dostupno.</p>' : ""}
      <div class="solver-question-layout"><div class="solver-question-main"><section class="task-content-panel physics-task-content-panel" id="med-content"></section></div>
      ${window.SolverControls.renderQuickSelectShell({ navId: "med-quickselect", jumpId: "med-question-jump", actionHtml: simulation.active ? "" : '<button class="secondary-button med-reset" type="button" data-reset>Obriši napredak</button>' })}</div>
      ${window.SolverControls.renderFooter({ navigationAttribute: "data-medicine-navigation", navigationLabel: "Područja ispita", buttonContent: "" })}`;
    root.querySelector("[data-finish]").addEventListener("click", checkAnswers);
    root.querySelector("#med-content").addEventListener("change", (event) => {
      const input = event.target.closest('input[type="radio"]');
      if (input) changeAnswer(input.closest("[data-question-id]").dataset.questionId, input.value);
    });
    root.querySelector("#med-content").addEventListener("click", (event) => {
      const button = event.target.closest("[data-self-check]");
      if (button) toggleSelfCheck(button.dataset.selfCheck);
      // A diagram inside an option opens the viewer; it must not also pick the answer.
      else if (event.target.closest(".physics-source-option .pdf-source-crop")) event.preventDefault();
    });
    root.querySelector("[data-reset]")?.addEventListener("click", () => {
      if (!window.confirm("Obrisati sve odgovore i provjere ove vježbe?")) return;
      answers = {}; complete = false; selfCheck.reset();
      if (randomPaper) { selectedIds = core.selectRandomQuestions(paper.questionIds, questionMap); questions = selectedIds.map((id) => questionMap.get(id)); }
      activeSubject = questions[0].subject;
      activeQuestionNumber = 1;
      try { localStorage.removeItem(key); storageFailed = false; } catch { storageFailed = true; }
      renderShell(); renderSubject();
      root.querySelector("#med-content").scrollIntoView({ block: "start" });
    });
    window.SolverControls.bindQuickSelect({ root, navId: "med-quickselect", jumpId: "med-question-jump", onJump: jumpToQuestion });
    // Tekst, ključ i crteže server uzima iz data/medicine.js prema id-u pitanja.
    window.AsistentAI?.bindDelegated(root.querySelector("#med-content"), (id) => {
      const index = questions.findIndex((q) => q.id === id);
      if (index === -1) return null;
      return { subject: questions[index].subject, solver: "medicine", examId: paper.id, question: id, label: index + 1, correctAnswer: questions[index].answer };
    }, { official: true });
    updateSummary();
  }
  function updateSummary() {
    const score = result();
    root.querySelector("#answer-progress").textContent = `${score.answered}/${score.total} odgovora`;
    root.querySelector("#score-summary").textContent = `${score.points}/${score.maximum} (${number(score.percentage)}%) bodova`;
    root.querySelector("[data-answer-progress]").textContent = `${score.answered}/${score.total} odgovora`;
    root.querySelector("[data-score-summary]").textContent = `${score.points}/${score.maximum} (${number(score.percentage)}%) bodova`;
    const finishButton = root.querySelector("[data-finish]");
    const submitting = simulation.active && !simulation.finished;
    finishButton.disabled = !submitting && !complete && score.answered === 0;
    finishButton.className = !submitting && complete ? "primary-button primary-button--muted" : "primary-button";
    finishButton.innerHTML = `${icon(submitting || !complete ? "circle-check" : simulation.active ? "eye" : "eye-off", "solver-sticky-footer__action-icon")}${submitting ? "Predaj simulaciju" : complete ? simulation.active ? "Prikaži rezultat" : "Sakrij rješenja" : "Provjeri rješenja"}`;
    root.querySelectorAll("[data-medicine-navigation]").forEach((nav) => {
      nav.innerHTML = navigationHtml();
      nav.querySelectorAll("[data-subject]").forEach((button) => button.addEventListener("click", () => {
        if (activeSubject === button.dataset.subject) return;
        activeSubject = button.dataset.subject;
        activeQuestionNumber = questions.findIndex((q) => q.subject === activeSubject) + 1;
        renderSubject();
        root.querySelector("#med-content").scrollIntoView({ block: "start" });
      }));
    });
  }
  function renderQuickselect() {
    const nav = root.querySelector("#med-quickselect");
    const items = questions.map((q, index) => ({ q, number: index + 1 })).filter(({ q }) => q.subject === activeSubject);
    nav.innerHTML = window.SolverControls.renderQuickSelectItems(items.map(({ q, number: taskNumber }) => {
      const status = revealed(q) ? answers[q.id] === q.answer ? "correct" : "wrong" : answers[q.id] ? "answered" : "";
      const answerState = revealed(q) ? answers[q.id] === q.answer ? "točno" : "netočno" : answers[q.id] ? "odgovoreno" : "bez odgovora";
      return { label: taskNumber, target: taskNumber, status, answerState };
    }));
    root.querySelector("#med-question-jump").innerHTML = window.SolverControls.renderQuickSelectOptions(items.map(({ number: taskNumber }) => ({ label: taskNumber, target: taskNumber })));
    updateQuickSelectActiveState();
  }
  function jumpToQuestion(taskNumber) {
    activeQuestionNumber = Number(taskNumber);
    updateQuickSelectActiveState();
  }
  function updateQuickSelectActiveState() {
    window.SolverControls.updateQuickSelectActiveState({ root, navId: "med-quickselect", jumpId: "med-question-jump", activeGroup: activeQuestionNumber });
  }
  function updateActiveQuestionFromScroll() {
    quickSelectFrame = undefined;
    const taskNumber = Number(window.SolverControls.activeQuestionFromScroll(".med-question", "questionNumber", root));
    if (!taskNumber) return;
    if (taskNumber !== activeQuestionNumber) {
      activeQuestionNumber = taskNumber;
      updateQuickSelectActiveState();
    }
  }
  function renderSubject() {
    const chosen = questions.map((q, index) => ({ q, index })).filter(({ q }) => q.subject === activeSubject);
    root.querySelector("#med-content").innerHTML = `<div class="panel-heading"><div><p class="eyebrow">${paper.kind === "collection" ? "Katalog pitanja" : "Pitanja iz ispita"}</p><h3>${activeSubject}</h3></div><small>Pitanja ${chosen[0].index + 1}-${chosen.at(-1).index + 1} · točan odgovor 5 bodova</small></div><div class="task-source physics-source-list">${chosen.map(({ q, index }) => taskHtml(q, index)).join("")}</div>`;
    updateSummary(); renderQuickselect();
    updateActiveQuestionFromScroll();
  }
  function refreshResponse(id) {
    const index = questions.findIndex((q) => q.id === id);
    const slot = root.querySelector(`[data-question-id="${id}"] [data-response]`);
    if (slot) slot.innerHTML = responseHtml(questions[index], index + 1);
  }
  function refreshResponses() {
    questions.forEach((q) => refreshResponse(q.id));
    updateSummary(); renderQuickselect();
  }
  function toggleSelfCheck(id) {
    if (simulation.active || complete) return;
    selfCheck.toggle(id);
    save(); refreshResponse(id); updateSummary(); renderQuickselect();
  }
  function changeAnswer(id, value) {
    if (simulation.finished || document.body.classList.contains("simulation-start-dialog-open")) return;
    const wasComplete = complete;
    const wasChecked = selfCheck.has(id);
    complete = false;
    selfCheck.delete(id);
    answers[id] = value;
    save();
    // The radio is already checked natively; redraw only when marks must go.
    if (wasComplete) refreshResponses();
    else {
      if (wasChecked) refreshResponse(id);
      updateSummary(); renderQuickselect();
    }
  }
  function checkAnswers() {
    if (simulation.active) {
      if (simulation.finished) openResults();
      else if (window.confirm("Predati simulaciju i završiti rješavanje?")) simulation.finish("submitted");
      return;
    }
    if (complete) {
      complete = false; selfCheck.reset(); save(); refreshResponses();
      return;
    }
    finish("submitted");
  }
  function finish(reason) {
    document.querySelector('.source-image-viewer:not([hidden]) [data-source-image-viewer-close]')?.click();
    complete = true; selfCheck.reset(); save(); refreshResponses(); openResults(reason);
  }
  const dialog = document.createElement("div");
  dialog.className = "exam-results-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "med-results-title");
  dialog.hidden = true;
  document.body.append(dialog);
  let inertElements = [];
  function closeResults() {
    dialog.hidden = true;
    document.body.classList.remove("exam-results-dialog-open");
    inertElements.forEach((element) => { element.inert = false; });
    inertElements = [];
    root.querySelector("[data-finish]").focus({ preventScroll: true });
  }
  function openResults(reason = "") {
    const score = result();
    dialog.innerHTML = `<div class="exam-results-dialog__backdrop"></div><section class="exam-results-dialog__panel"><button class="exam-results-dialog__close" type="button" aria-label="Zatvori rezultat">&times;</button><svg class="exam-results-dialog__check" aria-hidden="true" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28"></circle><path d="m20 33 8 8 17-18"></path></svg><p class="eyebrow">Rezultat cijeloga ispita</p><h2 id="med-results-title">${reason === "expired" ? "Vrijeme je isteklo" : "Rješenja su provjerena"}</h2><div class="exam-results-dialog__metrics"><div><strong>${number(score.percentage)} %</strong><span>Riješenost</span></div><div><strong>${score.points}/${score.maximum}</strong><span>Bodovi</span></div></div><table class="med-result-table"><thead><tr><th scope="col">Područje</th><th scope="col">Točno</th><th scope="col">Bodovi</th></tr></thead><tbody>${score.bySubject.map((part) => `<tr><th scope="row">${part.subject}</th><td>${part.correct}/${part.total}</td><td>${part.points}/${part.maximum}</td></tr>`).join("")}</tbody></table>${paper.threshold ? `<p>${score.passed ? "Ispunjeni su svi pragovi" : "Nisu ispunjeni svi pragovi"} ${randomPaper ? "prema modelu iz 2020." : "za ispit iz 2020."}</p>` : ""}<p>Odgovoreno ${score.answered}/${score.total}. Zatvori prozor i pregledaj označene odgovore.${simulation.active ? " Ovaj pokušaj nije spremljen." : ""}</p>${questions.some((q) => q.reviewIssue) ? '<p>Bodovanje slijedi ključ; moguće nedosljednosti označene su uz pojedine zadatke.</p>' : ""}</section>`;
    dialog.hidden = false;
    inertElements = [...document.body.children].filter((element) => element !== dialog && !element.inert);
    inertElements.forEach((element) => { element.inert = true; });
    document.body.classList.add("exam-results-dialog-open");
    dialog.querySelector("button").addEventListener("click", closeResults);
    dialog.querySelector(".exam-results-dialog__backdrop").addEventListener("click", closeResults);
    dialog.querySelector("button").focus();
  }
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeResults();
    if (event.key === "Tab") { event.preventDefault(); dialog.querySelector("button").focus(); }
  });
  window.addEventListener("scroll", () => {
    if (quickSelectFrame) return;
    quickSelectFrame = requestAnimationFrame(updateActiveQuestionFromScroll);
  }, { passive: true });
  renderShell(); renderSubject(); simulation.start(paper.durationMinutes);
})();
