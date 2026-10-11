const cfg = window.SUPABASE_CONFIG;
let currentRange = 30;
let currentView = "summary";
let charts = {};
let lastTraining = [];
let lastBody = [];

function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}

function parseLocalDate(iso) {
  // "YYYY-MM-DD" -> Date a medianoche local (evita el desfase de interpretarlo como UTC)
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(date) {
  const d = new Date(date);
  const dow = d.getDay(); // 0 = domingo
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const DOW_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

// Traducciones conocidas de los tipos que mandan Garmin/intervals.icu.
// Si aparece un tipo que no está aquí, se muestra tal cual viene (nunca se oculta).
const ACTIVITY_LABELS = {
  HIIT: "HIIT",
  Run: "Carrera",
  Running: "Carrera",
  VirtualRun: "Carrera (cinta)",
  Ride: "Bici",
  VirtualRide: "Bici (virtual)",
  MountainBikeRide: "Bici de montaña",
  GravelRide: "Bici de gravel",
  EBikeRide: "Bici eléctrica",
  EMountainBikeRide: "Bici eléctrica de montaña",
  Walk: "Caminata",
  Hike: "Senderismo",
  Swim: "Natación",
  WeightTraining: "Pesas",
  Workout: "Entreno",
};

let activeTypeFilter = null; // null = todas

function activityLabel(type) {
  if (!type) return "Entreno";
  return ACTIVITY_LABELS[type] || type;
}

function loadClass(load) {
  if (load == null) return "load-low";
  if (load < 35) return "load-low";
  if (load < 50) return "load-mid";
  return "load-high";
}

function renderTypeFilters(training) {
  const bar = document.getElementById("typeFilters");
  if (!bar) return;
  const counts = {};
  training.forEach((t) => {
    const key = t.activity_type || "Otro";
    counts[key] = (counts[key] || 0) + 1;
  });
  const types = Object.keys(counts).sort((a, b) => activityLabel(a).localeCompare(activityLabel(b), "es"));

  if (activeTypeFilter && !types.includes(activeTypeFilter)) activeTypeFilter = null;

  bar.innerHTML = "";
  if (!types.length) return;

  const allChip = document.createElement("button");
  allChip.className = "type-chip" + (activeTypeFilter === null ? " active" : "");
  allChip.textContent = `Todas (${training.length})`;
  allChip.addEventListener("click", () => { activeTypeFilter = null; renderCurrentView(); });
  bar.appendChild(allChip);

  types.forEach((type) => {
    const chip = document.createElement("button");
    chip.className = "type-chip" + (activeTypeFilter === type ? " active" : "");
    chip.textContent = `${activityLabel(type)} (${counts[type]})`;
    chip.addEventListener("click", () => {
      activeTypeFilter = activeTypeFilter === type ? null : type;
      renderCurrentView();
    });
    bar.appendChild(chip);
  });
}

function dayDetailHtml(t) {
  const parts = [];
  if (t.distance_km) parts.push(`${t.distance_km} km`);
  if (t.max_hr) parts.push(`FC máx ${Math.round(t.max_hr)} ppm`);
  if (t.calories) parts.push(`${Math.round(t.calories)} kcal`);
  if (t.sleep_score != null) parts.push(`Sueño ${Math.round(t.sleep_score)}`);
  if (!parts.length) return "";
  return `<div class="day-detail">${parts.join(" · ")}</div>`;
}

function renderCalendar(training, body) {
  renderTypeFilters(training);

  const container = document.getElementById("calendarList");
  container.innerHTML = "";

  if (!training.length && !body.length) {
    container.innerHTML = '<div class="week-empty">Sin datos en este rango todavía.</div>';
    return;
  }

  const trainingByDate = {};
  training.forEach((r) => {
    // Si hay varias sesiones el mismo día, nos quedamos con la de mayor carga
    const existing = trainingByDate[r.date];
    if (!existing || (r.training_load || 0) > (existing.training_load || 0)) trainingByDate[r.date] = r;
  });
  const bodyByDate = {};
  body.forEach((r) => { bodyByDate[r.date] = r; });

  const allDates = Array.from(new Set([...training.map((r) => r.date), ...body.map((r) => r.date)])).sort();
  const firstMonday = mondayOf(parseLocalDate(allDates[0]));
  const todayStr = isoDate(new Date());

  // Semanas en orden descendente (la más reciente primero)
  const weeks = [];
  let cursor = mondayOf(parseLocalDate(allDates[allDates.length - 1]));
  while (cursor >= firstMonday) {
    weeks.push(new Date(cursor));
    cursor.setDate(cursor.getDate() - 7);
  }

  weeks.forEach((weekStart) => {
    const days = [];
    let sessions = 0, totalMin = 0, loadSum = 0, loadCount = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      const rawT = trainingByDate[iso];
      const matches = rawT && (!activeTypeFilter || rawT.activity_type === activeTypeFilter);
      const t = matches ? rawT : null;
      const otherType = rawT && !matches ? rawT : null; // hubo entreno pero no es del tipo filtrado
      const b = bodyByDate[iso];
      if (t) {
        sessions++;
        totalMin += t.duration_min || 0;
        if (t.training_load != null) { loadSum += t.training_load; loadCount++; }
      }
      days.push({ date: d, iso, t, otherType, b });
    }
    if (!days.some((x) => x.t || x.otherType || x.b)) return; // semana totalmente vacía fuera del rango real
    if (activeTypeFilter && sessions === 0) return; // con filtro activo, oculta semanas sin ese tipo

    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 6);
    const rangeLabel = `${fmtDate(isoDate(weekStart))} – ${fmtDate(isoDate(weekEnd))}`;
    const avgLoad = loadCount ? Math.round(loadSum / loadCount) : null;

    const card = document.createElement("div");
    card.className = "week-card";
    card.innerHTML = `
      <div class="week-head">
        <div class="week-range">${rangeLabel}</div>
        <div class="week-totals">${sessions} sesion${sessions === 1 ? "" : "es"} · ${(totalMin / 60).toFixed(1)}h${avgLoad != null ? ` · carga media ${avgLoad}` : ""}</div>
      </div>
    `;

    days.forEach(({ date, iso, t, otherType, b }) => {
      const row = document.createElement("div");
      row.className = "day-row" + (iso === todayStr ? " today" : "") + (t ? " has-detail" : "");

      const dateHtml = `<div class="day-date"><span class="dow">${DOW_LABELS[date.getDay() === 0 ? 6 : date.getDay() - 1]}</span><span class="num">${date.getDate()}</span></div>`;

      let bodyHtml;
      if (t) {
        const cls = loadClass(t.training_load);
        const label = activityLabel(t.activity_type);
        const dur = t.duration_min ? `${Math.round(t.duration_min)}m` : "";
        const meta = [];
        if (t.avg_hr) meta.push(`<b>${Math.round(t.avg_hr)}</b> ppm`);
        if (t.hrv) meta.push(`HRV <b>${Math.round(t.hrv)}</b>`);
        if (t.body_battery != null) meta.push(`BB <b>${Math.round(t.body_battery)}</b>`);
        bodyHtml = `
          <span class="load-pill ${cls}">${label}${dur ? " · " + dur : ""}${t.training_load != null ? " · " + Math.round(t.training_load) : ""}</span>
          <span class="day-meta">${meta.join(" · ")}</span>
        `;
      } else if (otherType) {
        bodyHtml = `<span class="rest-label">${activityLabel(otherType.activity_type)} (otro tipo)</span>`;
      } else {
        bodyHtml = `<span class="rest-label">Descanso</span>`;
      }
      if (b && b.weight_kg != null) {
        bodyHtml += `<span class="weight-chip">⚖ ${b.weight_kg}kg${b.fat_pct != null ? ` · ${b.fat_pct}%` : ""}</span>`;
      }

      row.innerHTML = dateHtml + `<div class="day-body">${bodyHtml}</div>`;

      if (t) {
        const detail = document.createElement("div");
        detail.className = "day-detail-wrap";
        detail.innerHTML = dayDetailHtml(t);
        detail.style.display = "none";
        row.appendChild(detail);
        row.style.cursor = "pointer";
        row.addEventListener("click", () => {
          if (!detail.innerHTML) return;
          detail.style.display = detail.style.display === "none" ? "block" : "none";
        });
      }

      card.appendChild(row);
    });

    container.appendChild(card);
  });

  if (!container.children.length) {
    container.innerHTML = '<div class="week-empty">Sin sesiones de este tipo en el rango seleccionado.</div>';
  }
}

async function fetchTable(table, days) {
  if (!cfg || !cfg.url || !cfg.anonKey) throw new Error("no-config");
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().slice(0, 10);
  const url = `${cfg.url}/rest/v1/${table}?date=gte.${sinceStr}&order=date.asc&select=*`;
  const resp = await fetch(url, { headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` } });
  if (!resp.ok) throw new Error(`Error ${resp.status} leyendo ${table}`);
  return resp.json();
}

function statTile(label, value, unit = "") {
  const div = document.createElement("div");
  div.className = "stat-tile";
  div.innerHTML = `<div class="label">${label}</div><div class="value">${value ?? "–"}${unit}</div>`;
  return div;
}

function average(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function renderStats(training, body) {
  const statsEl = document.getElementById("stats");
  statsEl.innerHTML = "";
  const lastTraining = training[training.length - 1];
  const lastBody = body[body.length - 1];
  const totalDurationH = training.reduce((s, r) => s + (r.duration_min || 0), 0) / 60;
  const avgHrv = average(training.map((r) => r.hrv).filter(Boolean));

  statsEl.appendChild(statTile("Sesiones", training.length));
  statsEl.appendChild(statTile("Horas entrenadas", totalDurationH.toFixed(1), "h"));
  statsEl.appendChild(statTile("HRV medio", avgHrv ? avgHrv.toFixed(0) : "–", " ms"));
  statsEl.appendChild(statTile("Peso actual", lastBody?.weight_kg ?? "–", " kg"));
  statsEl.appendChild(statTile("% Grasa", lastBody?.fat_pct ?? "–", "%"));
  statsEl.appendChild(statTile("Body Battery", lastTraining?.body_battery ?? "–"));
}

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

function lineChart(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId).getContext("2d");
  return new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { labels: { color: "#e2e8f0" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
        y: { ticks: { color: "#94a3b8" }, grid: { color: "#334155" } },
      },
    },
  });
}

function renderCharts(training, body) {
  destroyChart("load"); destroyChart("recovery"); destroyChart("body");

  const tLabels = training.map((r) => fmtDate(r.date));
  charts.load = lineChart("chartLoad", tLabels, [
    { label: "Carga (training load)", data: training.map((r) => r.training_load),
      borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.15)", fill: true, tension: 0.3 },
  ]);

  charts.recovery = lineChart("chartRecovery", tLabels, [
    { label: "HRV (ms)", data: training.map((r) => r.hrv), borderColor: "#a78bfa", tension: 0.3 },
    { label: "Body Battery", data: training.map((r) => r.body_battery), borderColor: "#4ade80", tension: 0.3 },
  ]);

  const bLabels = body.map((r) => fmtDate(r.date));
  charts.body = lineChart("chartBody", bLabels, [
    { label: "Peso (kg)", data: body.map((r) => r.weight_kg), borderColor: "#38bdf8", tension: 0.3 },
    { label: "% Grasa", data: body.map((r) => r.fat_pct), borderColor: "#f87171", tension: 0.3 },
  ]);
}

function renderCurrentView() {
  if (currentView === "summary") {
    renderStats(lastTraining, lastBody);
    renderCharts(lastTraining, lastBody);
  } else {
    renderCalendar(lastTraining, lastBody);
  }
}

async function load(days) {
  currentRange = days;
  const subtitle = document.getElementById("subtitle");
  subtitle.textContent = "Cargando datos…";
  try {
    const [training, body] = await Promise.all([fetchTable("training_metrics", days), fetchTable("body_composition", days)]);
    lastTraining = training;
    lastBody = body;
    subtitle.textContent = `Actualizado · ${training.length} sesiones, ${body.length} pesajes`;
    renderCurrentView();
  } catch (err) {
    if (err.message === "no-config") {
      document.getElementById("setup").style.display = "block";
      subtitle.textContent = "";
      return;
    }
    subtitle.textContent = "";
    document.getElementById("stats").innerHTML = `<div class="error">${err.message}</div>`;
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    load(Number(btn.dataset.range));
  });
});

document.querySelectorAll(".view-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    document.getElementById("summaryView").style.display = currentView === "summary" ? "" : "none";
    document.getElementById("calendarView").style.display = currentView === "calendar" ? "" : "none";
    renderCurrentView();
  });
});

load(currentRange);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
