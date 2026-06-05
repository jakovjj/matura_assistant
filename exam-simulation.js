(() => {
  const startConfirmationKey = "asistent-za-mature:simulation-start-confirmation";
  const startConfirmationMaxAgeMs = 5 * 60 * 1000;

  function formatRemainingTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
  }

  function icon(iconName, className) {
    if (window.renderLucideIcon) return window.renderLucideIcon(iconName, className);

    return `
      <svg class="${className}" aria-hidden="true" focusable="false" viewBox="0 0 24 24">
        <use href="./assets/lucide-icons.svg#${iconName}"></use>
      </svg>
    `;
  }

  function simulationUrlSignature(value) {
    try {
      const url = new URL(value, window.location.href);
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function rememberSimulationStartConfirmation({ targetUrl, confirmedAt = Date.now() } = {}) {
    const normalizedTargetUrl = simulationUrlSignature(targetUrl);
    if (!normalizedTargetUrl) return;

    try {
      window.sessionStorage.setItem(
        startConfirmationKey,
        JSON.stringify({
          confirmedAt,
          targetUrl: normalizedTargetUrl,
        }),
      );
    } catch {
      // Direct simulation links still fall back to the solver-side confirmation dialog.
    }
  }

  function takeSimulationStartConfirmation() {
    let rawRecord = "";

    try {
      rawRecord = window.sessionStorage.getItem(startConfirmationKey) || "";
    } catch {
      return null;
    }

    if (!rawRecord) return null;

    let record = null;
    try {
      record = JSON.parse(rawRecord);
    } catch {
      record = null;
    }

    const currentUrl = simulationUrlSignature(window.location.href);
    const rawTargetUrl = typeof record?.targetUrl === "string" ? record.targetUrl : "";
    const targetUrl = rawTargetUrl ? simulationUrlSignature(rawTargetUrl) : "";
    const confirmedAt = Number(record?.confirmedAt);
    const expired =
      !Number.isFinite(confirmedAt) || Date.now() - confirmedAt > startConfirmationMaxAgeMs;
    const matchesCurrentUrl = Boolean(currentUrl && targetUrl && targetUrl === currentUrl);

    if (expired || matchesCurrentUrl) {
      try {
        window.sessionStorage.removeItem(startConfirmationKey);
      } catch {
        // Nothing to clean up when storage is unavailable.
      }
    }

    if (expired || !matchesCurrentUrl) return null;
    return { confirmedAt };
  }

  function openSimulationStartDialog({ durationMinutes, onCancel, onConfirm } = {}) {
    const startDialog = document.createElement("div");
    const duration = Number(durationMinutes);
    const durationItem = Number.isFinite(duration)
      ? `<li><strong>Vremensko ograničenje:</strong> ${duration} min.</li>`
      : "";
    let closed = false;
    let inertElements = [];

    function restorePageInteraction() {
      inertElements.forEach((element) => {
        element.inert = false;
      });
      inertElements = [];
    }

    function close() {
      if (closed) return;

      closed = true;
      startDialog.remove();
      document.body.classList.remove("simulation-start-dialog-open");
      restorePageInteraction();
    }

    function cancel() {
      close();
      onCancel?.();
    }

    function confirm() {
      const confirmedAt = Date.now();
      close();
      onConfirm?.({ confirmedAt });
    }

    function handleKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = [...startDialog.querySelectorAll("button")];
      const firstElement = focusableElements[0];
      const lastElement = focusableElements.at(-1);

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    startDialog.className = "simulation-start-dialog";
    startDialog.setAttribute("role", "dialog");
    startDialog.setAttribute("aria-modal", "true");
    startDialog.setAttribute("aria-labelledby", "simulation-start-title");
    startDialog.setAttribute("aria-describedby", "simulation-start-description");
    startDialog.innerHTML = `
      <div class="simulation-start-dialog__backdrop" aria-hidden="true"></div>
      <section class="simulation-start-dialog__panel">
        <h2 id="simulation-start-title">Započeti simulaciju?</h2>
        <p id="simulation-start-description">
          Potvrdom simulacija odmah počinje i pokreće se odbrojavanje.
        </p>
        <ul class="simulation-start-dialog__details">
          ${durationItem}
          <li>Odbrojavanje se ne može pauzirati.</li>
          <li>
            Ako osvježiš stranicu, svi odgovori i napredak rješavanja brišu se.
          </li>
        </ul>
        <div class="simulation-start-dialog__actions">
          <button class="secondary-button" type="button" data-simulation-cancel>
            Odustani
          </button>
          <button class="primary-button" type="button" data-simulation-confirm>
            Započni simulaciju
          </button>
        </div>
      </section>
    `;

    inertElements = [...document.body.children].filter((element) => !element.inert);
    inertElements.forEach((element) => {
      element.inert = true;
    });
    document.body.append(startDialog);
    document.body.classList.add("simulation-start-dialog-open");

    startDialog.querySelector("[data-simulation-cancel]").addEventListener("click", cancel);
    startDialog.querySelector("[data-simulation-confirm]").addEventListener("click", confirm);
    startDialog.addEventListener("keydown", handleKeydown);
    startDialog.querySelector("[data-simulation-cancel]").focus();

    return { close };
  }

  window.openExamSimulationStartDialog = openSimulationStartDialog;
  window.rememberExamSimulationStart = rememberSimulationStartConfirmation;

  window.createExamSimulation = ({ onFinish }) => {
    const active =
      new URLSearchParams(window.location.search).get("nacin") === "simulacija";
    let deadline = 0;
    let durationMinutes = 0;
    let finishReason = "";
    let startedAt = 0;
    let timerId = 0;
    let startDialog = null;
    let startPending = false;

    function statusText() {
      if (finishReason === "submitted") return "Simulacija predana";
      if (finishReason === "expired") return "Vrijeme je isteklo";
      if (!deadline) return active ? "Čeka potvrdu" : "";

      const remainingSeconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      return `Preostalo ${formatRemainingTime(remainingSeconds)}`;
    }

    function updateTimer() {
      document.querySelectorAll("[data-simulation-timer]").forEach((element) => {
        element.textContent = statusText();
      });

      if (deadline && Date.now() >= deadline) finish("expired");
    }

    function finish(reason) {
      if (!active || finishReason) return;

      finishReason = reason;
      window.clearInterval(timerId);
      timerId = 0;
      updateTimer();
      window.AsistentAnalytics?.track?.("simulation_complete", {
        completion_reason: reason,
        duration_minutes: durationMinutes,
        elapsed_seconds: startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0,
      });
      onFinish(reason);
    }

    function closeStartDialog() {
      startDialog?.close();
      startDialog = null;
      document.body.classList.remove("simulation-start-dialog-open");
    }

    function leaveSimulationMode() {
      if (startPending) window.AsistentAnalytics?.track?.("simulation_cancel");
      const url = new URL(window.location.href);
      url.searchParams.delete("nacin");
      window.location.replace(url.toString());
    }

    function confirmStart(duration, confirmedAt = Date.now()) {
      startPending = false;
      closeStartDialog();
      durationMinutes = Number(duration);
      startedAt = Number.isFinite(Number(confirmedAt)) ? Number(confirmedAt) : Date.now();
      deadline = startedAt + durationMinutes * 60 * 1000;
      updateTimer();
      timerId = window.setInterval(updateTimer, 1000);
      window.AsistentAnalytics?.track?.("simulation_start", { duration_minutes: durationMinutes });
    }

    function openStartDialog(durationMinutes) {
      startPending = true;
      startDialog = openSimulationStartDialog({
        durationMinutes,
        onCancel: leaveSimulationMode,
        onConfirm: ({ confirmedAt }) => confirmStart(durationMinutes, confirmedAt),
      });
    }

    return {
      active,
      finish,
      get finished() {
        return Boolean(finishReason);
      },
      inputDisabledAttribute() {
        return finishReason ? " disabled" : "";
      },
      renderNotice() {
        if (!active) return "";

        return `
          <p class="practice-notice simulation-mode-notice">
            <strong>Simulacija mature:</strong> vrijeme je ograničeno, a odgovori i
            napredak rješavanja iz ovoga pokušaja ne spremaju se.
          </p>
        `;
      },
      renderTimer() {
        if (!active) return "";

        return `
          <div class="simulation-timer">
            ${icon("clock", "simulation-timer__icon")}
            <span>
              <span>Simulacija mature</span>
              <strong data-simulation-timer>${statusText()}</strong>
            </span>
          </div>
        `;
      },
      start(durationMinutes) {
        if (!active || deadline || finishReason || startPending) return;

        const startConfirmation = takeSimulationStartConfirmation();
        if (startConfirmation) {
          confirmStart(durationMinutes, startConfirmation.confirmedAt);
          return;
        }

        openStartDialog(durationMinutes);
      },
    };
  };
})();
