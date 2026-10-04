(() => {
  let dialog, source, crop, scale = 1, drag, opener, busy = false;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function enhance() {
    document.querySelectorAll('figure[data-crop-source]').forEach(figure => {
      if (figure.closest('.source-image-viewer') || figure.querySelector('[data-edit-crop]')) return;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'secondary-button crop-edit-button';
      button.dataset.editCrop = ''; button.textContent = 'Uredi izrez';
      button.addEventListener('click', () => open(figure, button));
      figure.append(button);
    });
  }
  function setup() {
    dialog = document.createElement('dialog');
    dialog.className = 'crop-editor';
    dialog.setAttribute('aria-labelledby', 'crop-editor-title');
    dialog.innerHTML = `<div class="crop-editor-toolbar"><strong id="crop-editor-title">Uredi izrez zadatka</strong><button type="button" data-close aria-label="Zatvori">×</button></div>
      <p>Pomakni okvir ili povuci njegove kutove. Promjena vrijedi za sve korisnike.</p>
      <div class="crop-editor-toolbar"><button type="button" data-fit>Prikaži izrez</button><button type="button" data-page>Cijela stranica</button><label>Zum <input data-zoom type="range" min="10" max="250" step="1" aria-label="Zum stranice"></label></div>
      <div class="crop-editor-viewport"><div class="crop-editor-page"><img alt="Izvorna stranica službenog PDF-a" draggable="false"><div class="crop-editor-box" tabindex="0" aria-label="Okvir izreza; pomakni tipkama strelica">${['nw','ne','sw','se'].map(corner => `<span data-corner="${corner}"></span>`).join('')}</div></div></div>
      <div class="crop-editor-fields">${[['x','Lijevo'],['y','Gore'],['width','Širina'],['height','Visina']].map(([key,label]) => `<label>${label}<input type="number" data-field="${key}" step="1" min="0"></label>`).join('')}</div>
      <div class="crop-editor-toolbar"><span role="status" data-status></span><button type="button" data-reset>Vrati početni izrez</button><button type="button" class="primary-button" data-save>Spremi izrez</button></div>`;
    document.body.append(dialog);
    dialog.querySelector('[data-close]').onclick = () => { if (!busy) dialog.close(); };
    dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
    dialog.addEventListener('close', () => opener?.focus());
    dialog.querySelector('[data-fit]').onclick = () => fit(false);
    dialog.querySelector('[data-page]').onclick = () => fit(true);
    dialog.querySelector('[data-reset]').onclick = () => { crop = {...source.crop}; draw(); fit(false); };
    dialog.querySelector('[data-zoom]').oninput = e => { scale = Number(e.target.value) / 100; draw(); center(); };
    dialog.querySelectorAll('[data-field]').forEach(input => input.onchange = () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) crop[input.dataset.field] = value;
      normalize(); draw();
    });
    const box = dialog.querySelector('.crop-editor-box');
    box.onpointerdown = e => {
      if (busy || e.button !== 0) return;
      e.preventDefault(); box.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, crop: {...crop}, corner: e.target.dataset.corner };
    };
    box.onpointermove = e => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale;
      const start = drag.crop;
      if (!drag.corner) crop = {...start, x: clamp(start.x + dx, 0, source.width - start.width), y: clamp(start.y + dy, 0, source.height - start.height)};
      else {
        let left = start.x, top = start.y, right = left + start.width, bottom = top + start.height;
        if (drag.corner.includes('w')) left = clamp(left + dx, 0, right - 1);
        else right = clamp(right + dx, left + 1, source.width);
        if (drag.corner.includes('n')) top = clamp(top + dy, 0, bottom - 1);
        else bottom = clamp(bottom + dy, top + 1, source.height);
        crop = {x: left, y: top, width: right-left, height: bottom-top};
      }
      draw();
    };
    box.onpointerup = box.onpointercancel = box.onlostpointercapture = () => { drag = null; };
    box.onkeydown = e => {
      if (busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
      e.preventDefault(); const step = e.shiftKey ? 10 : 1;
      crop.x += e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      crop.y += e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      crop.x = clamp(crop.x, 0, source.width - crop.width); crop.y = clamp(crop.y, 0, source.height - crop.height); draw();
    };
    dialog.querySelector('[data-save]').onclick = save;
  }
  function normalize() {
    crop.x = clamp(crop.x, 0, source.width - 1); crop.y = clamp(crop.y, 0, source.height - 1);
    crop.width = clamp(crop.width, 1, source.width - crop.x); crop.height = clamp(crop.height, 1, source.height - crop.y);
  }
  function draw() {
    const page = dialog.querySelector('.crop-editor-page');
    page.style.width = `${source.width * scale}px`; page.style.height = `${source.height * scale}px`;
    const box = dialog.querySelector('.crop-editor-box');
    Object.assign(box.style, {left: `${crop.x * scale}px`, top: `${crop.y * scale}px`, width: `${crop.width * scale}px`, height: `${crop.height * scale}px`});
    dialog.querySelectorAll('[data-field]').forEach(input => { input.value = Math.round(crop[input.dataset.field] * 100) / 100; });
    dialog.querySelector('[data-zoom]').value = scale * 100;
  }
  function center() {
    const viewport = dialog.querySelector('.crop-editor-viewport');
    viewport.scrollLeft = (crop.x + crop.width / 2) * scale - viewport.clientWidth / 2;
    viewport.scrollTop = (crop.y + crop.height / 2) * scale - viewport.clientHeight / 2;
  }
  function fit(full) {
    const viewport = dialog.querySelector('.crop-editor-viewport');
    scale = clamp(Math.min((viewport.clientWidth - 40) / (full ? source.width : crop.width), (viewport.clientHeight - 40) / (full ? source.height : crop.height)), .1, 2.5);
    draw(); center();
  }
  function open(figure, button) {
    if (!dialog) setup();
    opener = button; source = JSON.parse(figure.dataset.cropSource); crop = {...source.crop}; drag = null;
    dialog.querySelector('[data-status]').textContent = '';
    const img = dialog.querySelector('img');
    img.onerror = () => { dialog.querySelector('[data-status]').textContent = 'Izvorna stranica nije učitana.'; dialog.querySelector('[data-save]').disabled = true; };
    img.onload = () => { dialog.querySelector('[data-save]').disabled = false; };
    dialog.querySelector('[data-save]').disabled = true; img.src = source.url;
    dialog.showModal(); fit(false);
  }
  async function save() {
    busy = true;
    dialog.querySelectorAll('button, input').forEach(control => control.disabled = true);
    const status = dialog.querySelector('[data-status]'); status.textContent = 'Spremanje…';
    try {
      const response = await fetch('/api/admin/crop', {method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id:source.adminCropId, previous:source.crop, crop})});
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Spremanje nije uspjelo.');
      window.location.reload();
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; dialog.querySelectorAll('button, input').forEach(control => control.disabled = false); }
  }
  fetch('/api/auth/me', {credentials:'same-origin'}).then(r => r.ok ? r.json() : null).then(session => {
    if (!session?.authenticated || !session.user?.admin) return;
    enhance();
    new MutationObserver(enhance).observe(document.body, {childList:true, subtree:true});
  }).catch(() => {});
})();
