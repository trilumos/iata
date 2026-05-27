// widget.js — IATA/ICAO search widget
// No dependencies. Loads search-index.json lazily on first keystroke.

(function() {
  let index = null;
  let loading = false;

  async function loadIndex() {
    if (index) return;
    if (loading) return;
    loading = true;
    try {
      const res = await fetch('/search-index.json');
      index = await res.json();
    } catch(e) {
      console.error('Failed to load search index', e);
    }
    loading = false;
  }

  function search(query, mode) {
    if (!index || !query) return [];
    const q = query.trim().toUpperCase();
    const ql = query.trim().toLowerCase();

    const exact = index.filter(a => {
      if (mode === 'iata' || mode === 'any') if (a.i === q) return true;
      if (mode === 'icao' || mode === 'any') if (a.c === q) return true;
      return false;
    });

    const prefix = index.filter(a => {
      if (exact.includes(a)) return false;
      return a.n.toLowerCase().startsWith(ql) ||
             a.t.toLowerCase().startsWith(ql) ||
             a.i.startsWith(q) ||
             (a.c && a.c.startsWith(q));
    });

    const contains = index.filter(a => {
      if (exact.includes(a) || prefix.includes(a)) return false;
      return a.n.toLowerCase().includes(ql) || a.t.toLowerCase().includes(ql);
    });

    return [...exact, ...prefix, ...contains].slice(0, 10);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderResult(a) {
    return `<a href="/airports/${a.s}" style="display:flex;align-items:center;padding:0.75rem 1rem;border-bottom:1px solid #1e2d47;text-decoration:none;color:#e2e8f0;transition:background 0.1s;" onmouseover="this.style.background='#0f1829'" onmouseout="this.style.background=''">
      <span style="font-family:'Space Mono',monospace;font-weight:700;color:#06b6d4;font-size:1.1rem;width:54px;flex-shrink:0;">${escapeHtml(a.i)}</span>
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-weight:600;font-size:0.88rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.n)}</span>
        <span style="display:block;font-size:0.75rem;color:#94a3b8;">${escapeHtml(a.t)}, ${escapeHtml(a.o)}</span>
      </span>
      <span style="font-family:'Space Mono',monospace;font-size:0.75rem;color:#64748b;margin-left:0.75rem;">${escapeHtml(a.c || '')}</span>
    </a>`;
  }

  function initWidget(inputId, resultsId, mode) {
    mode = mode || 'any';
    const input = document.getElementById(inputId);
    const results = document.getElementById(resultsId);
    if (!input || !results) return;

    input.addEventListener('focus', loadIndex);

    let debounce;
    input.addEventListener('input', function() {
      clearTimeout(debounce);
      debounce = setTimeout(async function() {
        await loadIndex();
        const q = input.value.trim();
        if (q.length < 1) { results.innerHTML = ''; results.hidden = true; return; }
        const hits = search(q, mode);
        if (!hits.length) {
          results.innerHTML = '<p style="padding:0.75rem 1rem;font-size:0.85rem;color:#94a3b8;">No airports found.</p>';
        } else {
          results.innerHTML = hits.map(renderResult).join('');
        }
        results.hidden = false;
      }, 150);
    });

    document.addEventListener('click', function(e) {
      if (!results.contains(e.target) && e.target !== input) {
        results.hidden = true;
      }
    });

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') { results.hidden = true; input.blur(); }
    });
  }

  window.AirportSearch = { init: initWidget };
})();
