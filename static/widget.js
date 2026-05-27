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

  function slugify(str) {
    return String(str)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  // Find unique countries that match the query
  function matchingCountries(ql) {
    if (!index || ql.length < 2) return [];
    const seen = new Set();
    const results = [];
    for (const a of index) {
      const country = a.o.toLowerCase();
      if (country.startsWith(ql) || country.includes(ql)) {
        if (!seen.has(a.o)) {
          seen.add(a.o);
          // Count airports in this country
          const count = index.filter(x => x.o === a.o).length;
          results.push({ name: a.o, slug: slugify(a.o), count });
        }
      }
    }
    // Sort: starts-with first, then contains
    results.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(ql);
      const bStarts = b.name.toLowerCase().startsWith(ql);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    });
    return results.slice(0, 3);
  }

  function search(query, mode) {
    if (!index || !query) return { airports: [], countries: [] };
    const q = query.trim().toUpperCase();
    const ql = query.trim().toLowerCase();

    // --- Airport matches ---
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
      return a.n.toLowerCase().includes(ql) ||
             a.t.toLowerCase().includes(ql) ||
             a.o.toLowerCase().includes(ql);
    });

    const airports = [...exact, ...prefix, ...contains].slice(0, 8);

    // --- Country matches (only in 'any' mode) ---
    const countries = mode === 'any' ? matchingCountries(ql) : [];

    return { airports, countries };
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderAirport(a) {
    return `<a href="/airports/${a.s}" style="display:flex;align-items:center;padding:0.7rem 1rem;border-bottom:1px solid #1e2d47;text-decoration:none;color:#e2e8f0;transition:background 0.1s;" onmouseover="this.style.background='#0f1829'" onmouseout="this.style.background=''">
      <span style="font-family:'Space Mono',monospace;font-weight:700;color:#06b6d4;font-size:1.05rem;width:52px;flex-shrink:0;">${escapeHtml(a.i)}</span>
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-weight:600;font-size:0.87rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(a.n)}</span>
        <span style="display:block;font-size:0.74rem;color:#94a3b8;">${escapeHtml(a.t)}, ${escapeHtml(a.o)}</span>
      </span>
      <span style="font-family:'Space Mono',monospace;font-size:0.72rem;color:#64748b;margin-left:0.75rem;flex-shrink:0;">${escapeHtml(a.c || '')}</span>
    </a>`;
  }

  function renderCountry(c) {
    return `<a href="/country/${c.slug}" style="display:flex;align-items:center;padding:0.7rem 1rem;border-bottom:1px solid #1e2d47;text-decoration:none;color:#e2e8f0;transition:background 0.1s;" onmouseover="this.style.background='#0f1829'" onmouseout="this.style.background=''">
      <span style="font-size:1rem;width:52px;flex-shrink:0;color:#f59e0b;">🌍</span>
      <span style="flex:1;min-width:0;">
        <span style="display:block;font-weight:600;font-size:0.87rem;">${escapeHtml(c.name)}</span>
        <span style="display:block;font-size:0.74rem;color:#94a3b8;">View all ${c.count} airports →</span>
      </span>
    </a>`;
  }

  function renderSectionLabel(label) {
    return `<div style="padding:0.35rem 1rem;font-size:0.68rem;font-family:'Space Mono',monospace;letter-spacing:0.1em;text-transform:uppercase;color:#475569;background:#0a0e1a;border-bottom:1px solid #1e2d47;">${label}</div>`;
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

        const { airports, countries } = search(q, mode);

        if (!airports.length && !countries.length) {
          results.innerHTML = '<p style="padding:0.75rem 1rem;font-size:0.85rem;color:#94a3b8;">No airports or countries found.</p>';
          results.hidden = false;
          return;
        }

        let html = '';

        // Show country section first if it's a strong country match
        if (countries.length) {
          html += renderSectionLabel('Countries');
          html += countries.map(renderCountry).join('');
        }

        if (airports.length) {
          if (countries.length) html += renderSectionLabel('Airports');
          html += airports.map(renderAirport).join('');
        }

        results.innerHTML = html;
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
