(function () {
  const date = (value) => new Date(value).toLocaleDateString("hr-HR");
  async function api(action, method = "GET") {
    const response = await fetch(`/api/billing/${action}`, { method, credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.error || "Zahtjev nije uspio."); error.status = response.status; throw error; }
    return data;
  }
  function mount(root) {
    if (root.dataset.billingMounted) return;
    root.dataset.billingMounted = "1";
    const isProfile = Boolean(root.closest("[data-profile-page]"));
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "billing-actions";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button";
    if (isProfile) button.textContent = "Odi na Matura Plus";
    const history = document.createElement("a");
    history.href = "#";
    history.className = "billing-history-link";
    history.dataset.billingHistory = "1";
    history.textContent = "Pregledaj račune";
    history.hidden = true;
    const continueLink = document.createElement("a");
    continueLink.className = "secondary-button";
    continueLink.textContent = "Nastavi na odabranu maturu";
    continueLink.hidden = true;
    const query = new URLSearchParams(location.search);
    let returnPath = query.get("next") || "";
    if (!returnPath && query.get("success") === "1") {
      try { returnPath = sessionStorage.getItem("maturaPlusReturnPath") || ""; } catch {}
    }
    if (!returnPath.startsWith("/") || returnPath.startsWith("//")) returnPath = "";
    if (returnPath) continueLink.href = returnPath;
    actions.append(button, history, continueLink);
    root.replaceChildren(status, actions);
    let action = "checkout";
    let attempts = new URLSearchParams(location.search).get("success") === "1" ? 15 : 0;
    let timer;
    async function refresh() {
      if (!isProfile) {
        button.disabled = true;
        button.textContent = "Provjera pretplate...";
      }
      try {
        const data = await api("status");
        if (!root.isConnected) return;
        root.dataset.billingState = data.active ? "active" : "inactive";
        continueLink.hidden = isProfile || !data.active || !returnPath;
        if (isProfile) root.closest(".profile-plus-panel").dataset.billingActive = String(data.active);
        const ongoing = !["none", "canceled", "incomplete_expired"].includes(data.status);
        if (data.active) {
          status.textContent = `Matura Plus je aktivan. Pristup vrijedi do ${date(data.premiumUntil)}. ` +
            (data.cancelAtPeriodEnd ? "Obnova je otkazana." : ["past_due", "unpaid"].includes(data.status) ? "Obnova nije naplaćena. Provjeri način plaćanja." : ongoing ? (isProfile ? "Pretplata se automatski obnavlja." : "Pretplata se automatski obnavlja za 7,90 € mjesečno.") : "");
        } else if (["past_due", "unpaid", "incomplete"].includes(data.status)) {
          root.dataset.billingState = "attention";
          status.textContent = "Naplata nije dovršena. Provjeri način plaćanja u upravljanju pretplatom.";
        } else if (attempts > 0) {
          root.dataset.billingState = "pending";
          status.textContent = "Čekamo potvrdu plaćanja. Pristup će se aktivirati nakon potvrde.";
        } else {
          status.textContent = root.closest(".full-access-order") ? "" : "Matura Plus nije aktivan.";
        }
        action = ongoing || data.active && data.hasCustomer ? "portal" : "checkout";
        if (!isProfile) {
          button.textContent = action === "portal" ? "Upravljaj pretplatom" : "Pretplati se";
          button.hidden = data.active && !data.hasCustomer;
          button.disabled = false;
        }
        history.hidden = !data.hasCustomer;
        if (attempts > 0 && !data.active) {
          attempts -= 1;
          if (!isProfile) button.disabled = true;
          if (attempts) timer = setTimeout(refresh, 2000);
          else {
            root.dataset.billingState = "attention";
            status.textContent = "Potvrda plaćanja još nije stigla. Provjeri ponovno za nekoliko trenutaka; nemoj ponavljati kupnju ako si već platio.";
            action = "refresh";
            if (!isProfile) { button.textContent = "Provjeri status"; button.disabled = false; }
          }
        }
      } catch (error) {
        root.dataset.billingState = "attention";
        history.hidden = true;
        if (error.status === 401) {
          status.textContent = "Prijavi se Googleom za kupnju i upravljanje pretplatom.";
          if (!isProfile) button.textContent = "Prijavi se";
          action = "login";
        } else {
          status.textContent = error.message;
          if (!isProfile) button.textContent = "Pokušaj ponovno";
          action = "refresh";
        }
        if (!isProfile) button.disabled = false;
      }
    }
    async function navigate(target, control) {
      if (control.dataset.billingNavigating) return;
      control.dataset.billingNavigating = "1";
      control.disabled = true;
      if (control === history) control.setAttribute("aria-disabled", "true");
      try {
        const data = await api(target, "POST");
        const url = new URL(data.url);
        if (url.protocol !== "https:" || !["checkout.stripe.com", "billing.stripe.com"].includes(url.hostname)) throw new Error("Neispravna poveznica za plaćanje.");
        location.assign(url.href);
      } catch (error) {
        root.dataset.billingState = "attention";
        status.textContent = error.message;
        control.disabled = false;
        control.removeAttribute("aria-disabled");
        delete control.dataset.billingNavigating;
      }
    }
    history.addEventListener("click", (event) => {
      event.preventDefault();
      navigate("portal", history);
    });
    button.addEventListener("click", () => {
      if (isProfile) { location.assign("/plus"); return; }
      if (action === "login") { location.assign(`/prijava.html?next=${encodeURIComponent(location.pathname + location.search)}`); return; }
      if (action === "refresh") { attempts = 0; refresh(); return; }
      if (action === "checkout" && returnPath) {
        try { sessionStorage.setItem("maturaPlusReturnPath", returnPath); } catch {}
      }
      navigate(action, button);
    });
    window.addEventListener("pagehide", () => clearTimeout(timer), { once: true });
    refresh();
  }
  function scan() { document.querySelectorAll("[data-billing]").forEach(mount); }
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  scan();
})();
