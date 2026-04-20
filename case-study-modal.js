(function () {
  const root = document.getElementById('caseStudyModal');
  if (!root) return;

  const backdrop = root.querySelector('.case-study-modal-backdrop');
  const panel = root.querySelector('.case-study-modal-panel');
  const titleEl = root.querySelector('[data-case-modal-title]');
  const subtitleEl = root.querySelector('[data-case-modal-subtitle]');
  const descEl = root.querySelector('[data-case-modal-desc]');
  const headerEl = root.querySelector('[data-case-modal-header]');
  const mediaEl = root.querySelector('[data-case-modal-media]');
  const closeBtn = root.querySelector('[data-case-modal-close]');
  const loaderEl = root.querySelector('[data-case-modal-loader]');
  const navEl = root.querySelector('[data-case-modal-nav]');
  const navPrevBtn = root.querySelector('[data-case-modal-nav-prev]');
  const navNextBtn = root.querySelector('[data-case-modal-nav-next]');
  const navPrevLabelEl = root.querySelector('[data-case-modal-nav-prev-label]');
  const navNextLabelEl = root.querySelector('[data-case-modal-nav-next-label]');

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
  let orderedSlugs = [];
  let currentSlug = null;
  let loadPromise = null;
  let lastFocus = null;
  let savedScrollX = 0;
  let savedScrollY = 0;

  function loadStudies() {
    if (studiesCache) return Promise.resolve(studiesCache);
    if (loadPromise) return loadPromise;
    loadPromise = fetch('case-study-modals.json', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data) => {
        studiesCache = data && typeof data === 'object' ? data : {};
        orderedSlugs = Object.keys(studiesCache);
        return studiesCache;
      })
      .catch(() => {
        studiesCache = {};
        orderedSlugs = [];
        return studiesCache;
      });
    return loadPromise;
  }

  function getStudyLabel(slug) {
    const s = studiesCache && studiesCache[slug];
    if (!s) return slug;
    const headerTag = s.header && s.header.tag ? String(s.header.tag).trim() : '';
    if (headerTag) return headerTag;
    const title = s.title ? String(s.title).trim() : '';
    if (title) return title;
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  function renderNav(slug) {
    if (!navEl) return;
    const count = orderedSlugs.length;
    if (count <= 1 || !slug) {
      navEl.hidden = true;
      return;
    }
    const idx = orderedSlugs.indexOf(slug);
    if (idx < 0) {
      navEl.hidden = true;
      return;
    }
    const prevSlug = orderedSlugs[(idx - 1 + count) % count];
    const nextSlug = orderedSlugs[(idx + 1) % count];
    if (navPrevLabelEl) navPrevLabelEl.textContent = getStudyLabel(prevSlug);
    if (navNextLabelEl) navNextLabelEl.textContent = getStudyLabel(nextSlug);
    if (navPrevBtn) {
      navPrevBtn.dataset.targetSlug = prevSlug;
      navPrevBtn.setAttribute('aria-label', `Previous project: ${getStudyLabel(prevSlug)}`);
    }
    if (navNextBtn) {
      navNextBtn.dataset.targetSlug = nextSlug;
      navNextBtn.setAttribute('aria-label', `Next project: ${getStudyLabel(nextSlug)}`);
    }
    navEl.hidden = false;
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

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderHeader(header) {
    if (!headerEl) return false;
    if (!header || typeof header !== 'object') {
      headerEl.innerHTML = '';
      headerEl.hidden = true;
      headerEl.setAttribute('aria-hidden', 'true');
      return false;
    }
    const tag = header.tag ? String(header.tag).trim() : '';
    const headline = header.headline ? String(header.headline).trim() : '';
    const description = header.description ? String(header.description).trim() : '';
    const meta = Array.isArray(header.meta) ? header.meta : [];

    const metaRows = meta
      .filter((row) => row && (row.label || row.value))
      .map((row) => (
        `<div class="case-study-modal-header-meta-row">` +
          `<dt class="case-study-modal-header-meta-label">${escapeHtml(row.label || '')}</dt>` +
          `<dd class="case-study-modal-header-meta-value">${escapeHtml(row.value || '')}</dd>` +
        `</div>`
      ))
      .join('');

    const tagMarkup = tag
      ? `<p class="case-study-modal-header-tag">${escapeHtml(tag)}</p>`
      : '';

    const lead =
      (headline ? `<h2 class="case-study-modal-header-headline" id="caseStudyModalHeaderHeadline">${escapeHtml(headline)}</h2>` : '') +
      (description ? `<p class="case-study-modal-header-description">${escapeHtml(description)}</p>` : '');

    const right = metaRows
      ? `<aside class="case-study-modal-header-meta" aria-label="Project details"><dl>${metaRows}</dl></aside>`
      : '';

    headerEl.innerHTML = `<div class="case-study-modal-header-grid">` +
      tagMarkup +
      `<div class="case-study-modal-header-lead">${lead}</div>` +
      right +
      `</div>`;
    headerEl.hidden = false;
    headerEl.removeAttribute('aria-hidden');
    return !!(tag || headline || description || metaRows);
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

  function getDocumentScrollX() {
    const se = document.scrollingElement || document.documentElement;
    return Math.max(window.scrollX || 0, se ? se.scrollLeft : 0);
  }

  function getDocumentScrollY() {
    const se = document.scrollingElement || document.documentElement;
    return Math.max(window.scrollY || 0, se ? se.scrollTop : 0);
  }

  function setOpen(isOpen) {
    const wasOpen = root.classList.contains('is-open');
    root.hidden = !isOpen;
    root.classList.toggle('is-open', isOpen);
    root.setAttribute('aria-hidden', isOpen ? 'false' : 'true');

    const docEl = document.documentElement;
    if (isOpen && !wasOpen) {
      // Freeze the page at its current scroll position using the
      // position:fixed lock pattern. Simply toggling `overflow: hidden`
      // on html/body is not reliable on this map-canvas layout and
      // often snaps scrollLeft/scrollTop to 0.
      docEl.style.top = `-${savedScrollY}px`;
      docEl.style.left = `-${savedScrollX}px`;
    } else if (!isOpen && wasOpen) {
      docEl.style.top = '';
      docEl.style.left = '';
    }
    docEl.classList.toggle('case-study-modal-open', isOpen);
    document.body.classList.toggle('case-study-modal-open', isOpen);
  }

  function closeModal() {
    mediaEl.querySelectorAll('video').forEach((v) => {
      v.pause();
    });
    // Remember the scroll position captured when the modal opened so we
    // can restore it after the position:fixed lock is lifted.
    const targetScrollX = savedScrollX;
    const targetScrollY = savedScrollY;
    mediaEl.innerHTML = '';
    if (panel) {
      panel.classList.remove('case-study-modal-panel--media-only');
      panel.classList.remove('is-loading');
      panel.removeAttribute('aria-label');
      panel.setAttribute('aria-labelledby', 'caseStudyModalTitle');
    }
    if (headerEl) {
      headerEl.innerHTML = '';
      headerEl.hidden = true;
      headerEl.setAttribute('aria-hidden', 'true');
    }
    if (navEl) {
      navEl.hidden = true;
      if (navPrevBtn) { delete navPrevBtn.dataset.targetSlug; navPrevBtn.removeAttribute('aria-label'); }
      if (navNextBtn) { delete navNextBtn.dataset.targetSlug; navNextBtn.removeAttribute('aria-label'); }
      if (navPrevLabelEl) navPrevLabelEl.textContent = '';
      if (navNextLabelEl) navNextLabelEl.textContent = '';
    }
    currentSlug = null;
    if (subtitleEl) {
      subtitleEl.textContent = '';
      subtitleEl.hidden = true;
      subtitleEl.setAttribute('aria-hidden', 'true');
    }
    if (titleEl) {
      titleEl.hidden = false;
      titleEl.removeAttribute('aria-hidden');
    }
    if (panel) {
      panel.classList.remove('case-study-modal-panel--has-header');
    }
    if (descEl) {
      descEl.textContent = '';
      descEl.hidden = false;
      descEl.removeAttribute('aria-hidden');
    }
    setOpen(false);
    // Unfixing <html> leaves the document at scroll (0,0). Restore the
    // saved position synchronously, then one more time on the next
    // frame as a safety net against any layout settling.
    try { window.scrollTo(targetScrollX, targetScrollY); } catch (_) {}
    window.requestAnimationFrame(() => {
      if (window.scrollX !== targetScrollX || window.scrollY !== targetScrollY) {
        try { window.scrollTo(targetScrollX, targetScrollY); } catch (_) {}
      }
    });
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus({ preventScroll: true });
      } catch (_) {
        try { lastFocus.focus(); } catch (_) {}
      }
    }
    lastFocus = null;
  }

  async function openModal(slug, fallbackHref, opts) {
    const isNavigation = !!(opts && opts.isNavigation);
    if (!isNavigation) {
      lastFocus = document.activeElement;
      savedScrollX = getDocumentScrollX();
      savedScrollY = getDocumentScrollY();
    }

    if (panel) {
      panel.classList.add('is-loading');
      if (isNavigation) {
        try { panel.scrollTo(0, 0); } catch (_) { panel.scrollTop = 0; }
      }
    }
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
    const hasHeader = renderHeader(study.header);

    if (panel) {
      panel.classList.toggle('case-study-modal-panel--has-header', hasHeader);

      if (hasHeader) {
        if (titleEl) {
          titleEl.textContent = '';
          titleEl.hidden = true;
          titleEl.setAttribute('aria-hidden', 'true');
        }
        if (subtitleEl) {
          subtitleEl.textContent = '';
          subtitleEl.hidden = true;
          subtitleEl.setAttribute('aria-hidden', 'true');
        }
        panel.setAttribute('aria-labelledby', 'caseStudyModalHeaderHeadline');
        panel.removeAttribute('aria-label');
      } else if (titleStr) {
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

      if (!hasHeader && subtitleEl) {
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
        !hasHeader && !titleStr && !subtitleStr
      );
    }

    currentSlug = slug;
    renderNav(slug);

    renderMedia(study.media || study.items);
    await waitForFirstMediaReady();
    const remaining = MODAL_MIN_LOADER_MS - (Date.now() - started);
    if (remaining > 0) {
      await new Promise((r) => window.setTimeout(r, remaining));
    }
    if (panel) panel.classList.remove('is-loading');
    if (!isNavigation) {
      try { closeBtn.focus(); } catch (_) {}
    }
  }

  function navigateBy(direction) {
    if (!orderedSlugs.length || !currentSlug) return;
    const idx = orderedSlugs.indexOf(currentSlug);
    if (idx < 0) return;
    const n = orderedSlugs.length;
    const nextIdx = (idx + direction + n) % n;
    const nextSlug = orderedSlugs[nextIdx];
    if (nextSlug === currentSlug) return;
    openModal(nextSlug, null, { isNavigation: true });
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

  if (navPrevBtn) {
    navPrevBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateBy(-1);
    });
  }
  if (navNextBtn) {
    navNextBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      navigateBy(1);
    });
  }
  root.addEventListener('click', (e) => {
    if (root.hidden) return;
    if (e.target === root) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (root.hidden) return;
      closeModal();
      return;
    }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !root.hidden) {
      const tgt = e.target;
      const tag = tgt && tgt.tagName ? tgt.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || (tgt && tgt.isContentEditable)) return;
      e.preventDefault();
      navigateBy(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      const target = e.target;
      if (!target || !target.closest) return;
      const trigger = target.closest('[data-case-modal][role="button"]');
      if (!trigger) return;
      const slug = trigger.getAttribute('data-case-modal');
      if (!slug) return;
      e.preventDefault();
      openModal(slug.toLowerCase(), null);
    }
  });
})();
