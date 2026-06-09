(() => {
  const siteFooterRoot = document.querySelector("[data-site-footer]");

  if (!siteFooterRoot) return;

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
            <strong>Asistent za Mature</strong>
            <p>Interaktivni ispiti za vježbu državne mature.</p>
            <a
              class="footer-coffee"
              href="https://buymeacoffee.com/jakovjj"
              target="_blank"
              rel="noreferrer"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M10 2v2" />
                <path d="M14 2v2" />
                <path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1" />
                <path d="M6 2v2" />
              </svg>
              <span>Kupite mi kavu</span>
            </a>
          </div>
        </div>
        <div class="footer-meta">
          <p><strong>Neslužbeni projekt.</strong> Nije službena usluga NCVVO-a.</p>
          <p>Copyright &copy; 2026 Asistent za Mature. Odgovorna osoba: Jakov Jandrić.</p>
          <p>
            Ispitni materijali:
            <a
              href="https://www.ncvvo.hr/kategorija/drzavna-matura/provedeni-ispiti/"
              target="_blank"
              rel="noreferrer"
              >NCVVO</a
            >
          </p>
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
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path
                d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.11.79-.25.79-.56v-2c-3.22.7-3.9-1.38-3.9-1.38-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.57-.29-5.27-1.28-5.27-5.71 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a10.98 10.98 0 0 1 5.78 0c2.2-1.49 3.16-1.18 3.16-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.44-2.7 5.42-5.28 5.7.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"
              />
            </svg>
          </a>
        </div>
      </div>
    </footer>
  `;
})();
