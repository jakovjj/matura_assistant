(() => {
  const openButtons = document.querySelectorAll("[data-feedback-open]");
  const dialog = document.querySelector("[data-feedback-dialog]");

  if (!openButtons.length || !dialog) return;

  const form = dialog.querySelector("[data-feedback-form]");
  const messageInput = dialog.querySelector("[data-feedback-message]");
  const contactInput = dialog.querySelector("[data-feedback-contact]");
  const websiteInput = dialog.querySelector("[data-feedback-website]");
  const status = dialog.querySelector("[data-feedback-status]");
  const submitButton = dialog.querySelector("[data-feedback-submit]");
  const closeButtons = dialog.querySelectorAll("[data-feedback-close]");
  let previousFocus = null;

  const setStatus = (message, state = "") => {
    if (!status) return;
    status.textContent = message;
    status.dataset.state = state;
  };

  const openDialog = () => {
    previousFocus = document.activeElement;
    dialog.hidden = false;
    document.documentElement.classList.add("feedback-dialog-open");
    setStatus("");
    window.requestAnimationFrame(() => {
      if (messageInput) messageInput.focus();
    });
  };

  const closeDialog = () => {
    dialog.hidden = true;
    document.documentElement.classList.remove("feedback-dialog-open");
    setStatus("");
    if (form) form.reset();
    if (previousFocus && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
  };

  openButtons.forEach((button) => button.addEventListener("click", openDialog));
  closeButtons.forEach((button) => button.addEventListener("click", closeDialog));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.hidden) {
      closeDialog();
    }
  });

  if (!form || !messageInput || !submitButton) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = messageInput.value.trim();
    if (!message) {
      setStatus("Upiši poruku prije slanja.", "error");
      messageInput.focus();
      return;
    }

    submitButton.disabled = true;
    setStatus("Šaljem poruku...");

    try {
      const response = await fetch("/api/feedback", {
        body: JSON.stringify({
          contact: contactInput ? contactInput.value.trim() : "",
          message,
          page: window.location.href,
          referrer: document.referrer,
          website: websiteInput ? websiteInput.value.trim() : "",
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Poruku nije moguće poslati.");
      }

      form.reset();
      setStatus("Poruka je poslana. Hvala.", "success");
      messageInput.focus();
    } catch (error) {
      setStatus(error.message || "Poruku nije moguće poslati.", "error");
    } finally {
      submitButton.disabled = false;
    }
  });
})();
