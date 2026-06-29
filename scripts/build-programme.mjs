#!/usr/bin/env node
// Build statique de la page programme.
//
// Va chercher les activités dans la base Notion « Programmation festival »,
// les trie par ordre chronologique et écrit un fichier programme.html
// entièrement statique (cartes pré-rendues, aucune requête au runtime).
//
// Usage :
//   NOTION_TOKEN=ntn_xxx node scripts/build-programme.mjs
//   (à défaut, le token est lu depuis le fichier .dev.vars à la racine)
//
// À relancer quand le programme change dans Notion, puis committer programme.html.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const DB_ID = "36586e57-ca1b-80ee-be93-ee2d105187d3"; // « Programmation festival »

function token() {
  if (process.env.NOTION_TOKEN) return process.env.NOTION_TOKEN.trim();
  try {
    const m = readFileSync(join(ROOT, ".dev.vars"), "utf8").match(/NOTION_TOKEN\s*=\s*"?([^"\n]+)"?/);
    if (m) return m[1].trim();
  } catch {}
  console.error("✗ NOTION_TOKEN introuvable (variable d'env ou fichier .dev.vars).");
  process.exit(1);
}

const TOKEN = token();
const headers = { Authorization: `Bearer ${TOKEN}`, "Notion-Version": NOTION_VERSION };

// --- Récupération des fiches (pagination) ---
async function fetchRows() {
  const rows = [];
  let cursor;
  do {
    const res = await fetch(`${NOTION_API}/databases/${DB_ID}/query`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion: ${data.message || data.code || res.status}`);
    rows.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return rows;
}

// --- Extraction des propriétés ---
const title = (p) => (p?.title || []).map((t) => t.plain_text).join("");
const richText = (p) => (p?.rich_text || []).map((t) => t.plain_text).join("");
const selectName = (p) => p?.select?.name || "";
const multiNames = (p) => (p?.multi_select || []).map((s) => s.name);

function mapRow(row) {
  const p = row.properties || {};
  const date = p["Date"]?.date || null;
  let intervenants = multiNames(p["Intervenant·es validé·es"]);
  if (!intervenants.length) intervenants = multiNames(p["Facilitateur·ice validé·e"]);
  if (!intervenants.length) {
    const txt = richText(p["Intervenant·es"]);
    if (txt) intervenants = [txt];
  }
  return {
    id: row.id,
    titre: title(p["Activités"]).trim(),
    espace: selectName(p["Espace"]),
    jauge: selectName(p["Jauge"]),
    intervenants,
    description: richText(p["description"]).trim() || richText(p["Description"]).trim(),
    sources: cleanSources(p["sources"]),
    start: date?.start || null,
    end: date?.end || null,
  };
}

// Les champs « sources » sont souvent des gabarits vides « site :   insta : ».
// On ne garde que les liens réellement présents.
function cleanSources(p) {
  const segs = p?.rich_text || [];
  const links = [];
  for (const s of segs) {
    const href = s.href || s.text?.link?.url;
    if (href) links.push({ label: (s.plain_text || href).trim() || href, href });
  }
  return links;
}

// --- Formatage / regroupement par jour (fuseau Europe/Paris) ---
const fmtDay = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
});
const fmtTime = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris",
});
const fmtKey = new Intl.DateTimeFormat("fr-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Paris",
});
const fmtShort = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric", month: "long", timeZone: "Europe/Paris",
});
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const hhmm = (d) => fmtTime.format(d).replace(":", "h");
// « mercredi 1 juillet » → « Mercredi 1er juillet »
const dayLabel = (d) => cap(fmtDay.format(d)).replace(/\b1 /, "1er ");
// Libellé court pour l'onglet : « 29 juin », « 1er juillet »
const shortLabel = (d) => fmtShort.format(d).replace(/^1 /, "1er ");
const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function renderCard(a) {
  const start = new Date(a.start);
  const end = a.end ? new Date(a.end) : null;
  const horaire = end ? `${hhmm(start)} – ${hhmm(end)}` : hhmm(start);

  const isConcert = /concert/i.test(a.titre || "");
  let h = `        <article class="card${isConcert ? " concert" : ""}" data-id="${esc(a.id)}">\n`;
  h += '          <button class="like" type="button" aria-pressed="false" aria-label="Ajouter à mes favoris">\n';
  h += '            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>\n';
  h += "          </button>\n";
  h += '          <div class="card-head">\n';
  h += `            <span class="time">${esc(horaire)}</span>\n`;
  h += `            <span class="card-title">${esc(a.titre || "Activité")}</span>\n`;
  h += "          </div>\n";

  if (a.espace || a.jauge) {
    h += '          <div class="badges">\n';
    if (a.espace) h += `            <span class="badge espace">${esc(a.espace)}</span>\n`;
    if (a.jauge) h += `            <span class="badge jauge">Jauge : ${esc(a.jauge)}</span>\n`;
    h += "          </div>\n";
  }
  if (a.intervenants.length) {
    h += `          <p class="intervenants"><b>Avec</b> ${esc(a.intervenants.join(", "))}</p>\n`;
  }
  if (a.description) {
    h += `          <p class="desc">${esc(a.description)}</p>\n`;
  }
  if (a.sources.length) {
    const links = a.sources
      .map((l) => `<a href="${esc(l.href)}" target="_blank" rel="noopener">${esc(l.label)}</a>`)
      .join(" · ");
    h += `          <p class="source">${links}</p>\n`;
  }
  h += "        </article>\n";
  return h;
}

function groupByDay(activities) {
  const groups = [];
  let cur = null;
  for (const a of activities) {
    const start = new Date(a.start);
    const key = fmtKey.format(start);
    if (!cur || cur.key !== key) {
      cur = { key, label: dayLabel(start), short: shortLabel(start), cards: [] };
      groups.push(cur);
    }
    cur.cards.push(a);
  }
  return groups;
}

function renderBody(activities) {
  if (!activities.length) {
    return '        <div class="state">Le programme sera bientôt disponible.</div>\n';
  }
  const groups = groupByDay(activities);

  // Barre d'onglets (un par jour)
  let tabs = '        <div class="tabs" role="tablist" aria-label="Jours du festival">\n';
  groups.forEach((g, i) => {
    tabs += `          <button class="tab${i === 0 ? " active" : ""}" role="tab" type="button"` +
      ` data-day="${g.key}" aria-selected="${i === 0 ? "true" : "false"}">${esc(g.short)}</button>\n`;
  });
  tabs += "        </div>\n";

  // Panneaux (contenu du jour sous les onglets)
  let panels = "";
  groups.forEach((g, i) => {
    panels += `        <section class="panel${i === 0 ? " active" : ""}" role="tabpanel"` +
      ` data-day="${g.key}" aria-label="${esc(g.label)}">\n`;
    panels += `          <h2 class="day">${esc(g.label)}</h2>\n`;
    for (const a of g.cards) panels += renderCard(a);
    panels += "        </section>\n";
  });

  return tabs + panels;
}

function page(body, count, stamp) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <title>Programme — Festival Déclic</title>
    <meta name="theme-color" content="#3DA9E0">
    <meta name="description" content="Programme du Festival Déclic 2026 — ${count} activités.">
    <!-- Page générée par scripts/build-programme.mjs — ne pas éditer à la main. -->
    <!-- Dernière génération : ${stamp} -->
    <link rel="preload" href="/fonts/Folsom-Black.otf" as="font" type="font/otf" crossorigin>
    <link rel="preload" href="/assets/illu-cover.jpg" as="image">
    <style>
        @font-face {
            font-family: 'Folsom';
            src: url('/fonts/Folsom-Black.otf') format('opentype');
            font-display: swap;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        html, body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #111;
        }

        body {
            min-height: 100vh;
            min-height: 100dvh;
            background: #3DA9E0 url('/assets/illu-cover.jpg') center / cover no-repeat fixed;
            padding: calc(56px + env(safe-area-inset-top)) clamp(10px, 3vw, 24px)
                     calc(24px + env(safe-area-inset-bottom));
        }

        .back {
            position: fixed;
            top: calc(8px + env(safe-area-inset-top));
            left: 10px;
            z-index: 20;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            color: #111;
            text-decoration: none;
        }

        .back svg { width: 26px; height: 26px; display: block; }

        .wrap { max-width: 760px; margin: 0 auto; }

        .page-title {
            font-family: 'Folsom', Impact, sans-serif;
            text-transform: uppercase;
            font-size: clamp(2.4rem, 9vw, 4rem);
            line-height: 0.9;
            color: #111;
            margin: 0.2rem 0 1.4rem;
        }

        .state {
            background: rgba(255, 255, 255, 0.85);
            border-radius: 16px;
            padding: 1.5rem;
            text-align: center;
            font-size: 1rem;
            color: #333;
        }

        .tabs {
            display: flex;
            gap: 0.5rem;
            flex-wrap: wrap;
            margin-bottom: 1.3rem;
        }

        .tab {
            font-family: 'Folsom', Impact, sans-serif;
            text-transform: uppercase;
            font-size: clamp(1rem, 4.2vw, 1.5rem);
            line-height: 1;
            padding: 0.4em 0.85em;
            border: 0;
            border-radius: 999px;
            cursor: pointer;
            background: rgba(255, 255, 255, 0.7);
            color: #111;
            transition: background 0.2s, transform 0.1s;
        }

        .tab:hover { background: rgba(255, 255, 255, 0.92); }
        .tab.active { background: #F47B97; color: #111; }
        .tab:active { transform: scale(0.97); }

        .panel { display: none; }
        .panel.active { display: block; }

        .day {
            font-family: 'Folsom', Impact, sans-serif;
            text-transform: uppercase;
            font-size: clamp(1.4rem, 5vw, 2rem);
            color: #111;
            margin: 0 0 0.9rem;
        }

        .card {
            position: relative;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(2px);
            border-radius: 16px;
            padding: 1rem 1.15rem;
            margin-bottom: 0.7rem;
            box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
            transition: background 0.2s;
        }

        .card.concert { background: #FBD9A0; }
        .card.concert .time { color: #B5530A; }
        .card.liked { background: #F9CEDA; }

        .like {
            position: absolute;
            top: 0.7rem;
            right: 0.7rem;
            width: 36px;
            height: 36px;
            padding: 5px;
            border: 0;
            background: transparent;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        }

        .like svg {
            width: 100%;
            height: 100%;
            display: block;
            fill: none;
            stroke: #E23E6A;
            stroke-width: 1.8;
            transition: fill 0.15s, transform 0.1s;
        }

        .like:hover svg { fill: rgba(226, 62, 106, 0.18); }
        .like:active svg { transform: scale(0.85); }
        .card.liked .like svg { fill: #E23E6A; stroke: #E23E6A; }

        .card-head {
            display: flex;
            align-items: baseline;
            gap: 0.6rem;
            flex-wrap: wrap;
            padding-right: 2.4rem;
        }

        .time {
            font-weight: 800;
            font-size: 1.05rem;
            color: #111;
            font-variant-numeric: tabular-nums;
            white-space: nowrap;
        }

        .card-title {
            font-weight: 700;
            font-size: 1.1rem;
            line-height: 1.2;
            flex: 1 1 auto;
        }

        .badges { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.55rem; }

        .badge {
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            padding: 0.25em 0.7em;
            border-radius: 999px;
            white-space: nowrap;
        }

        .badge.espace { background: #3DA9E0; color: #fff; }
        .badge.jauge { background: #8FCB8F; color: #0d2a0d; }

        .intervenants { margin-top: 0.55rem; font-size: 0.92rem; color: #333; }
        .intervenants b { color: #111; }

        .desc {
            margin-top: 0.55rem;
            font-size: 0.95rem;
            line-height: 1.45;
            color: #222;
            white-space: pre-line;
        }

        .source { margin-top: 0.65rem; font-size: 0.85rem; }
        .source a { font-weight: 700; color: #1f6aa5; text-decoration: none; }
        .source a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <a class="back" href="/" aria-label="Retour à l'accueil">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
    </a>

    <div class="wrap">
        <h1 class="page-title">Programme</h1>
${body}    </div>

    <script>
        (function () {
            var tabs = [].slice.call(document.querySelectorAll(".tab"));
            var panels = [].slice.call(document.querySelectorAll(".panel"));
            if (!tabs.length) return;

            function activate(key) {
                tabs.forEach(function (t) {
                    var on = t.dataset.day === key;
                    t.classList.toggle("active", on);
                    t.setAttribute("aria-selected", on ? "true" : "false");
                });
                panels.forEach(function (p) {
                    p.classList.toggle("active", p.dataset.day === key);
                });
            }

            tabs.forEach(function (t) {
                t.addEventListener("click", function () { activate(t.dataset.day); });
            });

            // Onglet ouvert par défaut : le jour courant (fuseau Europe/Paris),
            // sinon le premier jour du festival.
            var today = new Intl.DateTimeFormat("fr-CA", {
                timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
            }).format(new Date());
            var hasToday = tabs.some(function (t) { return t.dataset.day === today; });
            activate(hasToday ? today : tabs[0].dataset.day);
        })();

        // --- Favoris : likés mémorisés en localStorage par id Notion ---
        (function () {
            var KEY = "declic:favoris";
            var set;
            try {
                var saved = JSON.parse(localStorage.getItem(KEY));
                set = new Set(Array.isArray(saved) ? saved : []);
            } catch (e) {
                set = new Set();
            }

            function save() {
                try { localStorage.setItem(KEY, JSON.stringify([].slice.call(set))); } catch (e) {}
            }

            [].slice.call(document.querySelectorAll(".card")).forEach(function (card) {
                var id = card.dataset.id;
                var btn = card.querySelector(".like");
                if (!id || !btn) return;

                function sync() {
                    var on = set.has(id);
                    card.classList.toggle("liked", on);
                    btn.setAttribute("aria-pressed", on ? "true" : "false");
                    btn.setAttribute("aria-label", on ? "Retirer de mes favoris" : "Ajouter à mes favoris");
                }

                btn.addEventListener("click", function () {
                    if (set.has(id)) set.delete(id); else set.add(id);
                    save();
                    sync();
                });

                sync();
            });
        })();
    </script>
</body>
</html>
`;
}

// --- Exécution ---
const rows = await fetchRows();
const activities = rows
  .map(mapRow)
  .filter((a) => a.start && a.titre)
  .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

const stamp = new Date().toISOString();
writeFileSync(join(ROOT, "programme.html"), page(renderBody(activities), activities.length, stamp));
console.log(`✓ programme.html généré — ${activities.length} activités (sur ${rows.length} fiches).`);
