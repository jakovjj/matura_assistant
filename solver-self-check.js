(() => {
  function escapeAttribute(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function icon(name) {
    if (window.renderLucideIcon) return window.renderLucideIcon(name, "inline-check-button__icon");

    return `
      <svg class="inline-check-button__icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/lucide-icons.svg#${name}"></use>
      </svg>
    `;
  }

  function controlHasAnswer(control) {
    if (control.type === "radio" || control.type === "checkbox") return control.checked;
    return String(control.value || "").trim().length > 0;
  }

  function rootHasAnswer(root, question) {
    const key = String(question);
    return Array.from(root.querySelectorAll("[data-question]")).some((control) => (
      String(control.dataset.question) === key && controlHasAnswer(control)
    ));
  }

  function buttonForQuestion(root, question) {
    const key = String(question);
    return Array.from(root.querySelectorAll("[data-self-check]")).find(
      (button) => String(button.dataset.selfCheck) === key,
    );
  }

  function refreshButtonState(root, question) {
    const button = buttonForQuestion(root, question);
    if (!button) return;
    button.disabled = !rootHasAnswer(root, question);
  }

  // Shared per-task self-check used by every solver outside simulation mode.
  // It tracks which individual tasks the user has revealed and renders the
  // "Provjeri zadatak" button. Score aggregation stays in each solver so the
  // running result can include each checked task.
  window.createTaskSelfCheck = () => {
    const checkedQuestions = new Set();

    return {
      has(question) {
        return checkedQuestions.has(String(question));
      },
      get size() {
        return checkedQuestions.size;
      },
      reset() {
        checkedQuestions.clear();
      },
      delete(question) {
        checkedQuestions.delete(String(question));
      },
      toggle(question, answered) {
        const key = String(question);
        if (checkedQuestions.has(key)) {
          checkedQuestions.delete(key);
          return false;
        }
        if (!answered) return false;
        checkedQuestions.add(key);
        return true;
      },
      // Renders the inline button beside a task. Hidden during simulation or
      // once the whole exam has been checked, since the solution is already
      // revealed in those states.
      renderButton(question, { answered = true, hidden = false } = {}) {
        if (hidden) return "";
        const on = checkedQuestions.has(String(question));
        const label = on ? "Sakrij rješenje" : "Provjeri zadatak";
        return `
          <button
            class="inline-check-button${on ? " inline-check-button--active" : ""}"
            type="button"
            data-self-check="${escapeAttribute(question)}"
            aria-pressed="${on ? "true" : "false"}"
            ${answered ? "" : "disabled"}
          >
            ${icon(on ? "eye-off" : "circle-check")}
            <span>${label}</span>
          </button>
        `;
      },
      bind(root, onToggle) {
        if (!root) return;
        root.querySelectorAll("[data-self-check]").forEach((button) => {
          button.addEventListener("click", () => onToggle(button.dataset.selfCheck));
        });
        root.querySelectorAll("[data-question]").forEach((control) => {
          const update = () => refreshButtonState(root, control.dataset.question);
          control.addEventListener("input", update);
          control.addEventListener("change", update);
        });
      },
    };
  };
})();
