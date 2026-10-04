/* Keep beta navigation local without modifying production solvers or their storage. */
(() => {
  const home = '/assets/beta/index.html';
  const params = new URLSearchParams(location.search);
  const returnValue = params.get('betaReturn');
  let returnUrl = null;
  try {
    const candidate = new URL(returnValue || '', location.origin);
    if (returnValue && candidate.origin === location.origin && candidate.pathname === home) returnUrl = candidate;
  } catch {}
  if (!location.pathname.endsWith('/index.html') && !location.pathname.endsWith('/beta/') && !params.has('exam')) {
    location.replace(returnUrl?.href || home);
    return;
  }
  function rewrite(link) {
    if (link.hasAttribute('data-beta-exit')) return;
    const raw = link.getAttribute('href');
    if (!raw) return;
    const url = new URL(raw, document.baseURI);
    if (url.origin !== location.origin) return;
    if (raw.startsWith('#')) {
      link.href = location.pathname + location.search + raw;
      return;
    }
    if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.startsWith('/predmeti/')) {
      const isSubject = url.searchParams.has('predmet') || url.pathname.startsWith('/predmeti/');
      if (isSubject && returnUrl) {
        link.href = returnUrl.pathname + returnUrl.search + returnUrl.hash;
      } else if (url.pathname.startsWith('/predmeti/')) {
        // Subject links in the beta app already use its query router.
        return;
      } else {
        link.href = home + url.search + url.hash;
      }
    }
  }
  const scan = node => {
    if (!(node instanceof Element)) return;
    if (node.matches('a[href]')) rewrite(node);
    node.querySelectorAll('a[href]').forEach(rewrite);
  };
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) scan(node);
  }).observe(document.documentElement, { subtree: true, childList: true });
  document.addEventListener('DOMContentLoaded', () => scan(document.body));
})();
