(function () {
  const root = document.getElementById('caseStudyModal');
  if (!root) return;

  const backdrop = root.querySelector('.case-study-modal-backdrop');
  const panel = root.querySelector('.case-study-modal-panel');
  const titleEl = root.querySelector('[data-case-modal-title]');
  const subtitleEl = root.querySelector('[data-case-modal-subtitle]');
  const descEl = root.querySelector('[data-case-modal-desc]');
  const mediaEl = root.querySelector('[data-case-modal-media]');
  const closeBtn = root.querySelector('[data-case-modal-close]');
  const loaderEl = root.querySelector('[data-case-modal-loader]');

  const MODAL_MIN_LOADER_MS = 500;
  const MODAL_MEDIA_READY_TIMEOUT_MS = 2500;

  function waitForFirstMediaReady(timeoutMs = MODAL_MEDIA_READY_TIMEOUT_MS) {
    const firstVideo = mediaEl.querySelector('video');
    const firstImg = mediaEl.querySelector('img');
    if (!firstVideo && !firstImg) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(finish, timeoutMs);
      if (firstVideo) {
        if (firstVideo.readyState >= 2) { finish(); return; }
        firstVideo.addEventListener('loadeddata', finish, { once: true });
        firstVideo.addEventListener('error', finish, { once: true });
      } else if (firstImg) {
        if (firstImg.complete && firstImg.naturalWidth > 0) { finish(); return; }
        firstImg.addEventListener('load', finish, { once: true });
        firstImg.addEventListener('error', finish, { once: true });
      }
    });
  }

  let studiesCache = null;
  let loadPromise = null;
  let lastFocus = null;

  function loadStudies() {
    if (studiesCache) return Promise.resolve(studiesCache);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('case-study-modals.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        studiesCache = data && typeof data === 'object' ? data : {};
        return studiesCache;
      })
      .catch(() => {
        studiesCache = {};
        return studiesCache;
      });
    return loadPromise;
  }

  function slugFromWorkHref(href) {
    try {
      const path = new URL(href, window.location.href).pathname;
      const m = path.match(/\/work\/([\w-]+)\.html$/i);
      return m ? m[1].toLowerCase() : null;
    } catch {
      const m = (href || '').match(/work\/([\w-]+)\.html$/i);
      return m ? m[1].toLowerCase() : null;
    }
  }

  function renderMedia(items) {
    mediaEl.innerHTML = '';
    (items || []).forEach((item) => {
      if (!item || !item.src) return;
      const wrap = document.createElement('div');
      wrap.className = 'case-study-modal-media-item';
      const isVideo = String(item.type || '').toLowerCase() === 'video';
      if (isVideo) {
        wrap.classList.add('case-study-modal-media-item--video');
        const v = document.createElement('video');
        v.setAttribute('playsinline', '');
        v.playsInline = true;
        v.setAttribute('webkit-playsinline', '');
        v.setAttribute('loop', '');
        v.setAttribute('muted', '');
        v.setAttribute('autoplay', '');
        v.preload = 'auto';
        v.src = item.src;
        if (item.poster) v.poster = item.poster;
        if (item.alt) {
          v.setAttribute('aria-label', item.alt);
          v.title = item.alt;
        }
        v.muted = true;
        v.defaultMuted = true;
        v.play().catch(() => {});
        wrap.appendChild(v);
      } else {
        const img = document.createElement('img');
        img.src = item.src;
        img.alt = item.alt || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        wrap.appendChild(img);
      }
      mediaEl.appendChild(wrap);
    });
  }

  function setOpen(isOpen) {
    root.hidden = !isOpen;
    root.classList.toggle('is-open', isOpen);
    root.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
    document.documentElement.classList.toggle('case-study-modal-open', isOpen);
    document.body.classList.toggle('case-study-modal-open', isOpen);
  }

  function closeModal() {
    mediaEl.querySelectorAll('video').forEach((v) => {
      v.pause();
    });
    mediaEl.innerHTML = '';
    if (panel) {
      panel.classList.remove('case-study-modal-panel--media-only');
      panel.classList.remove('is-loading');
      panel.removeAttribute('aria-label');
      panel.setAttribute('aria-labelledby', 'caseStudyModalTitle');
    }
    if (subtitleEl) {
      subtitleEl.textContent = '';
      subtitleEl.hidden = true;
      subtitleEl.setAttribute('aria-hidden', 'true');
    }
    if (titleEl) {
      titleEl.hidden = false;
      titleEl.removeAttribute('aria-hidden');
    }
    if (descEl) {
      descEl.textContent = '';
      descEl.hidden = false;
      descEl.removeAttribute('aria-hidden');
    }
    setOpen(false);
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus();
      } catch (_) {
        // no-op
      }
    }
    lastFocus = null;
  }

  async function openModal(slug, fallbackHref) {
    lastFocus = document.activeElement;

    if (panel) panel.classList.add('is-loading');
    setOpen(true);

    const started = Date.now();
    const studies = await loadStudies();
    const study = studies[slug];
    if (!study) {
      if (panel) panel.classList.remove('is-loading');
      setOpen(false);
      if (fallbackHref) {
        window.location.href = fallbackHref;
      } else {
        window.location.href = `work/${slug}.html`;
      }
      return;
    }
    const titleStr = (study.title != null ? String(study.title) : '').trim();
    const subtitleStr = (study.subtitle != null ? String(study.subtitle) : '').trim();
    const descStr = (study.description != null ? String(study.description) : '').trim();
    const descHtmlStr = (study.descriptionHtml != null ? String(study.descriptionHtml) : '').trim();
    const hasDesc = !!(descStr || descHtmlStr);

    if (panel) {
      if (titleStr) {
        titleEl.textContent = titleStr;
        titleEl.hidden = false;
        titleEl.removeAttribute('aria-hidden');
        const labelledBy = subtitleStr
          ? 'caseStudyModalTitle caseStudyModalSubtitle'
          : 'caseStudyModalTitle';
        panel.setAttribute('aria-labelledby', labelledBy);
        panel.removeAttribute('aria-label');
      } else {
        titleEl.textContent = '';
        titleEl.hidden = true;
        titleEl.setAttribute('aria-hidden', 'true');
        panel.removeAttribute('aria-labelledby');
        const firstMedia = (study.media || study.items || [])[0];
        const label = (firstMedia && firstMedia.alt) ? String(firstMedia.alt).trim() : 'Preview';
        panel.setAttribute('aria-label', label);
      }

      if (subtitleEl) {
        if (subtitleStr) {
          subtitleEl.textContent = subtitleStr;
          subtitleEl.hidden = false;
          subtitleEl.removeAttribute('aria-hidden');
        } else {
          subtitleEl.textContent = '';
          subtitleEl.hidden = true;
          subtitleEl.setAttribute('aria-hidden', 'true');
        }
      }

      if (descHtmlStr) {
        descEl.innerHTML = descHtmlStr;
      } else {
        descEl.textContent = descStr;
      }
      if (hasDesc) {
        descEl.hidden = false;
        descEl.removeAttribute('aria-hidden');
      } else {
        descEl.hidden = true;
        descEl.setAttribute('aria-hidden', 'true');
      }

      panel.classList.toggle(
        'case-study-modal-panel--media-only',
        !titleStr && !subtitleStr
      );
    }

    renderMedia(study.media || study.items);
    await waitForFirstMediaReady();
    const remaining = MODAL_MIN_LOADER_MS - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((r) => window.setTimeout(r, remaining));
    }
    if (panel) panel.classList.remove('is-loading');
    try { closeBtn.focus(); } catch (_) {}
  }

  document.addEventListener(
    'click',
    (e) => {
      const folder = e.target.closest('[data-case-modal]');
      if (folder) {
        const slug = folder.getAttribute('data-case-modal');
        if (!slug) return;
        e.preventDefault();
        e.stopPropagation();
        openModal(slug.toLowerCase(), null);
        return;
      }

      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!/\/work\/[\w-]+\.html$/i.test(href) && !/^work\/[\w-]+\.html$/i.test(href.trim())) return;

      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (e.button !== 0) return;

      const slug = slugFromWorkHref(link.href);
      if (!slug) return;

      e.preventDefault();
      e.stopPropagation();
      openModal(slug, link.href);
    },
    true
  );

  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  root.addEventListener('click', (e) => {
    if (root.hidden) return;
    if (e.target === root) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (root.hidden) return;
    closeModal();
  });
})();
