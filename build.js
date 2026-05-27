// build.js — Master build script for IATA Airport Codes site
// Data source: OurAirports (updated regularly, ~9000 airports with IATA codes)
// Run: node build.js

const https = require('https');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// ---- Config ----
const BASE_URL = 'https://iatacode.pages.dev';
const DIST = './dist';

const AIRPORTS_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv';
const COUNTRIES_URL = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/countries.csv';
const AIRPORTS_PATH = './data/airports.csv';
const COUNTRIES_PATH = './data/countries.csv';

const POPULAR_IATA = ['JFK','LHR','CDG','DXB','LAX','SIN','HKG','SYD','NRT','FRA',
                      'ORD','AMS','ICN','PEK','DFW','MIA','BKK','DEL','MUC','ZRH'];

// ---- Fetch helpers ----
async function fetchFile(url, localPath) {
  if (fs.existsSync(localPath)) {
    console.log(`Using cached ${path.basename(localPath)}`);
    return;
  }
  fs.mkdirSync('./data', { recursive: true });
  console.log(`Fetching ${path.basename(localPath)}...`);
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(localPath);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

// ---- Slug ----
function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

// ---- Load countries lookup (iso_code -> full name) ----
function loadCountries() {
  const raw = fs.readFileSync(COUNTRIES_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true });
  const map = {};
  for (const r of records) {
    map[r.code.trim()] = r.name.trim();
  }
  return map;
}

// ---- Load & parse airports ----
function loadAirports(countryMap) {
  const raw = fs.readFileSync(AIRPORTS_PATH, 'utf8');
  const records = parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true });

  return records
    // Must have a valid 3-letter IATA code
    .filter(r => r.iata_code && /^[A-Z]{3}$/.test(r.iata_code.trim()))
    // Only real airports (exclude heliports, seaplane bases, closed)
    .filter(r => ['large_airport','medium_airport','small_airport'].includes(r.type))
    // Must not be closed
    .filter(r => r.type !== 'closed')
    .map(r => {
      const iata = r.iata_code.trim().toUpperCase();
      const icao = (r.icao_code || '').trim().toUpperCase();
      const country = countryMap[r.iso_country.trim()] || r.iso_country.trim();
      const city = (r.municipality || '').trim();
      const lat = parseFloat(r.latitude_deg) || 0;
      const lon = parseFloat(r.longitude_deg) || 0;

      return {
        iata,
        icao: icao || '',
        name: r.name.trim(),
        city,
        country,
        iso_country: r.iso_country.trim(),
        iso_region: r.iso_region.trim(),
        type: r.type,
        scheduled: r.scheduled_service === 'yes',
        lat,
        lon,
        altitude: parseInt(r.elevation_ft) || 0,
        // OurAirports doesn't have tz/dst — derive from region or leave blank
        tz_name: '',
        tz_offset: '',
        dst: '',
        slug: iata.toLowerCase(),
        countrySlug: slugify(country),
        citySlug: slugify((city || 'unknown') + '-' + country),
      };
    })
    // Remove null island
    .filter(a => Math.abs(a.lat) > 0.01 || Math.abs(a.lon) > 0.01);
}

// ---- Deduplication (keep scheduled service over non-scheduled; else keep larger type) ----
const TYPE_RANK = { large_airport: 3, medium_airport: 2, small_airport: 1 };

function deduplicateByIATA(airports) {
  const map = {};
  for (const a of airports) {
    if (!map[a.iata]) {
      map[a.iata] = a;
    } else {
      const existing = map[a.iata];
      const betterType = (TYPE_RANK[a.type] || 0) > (TYPE_RANK[existing.type] || 0);
      const betterScheduled = a.scheduled && !existing.scheduled;
      if (betterScheduled || (!existing.scheduled && betterType)) {
        map[a.iata] = a;
      }
    }
  }
  return map;
}

// ---- Haversine ----
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getNearby(airport, allAirports, n = 5) {
  return allAirports
    .filter(a => a.iata !== airport.iata)
    .map(a => ({ ...a, dist: haversineKm(airport.lat, airport.lon, a.lat, a.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n);
}

// ---- HTML helpers ----
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJson(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function formatTzOffset(offset) {
  const n = parseFloat(offset);
  if (isNaN(n)) return '';
  return n >= 0 ? `+${n}` : `${n}`;
}

function dstDescription(dst) {
  const map = { E:'European', A:'US/Canadian', S:'South American',
                O:'Australian', Z:'New Zealand', N:'no', U:'unknown' };
  return map[dst] || 'standard';
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

function renderTemplate(templatePath, vars) {
  let html = fs.readFileSync(templatePath, 'utf8');
  for (const [key, value] of Object.entries(vars)) {
    html = html.split(`{{${key}}}`).join(value ?? '');
  }
  return html;
}

// ---- Airport page ----
function renderNearbyCards(nearby) {
  return nearby.map(n => `
    <a href="/airports/${n.slug}" class="nearby-card">
      <div class="nearby-iata">${escapeHtml(n.iata)}</div>
      <div class="nearby-name">${escapeHtml(n.name.substring(0, 24))}</div>
      <div class="nearby-dist">${Math.round(n.dist)} km</div>
    </a>`).join('');
}

function generateAirportPage(airport) {
  const altM = Math.round(airport.altitude * 0.3048);
  const icaoOrNa = airport.icao || 'N/A';
  const icaoSentence = airport.icao
    ? `, and its ICAO code is <strong>${escapeHtml(airport.icao)}</strong>`
    : '';
  const nearbyProse = airport.nearby.map(n =>
    `<a href="/airports/${n.slug}">${escapeHtml(n.name)} (${n.iata})</a>`
  ).join(', ');

  const vars = {
    NAME: escapeHtml(airport.name),
    NAME_JSON: escapeJson(airport.name),
    IATA: airport.iata,
    IATA_LOWER: airport.slug,
    ICAO: icaoOrNa,
    ICAO_OR_NA: icaoOrNa,
    ICAO_SENTENCE: icaoSentence,
    CITY: escapeHtml(airport.city),
    CITY_JSON: escapeJson(airport.city),
    COUNTRY: escapeHtml(airport.country),
    COUNTRY_JSON: escapeJson(airport.country),
    CITY_SLUG: airport.citySlug,
    COUNTRY_SLUG: airport.countrySlug,
    LAT: airport.lat.toFixed(6),
    LON: airport.lon.toFixed(6),
    ALTITUDE: airport.altitude,
    ALTITUDE_M: altM,
    TZ_NAME: airport.tz_name || 'N/A',
    TZ_OFFSET: airport.tz_offset ? formatTzOffset(airport.tz_offset) : 'N/A',
    DST_DESC: dstDescription(airport.dst),
    NEARBY_CARDS: renderNearbyCards(airport.nearby),
    NEARBY_LIST_PROSE: nearbyProse,
    BASE_URL,
  };
  const html = renderTemplate('./templates/airport.html', vars);
  fs.writeFileSync(path.join(DIST, 'airports', `${airport.slug}.html`), html);
}

// ---- Country page ----
function generateCountryPage(slug, airports) {
  const country = airports[0].country;
  const sorted = [...airports].sort((a, b) => a.name.localeCompare(b.name));

  const tableRows = sorted.map((a, i) => {
    const mid = i === 10
      ? `<tr><td colspan="4" style="padding:0.5rem 0;"><div class="ad-slot" style="margin:0;"><!-- ADSENSE_MID_TABLE --></div></td></tr>`
      : '';
    return `${mid}<tr>
      <td><a href="/airports/${a.slug}">${escapeHtml(a.name)}</a></td>
      <td class="iata-code">${a.iata}</td>
      <td class="icao-code">${a.icao || '—'}</td>
      <td class="hide-mobile">${escapeHtml(a.city)}</td>
    </tr>`;
  }).join('');

  const listItems = sorted.slice(0, 100).map((a, i) => `{
      "@type": "ListItem",
      "position": ${i + 1},
      "name": "${escapeJson(a.name)} (${a.iata})",
      "url": "${BASE_URL}/airports/${a.slug}"
    }`).join(',\n');

  const jsonLd = `{
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": "Airports in ${escapeJson(country)}",
    "numberOfItems": ${sorted.length},
    "itemListElement": [${listItems}]
  }`;

  const html = renderTemplate('./templates/country.html', {
    COUNTRY: escapeHtml(country),
    COUNTRY_SLUG: slug,
    COUNT: sorted.length,
    TABLE_ROWS: tableRows,
    JSON_LD: jsonLd,
  });
  fs.writeFileSync(path.join(DIST, 'country', `${slug}.html`), html);
}

// ---- City page ----
function generateCityPage(slug, airports) {
  const city = airports[0].city;
  const country = airports[0].country;
  const countrySlug = airports[0].countrySlug;
  const sorted = [...airports].sort((a, b) => a.name.localeCompare(b.name));

  const cards = sorted.map(a => `
    <a href="/airports/${a.slug}" class="airport-card">
      <div class="card-iata">${a.iata}</div>
      <div class="card-name">${escapeHtml(a.name)}</div>
      <div class="card-icao">${a.icao || 'No ICAO'}</div>
    </a>`).join('');

  const html = renderTemplate('./templates/city.html', {
    CITY: escapeHtml(city),
    COUNTRY: escapeHtml(country),
    COUNTRY_SLUG: countrySlug,
    CITY_SLUG: slug,
    COUNT: sorted.length,
    AIRPORT_CARDS: cards,
  });
  fs.writeFileSync(path.join(DIST, 'city', `${slug}.html`), html);
}

// ---- Converter pages ----
function generateConverterPage(type, airports) {
  const isIataToIcao = type === 'iata-to-icao';
  const title = isIataToIcao
    ? 'IATA to ICAO Airport Code Converter'
    : 'ICAO to IATA Airport Code Converter';
  const desc = isIataToIcao
    ? 'Convert any IATA airport code to its ICAO equivalent instantly. Free lookup tool with all 9,000+ airports.'
    : 'Convert any ICAO airport code to its IATA equivalent instantly. Free lookup tool with all 9,000+ airports.';
  const placeholder = isIataToIcao
    ? 'Enter IATA code (e.g. JFK)...'
    : 'Enter ICAO code (e.g. KJFK)...';

  const withIcao = airports.filter(a => a.icao);
  const sorted = [...withIcao].sort((a, b) => a.iata.localeCompare(b.iata)).slice(0, 50);

  const tableRows = sorted.map(a => `<tr>
    <td><a href="/airports/${a.slug}">${escapeHtml(a.name)}</a></td>
    <td class="iata-col">${a.iata}</td>
    <td class="icao-col">${a.icao}</td>
    <td>${escapeHtml(a.city)}</td>
  </tr>`).join('');

  const html = renderTemplate('./templates/converter.html', {
    PAGE_TITLE: title,
    PAGE_DESC: desc,
    PAGE_SLUG: type,
    SEARCH_PLACEHOLDER: placeholder,
    SEARCH_MODE: isIataToIcao ? 'iata' : 'icao',
    TABLE_ROWS: tableRows,
  });

  const outDir = path.join(DIST, type);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
}

// ---- Homepage ----
function generateHomepage(airports, byCountry, byCity) {
  const airportMap = Object.fromEntries(airports.map(a => [a.iata, a]));

  const popularCards = POPULAR_IATA
    .filter(code => airportMap[code])
    .map(code => {
      const a = airportMap[code];
      return `<a href="/airports/${a.slug}" class="pop-card">
        <div class="pop-iata">${a.iata}</div>
        <div class="pop-city">${escapeHtml(a.city)}</div>
      </a>`;
    }).join('');

  const countriesSorted = Object.entries(byCountry)
    .sort((a, b) => a[1][0].country.localeCompare(b[1][0].country));

  const countryLinks = countriesSorted.map(([slug, aps]) =>
    `<a href="/country/${slug}">${escapeHtml(aps[0].country)} <span style="color:#1e2d47">(${aps.length})</span></a>`
  ).join('');

  const html = renderTemplate('./templates/index.html', {
    AIRPORT_COUNT: airports.length.toLocaleString(),
    COUNTRY_COUNT: Object.keys(byCountry).length.toLocaleString(),
    CITY_COUNT: Object.keys(byCity).length.toLocaleString(),
    POPULAR_CARDS: popularCards,
    COUNTRY_LINKS: countryLinks,
  });

  fs.writeFileSync(path.join(DIST, 'index.html'), html);
}

// ---- Search index ----
function generateSearchIndex(airports) {
  const index = airports.map(a => ({
    i: a.iata,
    c: a.icao || '',
    n: a.name,
    t: a.city,
    o: a.country,
    s: a.slug,
  }));
  const json = JSON.stringify(index);
  fs.writeFileSync(path.join(DIST, 'search-index.json'), json);
  console.log(`Search index: ${index.length} entries, ${Math.round(json.length / 1024)}KB`);
}

// ---- Sitemap ----
function generateSitemap(airports, byCountry, byCity) {
  const now = new Date().toISOString().split('T')[0];
  const urls = [];

  urls.push(`<url><loc>${BASE_URL}/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>`);
  urls.push(`<url><loc>${BASE_URL}/iata-to-icao/</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`);
  urls.push(`<url><loc>${BASE_URL}/icao-to-iata/</loc><changefreq>monthly</changefreq><priority>0.8</priority></url>`);

  for (const a of airports) {
    urls.push(`<url><loc>${BASE_URL}/airports/${a.slug}</loc><lastmod>${now}</lastmod><changefreq>yearly</changefreq><priority>0.6</priority></url>`);
  }
  for (const slug of Object.keys(byCountry)) {
    urls.push(`<url><loc>${BASE_URL}/country/${slug}</loc><lastmod>${now}</lastmod><changefreq>yearly</changefreq><priority>0.7</priority></url>`);
  }
  for (const slug of Object.keys(byCity)) {
    urls.push(`<url><loc>${BASE_URL}/city/${slug}</loc><lastmod>${now}</lastmod><changefreq>yearly</changefreq><priority>0.6</priority></url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);
  console.log(`Sitemap: ${urls.length} URLs`);
}

// ---- robots.txt ----
function generateRobotsTxt() {
  fs.writeFileSync(path.join(DIST, 'robots.txt'),
`User-agent: *
Allow: /
Sitemap: ${BASE_URL}/sitemap.xml
`);
}

// ---- _redirects ----
function generateRedirects() {
  fs.writeFileSync(path.join(DIST, '_redirects'),
`/* /404.html 404
`);
}

// ---- _headers ----
function generateHeaders() {
  fs.writeFileSync('./_headers',
`/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Cache-Control: public, max-age=86400

/sitemap.xml
  Content-Type: application/xml; charset=UTF-8

/search-index.json
  Cache-Control: public, max-age=604800
  Access-Control-Allow-Origin: *
`);
}

// ---- 404 page ----
function generate404() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Page Not Found · IATA Codes</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
  <style>
    :root{--navy:#0a0e1a;--cyan:#06b6d4;--text:#e2e8f0;--text-dim:#94a3b8;--mono:'Space Mono',monospace;--sans:'DM Sans',sans-serif;}
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:var(--navy);color:var(--text);font-family:var(--sans);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2rem;}
    .code{font-family:var(--mono);font-size:5rem;font-weight:700;color:var(--cyan);line-height:1;}
    h1{font-size:1.5rem;margin:1rem 0 0.5rem;}
    p{color:var(--text-dim);margin-bottom:2rem;}
    a{color:var(--cyan);text-decoration:none;}
    a:hover{text-decoration:underline;}
  </style>
</head>
<body>
  <div class="code">404</div>
  <h1>Page Not Found</h1>
  <p>That airport code or page doesn't exist in our database.</p>
  <a href="/">← Back to IATA Code Lookup</a>
</body>
</html>`;
  fs.writeFileSync(path.join(DIST, '404.html'), html);
}

// ---- Copy statics ----
function copyStatics() {
  if (fs.existsSync('./static/widget.js'))
    fs.copyFileSync('./static/widget.js', path.join(DIST, 'widget.js'));
}

// ---- Main ----
async function main() {
  console.time('build');

  await fetchFile(AIRPORTS_URL, AIRPORTS_PATH);
  await fetchFile(COUNTRIES_URL, COUNTRIES_PATH);

  const countryMap = loadCountries();
  console.log(`Loaded ${Object.keys(countryMap).length} country names`);

  const airports = loadAirports(countryMap);
  console.log(`Loaded ${airports.length} valid airports`);

  const airportMap = deduplicateByIATA(airports);
  const airportList = Object.values(airportMap);
  console.log(`After dedup: ${airportList.length} airports`);

  console.log('Computing nearby airports...');
  airportList.forEach(a => { a.nearby = getNearby(a, airportList, 5); });

  const byCountry = groupBy(airportList, 'countrySlug');
  const byCity = groupBy(airportList, 'citySlug');

  // Clean & create output dirs
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  ['airports','country','city'].forEach(d =>
    fs.mkdirSync(path.join(DIST, d), { recursive: true })
  );

  console.log('Generating airport pages...');
  let count = 0;
  for (const airport of airportList) {
    generateAirportPage(airport);
    if (++count % 1000 === 0) console.log(`  ${count}/${airportList.length}`);
  }

  console.log('Generating country pages...');
  for (const [slug, aps] of Object.entries(byCountry)) generateCountryPage(slug, aps);

  console.log('Generating city pages...');
  for (const [slug, aps] of Object.entries(byCity)) generateCityPage(slug, aps);

  generateConverterPage('iata-to-icao', airportList);
  generateConverterPage('icao-to-iata', airportList);
  generateHomepage(airportList, byCountry, byCity);
  generateSearchIndex(airportList);
  generateSitemap(airportList, byCountry, byCity);
  generateRobotsTxt();
  generateRedirects();
  generateHeaders();
  generate404();
  copyStatics();

  console.timeEnd('build');
  console.log(`\n✓ ${airportList.length} airport pages`);
  console.log(`✓ ${Object.keys(byCountry).length} countries`);
  console.log(`✓ ${Object.keys(byCity).length} cities`);

  const countFiles = (dir) => {
    let n = 0;
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isDirectory()) n += countFiles(path.join(dir, f.name));
      else n++;
    }
    return n;
  };
  console.log(`✓ ${countFiles(DIST)} total files in dist/`);
}

main().catch(err => { console.error(err); process.exit(1); });
