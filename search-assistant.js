(function () {
  const EMAIL_HREF = 'mailto:Nicolle.matson@gmail.com';

  const RELEVANCE_KEYWORDS = [
    'nico',
    'nicolle',
    'matson',
    'nicollerich',
    'yahoo',
    'asana',
    'figma',
    'designer',
    'linkedin.com/in/',
    'payitoff',
    'pay it off'
  ];
  let knowledgeEntriesPromise = null;
  const organicAnswerCache = new Map();
  let llmStatusNode = null;
  const ROTATING_PLACEHOLDERS = [
    'Who is Nico Matson?',
    "What does Nico do at Yahoo?",
    'What did Nico work on at Figma?',
    'What is Nico\'s leadership style?',
    'How can I contact Nico?'
  ];
  const DEFAULT_PLACEHOLDER = 'Ask me stuff, I might have an answer';

  function isAboutNico(item) {
    const blob = `${item.title || ''} ${item.snippet || ''} ${item.link || ''}`.toLowerCase();
    return RELEVANCE_KEYWORDS.some((k) => blob.includes(k));
  }

  function buildQuery(userQuery) {
    const q = (userQuery || '').trim();
    if (!q) return '';
    return `${q} Nico Matson nicolle designer`;
  }

  async function fetchGoogleCustomSearch(userQuery) {
    const cfg = window.PORTFOLIO_SEARCH_CONFIG || {};
    const key = cfg.googleApiKey;
    const cx = cfg.googleCx;
    if (!key || !cx) {
      return { ok: false };
    }
    const q = buildQuery(userQuery);
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', key);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', q);
    url.searchParams.set('num', '8');
    const res = await fetch(url.toString());
    if (!res.ok) {
      return { ok: false };
    }
    const data = await res.json();
    return { ok: true, items: data.items || [] };
  }

  async function fetchOrganicAnswer(question, baseAnswer) {
    const cacheKey = `${question}::${baseAnswer}`;
    if (organicAnswerCache.has(cacheKey)) {
      return organicAnswerCache.get(cacheKey);
    }

    try {
      const res = await fetch('/api/organic-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          baseAnswer
        })
      });
      if (!res.ok) return '';
      const data = await res.json();
      const organic = typeof data.answer === 'string' ? data.answer.trim() : '';
      if (!organic) return '';
      organicAnswerCache.set(cacheKey, organic);
      return organic;
    } catch {
      return '';
    }
  }

  function getOrCreateLlmStatusNode() {
    if (llmStatusNode && llmStatusNode.isConnected) return llmStatusNode;
    const group = document.querySelector('.search-group');
    if (!group) return null;
    llmStatusNode = document.createElement('p');
    llmStatusNode.className = 'search-llm-status';
    llmStatusNode.textContent = 'AI: checking...';
    group.appendChild(llmStatusNode);
    return llmStatusNode;
  }

  function setLlmStatus(available, model = '') {
    const node = getOrCreateLlmStatusNode();
    if (!node) return;
    node.classList.toggle('is-online', !!available);
    node.classList.toggle('is-offline', !available);
    node.textContent = available
      ? `AI online${model ? ` (${model})` : ''}`
      : 'AI offline';
  }

  async function refreshLlmStatus() {
    const node = getOrCreateLlmStatusNode();
    if (!node) return;
    try {
      const res = await fetch('/api/llm-status');
      if (!res.ok) {
        setLlmStatus(false);
        return;
      }
      const data = await res.json();
      setLlmStatus(!!data.available, data.model || '');
    } catch {
      setLlmStatus(false);
    }
  }

  function normalizeForMatch(value) {
    return (value || '')
      .toLowerCase()
      .replace(/\b(she|her|hers)\b/g, 'nico')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokenize(value) {
    const normalized = normalizeForMatch(value);
    if (!normalized) return [];
    const stopWords = new Set([
      'a', 'an', 'the', 'is', 'are', 'am', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
      'has', 'have', 'had', 'to', 'for', 'of', 'on', 'in', 'at', 'with', 'about', 'what', 'who',
      'where', 'when', 'why', 'how', 'me', 'you', 'your', 'nico'
    ]);
    const stem = (token) => {
      if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
      if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
      if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
      if (token.endsWith('s') && token.length > 4) return token.slice(0, -1);
      return token;
    };
    return normalized
      .split(' ')
      .map(stem)
      .filter((token) => token && !stopWords.has(token));
  }

  function isYesNoQuestion(query) {
    return /^(is|are|am|do|does|did|can|could|should|would|has|have|had)\b/i.test(
      (query || '').trim()
    );
  }

  function ensureYesNoStyle(answer, query) {
    if (!isYesNoQuestion(query)) return answer;
    const trimmed = (answer || '').trim();
    if (!trimmed) return trimmed;
    if (/^(yes|no)\b/i.test(trimmed)) return trimmed;
    const negativeCue = /\b(no|not|never|cannot|can't|doesn't|isn't|aren't|hasn't|haven't|without)\b/i;
    const prefix = negativeCue.test(trimmed) ? 'No,' : 'Yes,';
    return `${prefix} ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
  }

  async function getKnowledgeEntries() {
    if (!knowledgeEntriesPromise) {
      knowledgeEntriesPromise = fetch('search-question-index.json')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => (Array.isArray(data?.entries) ? data.entries : []))
        .catch(() => []);
    }
    return knowledgeEntriesPromise;
  }

  function findKnowledgeMatches(query, entries, limit = 4) {
    const normalizedQuery = normalizeForMatch(query);
    if (!normalizedQuery) return [];
    const exactEntry = entries.find(
      (entry) => normalizeForMatch(entry.question || '') === normalizedQuery
    );
    if (exactEntry) {
      return [
        {
          title: '',
          snippet: exactEntry.answer,
          link: exactEntry.targetUrl || '',
          sourceQuestion: exactEntry.question || ''
        }
      ];
    }

    const queryTokens = tokenize(normalizedQuery);
    const isBroadQuery = queryTokens.length <= 2;
    const scored = entries.map((entry) => {
      const question = normalizeForMatch(entry.question || '');
      const answer = normalizeForMatch(entry.answer || '');
      const tags = normalizeForMatch((entry.tags || []).join(' '));
      const keywordsStr = normalizeForMatch((entry.keywords || []).join(' '));
      const haystack = `${question} ${answer} ${tags} ${keywordsStr}`.trim();
      const questionTokens = new Set(tokenize(question));
      const answerTokens = new Set(tokenize(answer));
      const tagTokens = new Set(tokenize(tags));
      const keywordTokens = new Set(tokenize(keywordsStr));
      if (!haystack) {
        return { entry, score: 0 };
      }

      let score = 0;
      if (question === normalizedQuery) score += 140;
      if (question.includes(normalizedQuery)) score += 80;
      if (normalizedQuery.includes(question)) score += 70;
      if (answer.includes(normalizedQuery)) score += 25;

      queryTokens.forEach((token) => {
        if (!token) return;
        // Owner-declared keywords are strong triggers — one hit guarantees the entry surfaces.
        if (keywordTokens.has(token)) score += 55;
        else if (keywordsStr.includes(token)) score += 35;

        if (question.includes(token)) score += 10;
        else if (answer.includes(token)) score += 4;
        else if (tags.includes(token)) score += 6;

        if (questionTokens.has(token)) score += 8;
        if (answerTokens.has(token)) score += 6;
        if (tagTokens.has(token)) score += 7;
      });

      return { entry, score };
    });

    return scored
      .filter((item) => item.score >= (isBroadQuery ? 18 : 30))
      .sort((a, b) => b.score - a.score)
      .slice(0, 1)
      .map((item) => ({
        title: '',
        snippet: item.entry.answer,
        link: item.entry.targetUrl || '',
        sourceQuestion: item.entry.question || ''
      }));
  }

  function dismissPanel(panel) {
    if (!panel) return;
    panel.hidden = true;
    panel.classList.remove('is-fading-in', 'is-fading-out');
    panel.innerHTML = '';
    panel.remove();
  }

  function getOrCreatePanel() {
    let panel = document.getElementById('searchResults');
    if (panel) return panel;

    const group = document.querySelector('.search-group');
    if (!group) return null;

    panel = document.createElement('div');
    panel.id = 'searchResults';
    panel.className = 'search-results';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-live', 'polite');
    panel.hidden = true;
    group.appendChild(panel);
    return panel;
  }

  function mountPanel(container, bodyNode, dismissible = false) {
    container.innerHTML = '';
    container.hidden = false;

    const body = document.createElement('div');
    body.className = 'search-results-body';
    body.appendChild(bodyNode);

    if (dismissible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-results-dismiss-text';
      btn.setAttribute('aria-label', 'Dismiss search results');
      btn.textContent = 'Dismiss';
      btn.addEventListener('click', () => dismissPanel(container));
      container.appendChild(body);
      const footer = document.createElement('div');
      footer.className = 'search-results-footer';
      footer.appendChild(btn);
      container.appendChild(footer);
      return;
    }

    container.appendChild(body);
  }

  async function transitionPanel(container, renderFn, options = {}) {
    const hasExisting = !container.hidden && container.childElementCount > 0;
    const skipOut = options.skipFadeOut === true;

    if (hasExisting && !skipOut) {
      container.classList.remove('is-fading-in');
      container.classList.add('is-fading-out');
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }

    container.classList.remove('is-fading-out');
    renderFn();
    container.classList.add('is-fading-in');
    window.setTimeout(() => {
      container.classList.remove('is-fading-in');
    }, 220);
  }

  function renderItems(container, items) {
    const ul = document.createElement('ul');
    ul.className = 'search-results-list';
    items.forEach((item) => {
      const li = document.createElement('li');
      li.className = 'search-results-item';

      const destination = (item.link || '').trim();
      const row = destination ? document.createElement('a') : document.createElement('div');
      if (destination) {
        row.href = destination;
        row.target = destination.startsWith('http') ? '_blank' : '_self';
        row.rel = 'noopener noreferrer';
      }
      row.className = destination ? 'search-results-link' : 'search-results-entry';
      if (item.title) {
        const title = document.createElement('div');
        title.className = 'search-results-title';
        title.textContent = item.title;
        row.appendChild(title);
      }
      if (item.snippet) {
        const snip = document.createElement('div');
        snip.className = 'search-results-snippet';
        snip.textContent = item.snippet;
        row.appendChild(snip);
      }
      li.appendChild(row);
      ul.appendChild(li);
    });
    return transitionPanel(container, () => mountPanel(container, ul, true), {
      skipFadeOut: false
    });
  }

  function renderFallback(container) {
    const p = document.createElement('p');
    p.className = 'search-results-fallback';
    const textBefore = document.createTextNode(
      'Looks like your question is questionable. Try '
    );
    const link = document.createElement('a');
    link.href = EMAIL_HREF;
    link.textContent = 'emailing Nico';
    p.appendChild(textBefore);
    p.appendChild(link);
    return transitionPanel(container, () => mountPanel(container, p), {
      skipFadeOut: false
    });
  }

  function renderLoading(container) {
    const p = document.createElement('p');
    p.className = 'search-results-loading';
    p.textContent = 'Searching…';
    return transitionPanel(container, () => mountPanel(container, p), {
      skipFadeOut: true
    });
  }

  let pending = false;

  async function runSearch(rawQuery) {
    const panel = getOrCreatePanel();
    const input = document.querySelector('#searchAboutForm .search-bar-input');
    if (!panel || !input) return;
    const q = rawQuery.trim();
    if (!q) {
      panel.hidden = true;
      panel.innerHTML = '';
      return;
    }

    const knowledgeEntries = await getKnowledgeEntries();
    const localMatches = findKnowledgeMatches(q, knowledgeEntries);
    if (localMatches.length) {
      const primaryMatch = localMatches[0];
      const yesNoBaseAnswer = ensureYesNoStyle(primaryMatch.snippet || '', q);
      primaryMatch.snippet = yesNoBaseAnswer;
      const organicAnswer = await fetchOrganicAnswer(q, yesNoBaseAnswer);
      if (organicAnswer) {
        primaryMatch.snippet = ensureYesNoStyle(organicAnswer, q);
      }
      await renderItems(panel, localMatches);
      return;
    }

    const cfg = window.PORTFOLIO_SEARCH_CONFIG || {};
    if (!cfg.googleApiKey || !cfg.googleCx) {
      await renderFallback(panel);
      return;
    }

    if (pending) return;
    pending = true;
    await renderLoading(panel);

    try {
      const result = await fetchGoogleCustomSearch(q);
      if (!result.ok) {
        await renderFallback(panel);
        return;
      }
      const relevant = (result.items || []).filter(isAboutNico);
      if (relevant.length === 0) {
        await renderFallback(panel);
      } else {
        await renderItems(panel, relevant);
      }
    } catch {
      await renderFallback(panel);
    } finally {
      pending = false;
    }
  }

  function init() {
    const form = document.getElementById('searchAboutForm');
    const searchGroup = document.querySelector('.search-group');
    const input = form?.querySelector('.search-bar-input');
    const inputField = form?.querySelector('.search-bar-field');
    if (!form || !input || !searchGroup || !inputField) return;
    let placeholderIndex = 0;
    let placeholderIntervalId = null;
    let activeHintNode = null;
    let hintTransitioning = false;
    let hintTransitionTimeoutId = null;
    input.placeholder = '';

    const hintCarousel = document.createElement('span');
    hintCarousel.className = 'search-bar-carousel';
    hintCarousel.setAttribute('aria-hidden', 'true');
    inputField.appendChild(hintCarousel);

    const createHintNode = (text, extraClass = '') => {
      const node = document.createElement('span');
      node.className = `search-bar-carousel-item ${extraClass}`.trim();
      node.textContent = text;
      return node;
    };

    const setHintNow = (text) => {
      if (hintTransitionTimeoutId) {
        window.clearTimeout(hintTransitionTimeoutId);
        hintTransitionTimeoutId = null;
      }
      hintTransitioning = false;
      if (activeHintNode) activeHintNode.remove();
      activeHintNode = createHintNode(text, 'is-active');
      hintCarousel.appendChild(activeHintNode);
    };

    const transitionHint = (text) => {
      if (hintTransitioning || !activeHintNode || activeHintNode.textContent === text) return;
      hintTransitioning = true;
      activeHintNode.classList.add('is-fading-out');
      activeHintNode.classList.remove('is-active');
      hintTransitionTimeoutId = window.setTimeout(() => {
        if (!activeHintNode) {
          hintTransitioning = false;
          hintTransitionTimeoutId = null;
          return;
        }
        activeHintNode.textContent = text;
        activeHintNode.classList.remove('is-fading-out');
        activeHintNode.classList.add('is-active');
        hintTransitioning = false;
        hintTransitionTimeoutId = null;
      }, 720);
    };

    const syncHintVisibility = () => {
      const hide = document.activeElement === input || !!input.value.trim();
      hintCarousel.classList.toggle('is-hidden', hide);
    };

    const isInputBusy = () => (
      document.activeElement === input || !!input.value.trim()
    );

    const advancePlaceholder = () => {
      if (isInputBusy()) return;
      transitionHint(ROTATING_PLACEHOLDERS[placeholderIndex]);
      placeholderIndex = (placeholderIndex + 1) % ROTATING_PLACEHOLDERS.length;
    };

    const startPlaceholderRotation = () => {
      if (placeholderIntervalId) return;
      placeholderIntervalId = window.setInterval(advancePlaceholder, 4600);
    };

    const stopPlaceholderRotation = () => {
      if (!placeholderIntervalId) return;
      window.clearInterval(placeholderIntervalId);
      placeholderIntervalId = null;
    };

    setHintNow(DEFAULT_PLACEHOLDER);
    syncHintVisibility();
    startPlaceholderRotation();
    window.setTimeout(advancePlaceholder, 2400);

    const centerSearchInViewport = () => {
      const rect = searchGroup.getBoundingClientRect();
      const targetY = window.scrollY + rect.top - ((window.innerHeight - rect.height) / 2);
      window.scrollTo({
        top: Math.max(0, targetY),
        behavior: 'smooth'
      });
    };

    input.addEventListener('focus', () => {
      centerSearchInViewport();
      stopPlaceholderRotation();
      syncHintVisibility();
    });
    input.addEventListener('blur', () => {
      syncHintVisibility();
      startPlaceholderRotation();
    });
    input.addEventListener('input', () => {
      if (input.value.trim()) {
        stopPlaceholderRotation();
      } else if (document.activeElement !== input) {
        startPlaceholderRotation();
      }
      syncHintVisibility();
    });
    refreshLlmStatus();
    window.setInterval(refreshLlmStatus, 30000);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      runSearch(input.value);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      runSearch(input.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
