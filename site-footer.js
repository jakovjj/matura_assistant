(() => {
  const siteFooterRoot = document.querySelector("[data-site-footer]");

  if (!siteFooterRoot) return;
  const isMedicinePage =
    window.location.pathname.endsWith("/medicina.html") ||
    new URLSearchParams(window.location.search).get("predmet") === "Prijemni za medicinu";

  siteFooterRoot.outerHTML = `
    <footer class="site-footer">
      <div class="container site-footer__inner">
        <div class="footer-brand">
          <img
            class="footer-brand__mark"
            src="./assets/asistent_za_maturu.webp"
            alt=""
            width="40"
            height="40"
            loading="lazy"
            draggable="false"
            decoding="async"
          />
          <div class="footer-brand__copy">
            <strong>Maturomat</strong>
            <p>${isMedicinePage ? "Interaktivni zadatci za pripremu prijemnog ispita." : "Interaktivni ispiti za vježbu državne mature."}</p>
          </div>
        </div>
        <div class="footer-meta">
          <p>Neslužbeni projekt.</p>
          <p>Copyright &copy; 2026 Maturomat. Odgovorna osoba: Jakov Jandrić.</p>
          ${isMedicinePage ? "" : `<p>
            Ispitni materijali:
            <a
              href="https://www.ncvvo.hr/kategorija/drzavna-matura/provedeni-ispiti/"
              target="_blank"
              rel="noreferrer"
              >NCVVO</a
            >
          </p>`}
        </div>
        <div class="footer-actions">
          <a
            class="footer-github"
            href="https://github.com/jakovjj/matura_assistant"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub repozitorij projekta jakovjj/matura_assistant"
            title="GitHub repozitorij"
          >
            <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24"><use href="./assets/phosphor-icons.svg#github-logo"></use></svg>
          </a>
        </div>
      </div>
    </footer>
  `;
})();
