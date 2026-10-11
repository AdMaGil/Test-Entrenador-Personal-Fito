const cfg = window.SUPABASE_CONFIG;
let currentRange = 30;
let charts = {};

function fmtDate(d) {
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
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

async function load(days) {
  currentRange = days;
  const subtitle = document.getElementById("subtitle");
  subtitle.textContent = "Cargando datos…";
  try {
    const [training, body] = await Promise.all([fetchTable("training_metrics", days), fetchTable("body_composition", days)]);
    subtitle.textContent = `Actualizado · ${training.length} sesiones, ${body.length} pesajes`;
    renderStats(training, body);
    renderCharts(training, body);
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

load(currentRange);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
}
