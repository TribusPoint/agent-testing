/* ═══════════════════════════════════════════
   Agent Testing · UI5 — sidebar layout
   Dashboard / Tests / Runs / Scoring / Settings
   ═══════════════════════════════════════════ */

function enableBtn(id) { const b = document.getElementById(id); if (b) b.disabled = false; }
function disableBtn(id) { const b = document.getElementById(id); if (b) b.disabled = true; }

const INPUT_DEFAULTS = { personaCount: 4, questionCount: 30 };
const inputMemory = { ...INPUT_DEFAULTS };
function resetInputMemoryForNewTest() { Object.assign(inputMemory, INPUT_DEFAULTS); }
function rememberInput(id, key) { const el = document.getElementById(id); if (el) inputMemory[key] = Number(el.value) || inputMemory[key]; }
function recallAll() { rememberInput("persona-count", "personaCount"); rememberInput("question-count", "questionCount"); }

// ══════════════════════════════════
//  DOM REFS
// ══════════════════════════════════

const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebar-toggle");
const navItems = [...document.querySelectorAll(".nav-item")];

// Sections
const sectionIds = ["dashboard", "tests", "test-detail", "runs", "scoring", "settings"];
const secs = {};
sectionIds.forEach(id => { secs[id] = document.getElementById(`sec-${id}`); });

// Tests list
const btnNewTest = document.getElementById("btn-new-test");
const newTestForm = document.getElementById("new-test-form");
const createTestForm = document.getElementById("create-test-form");
const cancelNewTest = document.getElementById("cancel-new-test");
const testsList = document.getElementById("tests-list");

// Test detail
const btnBackToTests = document.getElementById("btn-back-to-tests");
const testDetailName = document.getElementById("test-detail-name");
const testSubtabs = [...document.querySelectorAll("#test-subtabs .subtab")];
const testTabPanels = {
  analysis: document.getElementById("tab-analysis"),
  personasDims: document.getElementById("tab-personasDims"),
  questions: document.getElementById("tab-questions"),
};

const analysisDashboard = document.getElementById("analysis-dashboard");
const analysisStatusEl = document.getElementById("analysis-status");
const personaGuard = document.getElementById("persona-guard");
const linkToAnalysis = document.getElementById("link-to-analysis");
const pdDashboard = document.getElementById("pd-dashboard");
const personaStatus = document.getElementById("persona-status");
const dimsStatus = document.getElementById("dims-status");
const pqStatus = document.getElementById("pq-status");
const sqStatus = document.getElementById("sq-status");
const questionsDashboard = document.getElementById("questions-dashboard");

// Runs section
const runsTestSelect = document.getElementById("runs-test-select");
const runsPlaceholder = document.getElementById("runs-placeholder");
const runsContent = document.getElementById("runs-content");
const runsSubtabs = [...document.querySelectorAll("#runs-subtabs .subtab")];
const runsTabPanels = {
  automated: document.getElementById("rtab-automated"),
  manual: document.getElementById("rtab-manual"),
};

const runHistory = document.getElementById("run-history");
const runActivity = document.getElementById("run-activity");
const activityCounter = document.getElementById("activity-counter");
let activityCount = 0;
const runTranscript = document.getElementById("run-transcript");
const runStatusEl = document.getElementById("run-status");
const runResultsSection = document.getElementById("run-results-section");
const runResultsCards = document.getElementById("run-results-cards");
const runResultsTbody = document.getElementById("run-results-tbody");

const btnMatrixRun = document.getElementById("btn-matrix-run");
const matrixShowBrowser = document.getElementById("matrix-show-browser");
const matrixInfo = document.getElementById("matrix-info");
const matrixFilterPersona = document.getElementById("matrix-filter-persona");
const matrixFilterDim = document.getElementById("matrix-filter-dim");
const matrixFilterProfile = document.getElementById("matrix-filter-profile");

// Manual chat
const btnManualConnect = document.getElementById("btn-manual-connect");
const btnManualDisconnect = document.getElementById("btn-manual-disconnect");
const manualShowBrowser = document.getElementById("manual-show-browser");
const manualStatusEl = document.getElementById("manual-status");
const manualTranscript = document.getElementById("manual-transcript");
const manualForm = document.getElementById("manual-form");
const manualInput = document.getElementById("manual-input");
const btnManualSend = document.getElementById("btn-manual-send");

// Scoring section
const scoringTestSelect = document.getElementById("scoring-test-select");
const scoringPlaceholder = document.getElementById("scoring-placeholder");
const scoringContent = document.getElementById("scoring-content");

const reportRunSelect = document.getElementById("report-run-select");
const btnExportCsv = document.getElementById("btn-export-csv");
const reportSummary = document.getElementById("report-summary");
const reportChartSection = document.getElementById("report-chart-section");
const scoreChart = document.getElementById("score-chart");
const reportResultsSection = document.getElementById("report-results-section");
const reportResultsTbody = document.getElementById("report-results-tbody");
const compareA = document.getElementById("compare-a");
const compareB = document.getElementById("compare-b");
const btnCompare = document.getElementById("btn-compare");
const compareResults = document.getElementById("compare-results");
const compareSummary = document.getElementById("compare-summary");
const compareTbody = document.getElementById("compare-tbody");

// ══════════════════════════════════
//  STATE
// ══════════════════════════════════

let currentSection = "dashboard";
let currentTest = null;
let testDetailTestId = null;
let ws = null;
let running = false;
let manualConnected = false;
let lastBotBubble = null;
let liveResults = [];
let apiKeyValid = false;

// API key & theme from localStorage
const storedApiKey = localStorage.getItem("openai_api_key") || "";
const storedTheme = localStorage.getItem("theme") || "dark";

// ══════════════════════════════════
//  HELPERS
// ══════════════════════════════════

function fmt(ts) { return new Date(ts).toLocaleTimeString(); }
function fmtDate(ts) { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function truncate(s, n = 80) { return s.length > n ? s.slice(0, n) + "\u2026" : s; }

function scoreBadge(score) {
  if (score == null) return '<span class="score-badge na">N/A</span>';
  const cls = score >= 70 ? "green" : score >= 40 ? "yellow" : "red";
  return `<span class="score-badge ${cls}">${score}</span>`;
}

function getTestQuestions() {
  return (currentTest?.questions || []).filter(q => q.type === "structured" && q.personaId);
}

// ══════════════════════════════════
//  SIDEBAR NAVIGATION
// ══════════════════════════════════

function showSection(name) {
  currentSection = name;
  sectionIds.forEach(id => { if (secs[id]) secs[id].classList.add("hidden"); });

  navItems.forEach(btn => btn.classList.toggle("active", btn.dataset.section === name));

  if (name === "tests") {
    secs["tests"].classList.remove("hidden");
    loadTests();
  } else if (name === "runs") {
    secs["runs"].classList.remove("hidden");
    populateTestPicker(runsTestSelect);
  } else if (name === "scoring") {
    secs["scoring"].classList.remove("hidden");
    populateTestPicker(scoringTestSelect);
  } else if (secs[name]) {
    secs[name].classList.remove("hidden");
  }
}

navItems.forEach(btn => {
  btn.addEventListener("click", () => showSection(btn.dataset.section));
});

// Sidebar collapse
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
});

// ── Test detail (within Tests) ──

function showTestDetail(test) {
  currentTest = test;
  testDetailTestId = test.id;
  secs["tests"].classList.add("hidden");
  secs["test-detail"].classList.remove("hidden");
  testDetailName.textContent = test.name || test.url;
  renderAnalysisDashboard();
  renderPersonasDimsView();
  renderQuestionsView();
  switchTestTab("analysis");
}

btnBackToTests.addEventListener("click", () => {
  secs["test-detail"].classList.add("hidden");
  secs["tests"].classList.remove("hidden");
  currentTest = null;
  testDetailTestId = null;
  loadTests();
});

function switchTestTab(name) {
  testSubtabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  Object.entries(testTabPanels).forEach(([k, p]) => {
    if (p) p.classList.toggle("hidden", k !== name);
  });
  if (name === "analysis") renderAnalysisDashboard();
  if (name === "personasDims") {
    personaGuard.classList.toggle("hidden", !!currentTest?.analysis);
    renderPersonasDimsView();
  }
  if (name === "questions") renderQuestionsView();
}

testSubtabs.forEach(t => t.addEventListener("click", () => switchTestTab(t.dataset.tab)));

linkToAnalysis.addEventListener("click", e => { e.preventDefault(); switchTestTab("analysis"); });

// ── Runs sub-tabs ──

function switchRunsTab(name) {
  runsSubtabs.forEach(t => t.classList.toggle("active", t.dataset.rtab === name));
  Object.entries(runsTabPanels).forEach(([k, p]) => {
    if (p) p.classList.toggle("hidden", k !== name);
  });
}

runsSubtabs.forEach(t => t.addEventListener("click", () => switchRunsTab(t.dataset.rtab)));

// ── Test pickers for Runs & Scoring ──

async function populateTestPicker(selectEl, refreshSelected = true) {
  const r = await fetch("/api/tests");
  const { tests = [] } = await r.json();
  const curVal = selectEl.value;
  selectEl.innerHTML = '<option value="">Select a test...</option>';
  for (const t of tests) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name || t.url;
    selectEl.appendChild(opt);
  }
  if (curVal) {
    selectEl.value = curVal;
    if (refreshSelected) selectEl.dispatchEvent(new Event("change"));
  }
}

runsTestSelect.addEventListener("change", async () => {
  const testId = runsTestSelect.value;
  if (!testId) {
    runsContent.classList.add("hidden");
    runsPlaceholder.classList.remove("hidden");
    currentTest = null;
    return;
  }
  const r = await fetch(`/api/tests/${testId}`);
  if (!r.ok) return;
  const { test } = await r.json();
  currentTest = test;
  runsPlaceholder.classList.add("hidden");
  runsContent.classList.remove("hidden");
  renderRunHistory();
  updateMatrixButton();
  clearLiveRun();
  switchRunsTab("automated");
});

scoringTestSelect.addEventListener("change", async () => {
  const testId = scoringTestSelect.value;
  if (!testId) {
    scoringContent.classList.add("hidden");
    scoringPlaceholder.classList.remove("hidden");
    currentTest = null;
    return;
  }
  const r = await fetch(`/api/tests/${testId}`);
  if (!r.ok) return;
  const { test } = await r.json();
  currentTest = test;
  scoringPlaceholder.classList.add("hidden");
  scoringContent.classList.remove("hidden");
  populateReportSelects();
});

// ══════════════════════════════════
//  WEBSOCKET
// ══════════════════════════════════

function connectWs() {
  ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
  ws.addEventListener("open", () => {
    const key = localStorage.getItem("openai_api_key") || "";
    if (key) ws.send(JSON.stringify({ type: "set_api_key", apiKey: key }));
  });
  ws.addEventListener("close", () => {
    running = false;
    manualConnected = false;
    setTimeout(connectWs, 2000);
  });
  ws.addEventListener("message", ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleWsMessage(msg);
  });
}

function handleWsMessage(msg) {
  if (msg.type === "api_key_ack") {
    apiKeyValid = msg.ok;
    updateLockBanner();
    const badge = document.getElementById("api-key-status");
    if (badge) {
      badge.textContent = msg.ok ? "Connected" : "Invalid";
      badge.className = "badge " + (msg.ok ? "ok" : "err");
    }
    return;
  }
  if (msg.type === "event") addRunLog(msg.ts, msg.message);
  if (msg.type === "transcript") addRunBubble(msg.role, msg.text, msg.partial);

  if (msg.type === "result_update") {
    liveResults.push(msg.result);
    renderLiveResults();
  }
  if (msg.type === "report") renderLiveReportCards(msg.report);

  if (msg.type === "done") {
    setRunStatus("Run completed", "ok");
    running = false;
    updateMatrixButton();
    if (currentTest) refreshTest();
  }
  if (msg.type === "error") {
    const errText = msg.message || "Something failed";
    if (running) {
      setRunStatus(errText, "err");
      running = false;
      updateMatrixButton();
    }
    const analyzeBtn = document.getElementById("btn-analyze");
    if (analyzeBtn) analyzeBtn.disabled = false;
    enableBtn("btn-generate"); enableBtn("btn-gen-dims"); enableBtn("btn-gen-profiles");
    enableBtn("btn-gen-questions");
    setAnalysisStatus(errText, "err");
    setPersonaStatus(errText, "err");
  }

  if (msg.type === "analysis_done") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.analysis = msg.analysis;
      currentTest.name = msg.analysis.siteName || currentTest.name;
      testDetailName.textContent = currentTest.name;
      renderAnalysisDashboard();
      setAnalysisStatus("Analysis complete.", "ok");
    }
    const btn = document.getElementById("btn-analyze");
    if (btn) btn.disabled = false;
  }

  if (msg.type === "personas_done") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.personas = msg.personas;
      if (msg.questions) currentTest.questions = msg.questions;
      renderPersonasDimsView();
      renderQuestionsView();
      setPersonaStatus(`${msg.personas.length} testers generated.`, "ok");
    }
    enableBtn("btn-generate");
  }

  if (msg.type === "dimensions_done") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.dimensions = msg.dimensions;
      renderPersonasDimsView();
      setDimsStatus(`${msg.dimensions.length} dimensions generated.`, "ok");
    }
    enableBtn("btn-gen-dims");
  }

  if (msg.type === "profiles_done") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.personalityProfiles = msg.profiles;
      renderPersonasDimsView();
      setDimsStatus(`${msg.profiles.length} profiles generated.`, "ok");
    }
    enableBtn("btn-gen-profiles");
  }

  if (msg.type === "structured_questions_cleared") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.questions = [];
      renderQuestionsView();
      updateMatrixButton();
      pqStatus.textContent = "";
      sqStatus.textContent = "Questions cleared \u2014 regenerating...";
      sqStatus.className = "status running";
      disableBtn("btn-gen-questions");
    }
  }

  if (msg.type === "questions_done") {
    if (currentTest && msg.testId === currentTest.id) {
      currentTest.questions = msg.questions;
      renderQuestionsView();
      renderPersonasDimsView();
      updateMatrixButton();
      const n = getTestQuestions().length;
      pqStatus.textContent = "";
      sqStatus.textContent = `${n} question${n !== 1 ? "s" : ""} ready.`;
      sqStatus.className = "status ok";
    }
    enableBtn("btn-gen-questions");
  }

  if (msg.type === "manual_status") {
    if (msg.status === "connected") {
      manualConnected = true;
      manualStatusEl.textContent = "Connected";
      manualStatusEl.className = "status ok";
      manualInput.disabled = false;
      btnManualSend.disabled = false;
      btnManualConnect.disabled = true;
      btnManualDisconnect.disabled = false;
    } else if (msg.status === "disconnected") {
      manualConnected = false;
      manualStatusEl.textContent = "Disconnected";
      manualStatusEl.className = "status";
      manualInput.disabled = true;
      btnManualSend.disabled = true;
      btnManualConnect.disabled = false;
      btnManualDisconnect.disabled = true;
    } else if (msg.status === "connecting") {
      manualStatusEl.textContent = "Connecting...";
      manualStatusEl.className = "status running";
    } else if (msg.status === "error") {
      manualStatusEl.textContent = msg.error || "Connection failed";
      manualStatusEl.className = "status err";
      btnManualConnect.disabled = false;
      btnManualDisconnect.disabled = true;
      manualInput.disabled = true;
      btnManualSend.disabled = true;
    }
  }
  if (msg.type === "manual_transcript") addManualBubble(msg.role, msg.text, msg.partial);
}

// ══════════════════════════════════
//  TESTS CRUD
// ══════════════════════════════════

async function loadTests() {
  const r = await fetch("/api/tests");
  const { tests = [] } = await r.json();
  testsList.innerHTML = "";
  if (!tests.length) {
    testsList.innerHTML = '<li class="empty-state" style="padding:2rem;text-align:center;color:var(--muted)">No tests yet. Create one to get started.</li>';
    return;
  }
  for (const t of tests) {
    const li = document.createElement("li");
    const domain = t.analysis?.domain;
    const personaCount = t.personas?.length || 0;
    const runCount = t.runs?.length || 0;
    li.innerHTML = `
      <div class="test-info">
        <div class="test-name">${esc(t.name)}${domain ? `<span class="domain-badge">${esc(domain)}</span>` : ""}</div>
        <div class="test-meta">${esc(t.url)} &middot; ${personaCount} testers &middot; ${runCount} runs &middot; ${fmtDate(t.createdAt)}</div>
      </div>
      <div class="test-actions">
        <button type="button" class="icon-btn delete-btn" title="Delete">&#x2715;</button>
      </div>`;
    li.addEventListener("click", e => {
      if (e.target.closest(".delete-btn")) return;
      openTest(t.id);
    });
    li.querySelector(".delete-btn").addEventListener("click", async e => {
      e.stopPropagation();
      if (!confirm(`Delete test "${t.name}"?`)) return;
      await fetch(`/api/tests/${t.id}`, { method: "DELETE" });
      loadTests();
    });
    testsList.appendChild(li);
  }
}

async function openTest(id) {
  const r = await fetch(`/api/tests/${id}`);
  if (!r.ok) return;
  const { test } = await r.json();
  showTestDetail(test);
}

async function refreshTest() {
  if (!currentTest) return;
  const r = await fetch(`/api/tests/${currentTest.id}`);
  if (!r.ok) return;
  const { test } = await r.json();
  currentTest = test;
  renderRunHistory();
  populateReportSelects();
}

btnNewTest.addEventListener("click", () => newTestForm.classList.toggle("hidden"));
cancelNewTest.addEventListener("click", () => newTestForm.classList.add("hidden"));

createTestForm.addEventListener("submit", async e => {
  e.preventDefault();
  const fd = new FormData(createTestForm);
  const body = {
    url: fd.get("url")?.toString().trim(),
    name: fd.get("name")?.toString().trim() || undefined,
    launcherSelector: fd.get("launcherSelector")?.toString().trim() || undefined,
    inputSelector: fd.get("inputSelector")?.toString().trim() || undefined,
  };
  if (!body.url) return;
  const r = await fetch("/api/tests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { alert("Failed to create test"); return; }
  const { test } = await r.json();
  createTestForm.reset();
  newTestForm.classList.add("hidden");
  resetInputMemoryForNewTest();
  showTestDetail(test);

  const waitForWs = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      setAnalysisStatus("Analyzing site (scraping + AI)...", "running");
      const btn = document.getElementById("btn-analyze");
      if (btn) btn.disabled = true;
      ws.send(JSON.stringify({ type: "analyze", testId: test.id }));
    } else {
      setTimeout(waitForWs, 300);
    }
  };
  waitForWs();
});

// ══════════════════════════════════
//  ANALYSIS DASHBOARD
// ══════════════════════════════════

const audienceColors = ["#5b8def", "#34c77b", "#f5a623", "#a78bfa", "#ef5350", "#38bdf8", "#fb923c", "#e879f9"];
let globalClassicView = false;

function renderAnalysisDashboard() {
  if (!currentTest) return;
  const a = currentTest.analysis;
  if (!a) {
    analysisDashboard.innerHTML = `
      <div class="ad-empty">
        <div class="ad-empty-icon">&#x1F50D;</div>
        <p>No analysis yet. Analyze this site to unlock persona generation, dimensions, and structured testing.</p>
        <button id="btn-analyze" class="primary" type="button">Analyze Site</button>
      </div>`;
    wireAnalyzeButton();
    return;
  }
  if (globalClassicView) renderAnalysisClassic(a);
  else renderAnalysisModern(a);
  wireAnalyzeButton();
  wireViewToggle();
}

function renderAnalysisModern(a) {
  const audience = a.targetAudience || [];
  const services = a.services || [];
  const keywords = a.keywords || [];
  const needs = a.commonUserNeeds || [];

  const audienceCards = audience.map((seg, i) => {
    const color = audienceColors[i % audienceColors.length];
    return `<div class="ad-audience-card" style="border-left-color:${color}">
      <span class="ad-audience-idx" style="background:${color}">${i + 1}</span>
      <span class="ad-audience-name">${esc(seg)}</span>
    </div>`;
  }).join("");

  const serviceCards = services.map((s, i) => {
    const color = audienceColors[i % audienceColors.length];
    return `<div class="ad-service-card"><span class="ad-service-dot" style="background:${color}"></span>${esc(s)}</div>`;
  }).join("");

  const kwCloud = keywords.map((kw, i) => {
    const size = Math.max(0.7, 1.05 - i * 0.03);
    return `<span class="ad-kw" style="font-size:${size}rem">${esc(kw)}</span>`;
  }).join("");

  const needCards = needs.map(n =>
    `<div class="ad-need-card"><span class="ad-need-check">&#x2713;</span><span>${esc(n)}</span></div>`
  ).join("");

  analysisDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Classic View</button>
    </div>
    <div class="ad-hero">
      <div class="ad-hero-top">
        <span class="ad-site-name">${esc(a.siteName)}</span>
        <span class="ad-badge">${esc(a.domain)}</span>
        ${a.subDomain ? `<span class="ad-badge sub">${esc(a.subDomain)}</span>` : ""}
      </div>
      <div class="ad-timestamp">Analyzed ${fmtDate(Date.now())}</div>
    </div>
    <div class="ad-summary-card">${esc(a.summary)}</div>
    <div class="ad-stats">
      <div class="ad-stat"><div class="ad-stat-value c1">${services.length}</div><div class="ad-stat-label">Services</div></div>
      <div class="ad-stat"><div class="ad-stat-value c2">${audience.length}</div><div class="ad-stat-label">Audience Segments</div></div>
      <div class="ad-stat"><div class="ad-stat-value c3">${keywords.length}</div><div class="ad-stat-label">Keywords</div></div>
      <div class="ad-stat"><div class="ad-stat-value c4">${needs.length}</div><div class="ad-stat-label">User Needs</div></div>
    </div>
    ${audience.length ? `<div class="ad-section-title"><span class="ad-section-icon">&#x1F465;</span> Target Audience</div><div class="ad-audience-grid">${audienceCards}</div>` : ""}
    ${services.length ? `<div class="ad-section-title"><span class="ad-section-icon">&#x2699;</span> Services</div><div class="ad-services-grid">${serviceCards}</div>` : ""}
    ${keywords.length ? `<div class="ad-section-title"><span class="ad-section-icon">&#x1F3F7;</span> Keywords</div><div class="ad-keywords-cloud">${kwCloud}</div>` : ""}
    ${needs.length ? `<div class="ad-section-title"><span class="ad-section-icon">&#x2705;</span> User Needs</div><div class="ad-needs-grid">${needCards}</div>` : ""}
    <div class="ad-footer">
      <button id="btn-analyze" class="secondary" type="button">Re-analyze Site</button>
    </div>`;
}

function renderAnalysisClassic(a) {
  const audienceHtml = (a.targetAudience || []).map(x => `<span class="ac-tag">${esc(x)}</span>`).join("");
  const servicesHtml = (a.services || []).map(x => `<li>${esc(x)}</li>`).join("");
  const keywordsHtml = (a.keywords || []).map(x => `<span class="ac-tag">${esc(x)}</span>`).join("");
  const needsHtml = (a.commonUserNeeds || []).map(x => `<li>${esc(x)}</li>`).join("");

  analysisDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Dashboard View</button>
    </div>
    <div class="ac-card card">
      <h3 class="ac-heading">Site Analysis</h3>
      <div class="ac-domain">${esc(a.siteName)} <span class="domain-badge">${esc(a.domain)}</span>${a.subDomain ? `<span class="domain-badge sub">${esc(a.subDomain)}</span>` : ""}</div>
      <div class="ac-summary">${esc(a.summary)}</div>
      ${audienceHtml ? `<div class="ac-label">Target Audience</div><div class="ac-tags">${audienceHtml}</div>` : ""}
      ${servicesHtml ? `<div class="ac-label">Services</div><ul class="ac-list">${servicesHtml}</ul>` : ""}
      ${keywordsHtml ? `<div class="ac-label">Keywords</div><div class="ac-tags">${keywordsHtml}</div>` : ""}
      ${needsHtml ? `<div class="ac-label">Common User Needs</div><ul class="ac-list">${needsHtml}</ul>` : ""}
    </div>
    <div class="ad-footer">
      <button id="btn-analyze" class="secondary" type="button">Re-analyze Site</button>
    </div>`;
}

function toggleGlobalView() {
  globalClassicView = !globalClassicView;
  renderAnalysisDashboard();
  renderPersonasDimsView();
  renderQuestionsView();
}

function wireViewToggle() {
  document.querySelectorAll(".btn-view-toggle").forEach(btn => {
    btn.addEventListener("click", toggleGlobalView);
  });
}

function wireAnalyzeButton() {
  const btn = document.getElementById("btn-analyze");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
    btn.disabled = true;
    setAnalysisStatus("Analyzing site (scraping + AI)...", "running");
    ws.send(JSON.stringify({ type: "analyze", testId: currentTest.id }));
  });
}

function setAnalysisStatus(text, cls = "") { analysisStatusEl.textContent = text; analysisStatusEl.className = `status ${cls}`; }
function setPersonaStatus(text, cls = "") { personaStatus.textContent = text; personaStatus.className = `status ${cls}`; }
function setDimsStatus(text, cls = "") { dimsStatus.textContent = text; dimsStatus.className = `status ${cls}`; }

// ══════════════════════════════════
//  PERSONAS & DIMENSIONS
// ══════════════════════════════════

let pdAddFormVisible = false;
const uqCollapsed = {};

function renderPersonasDimsView() {
  if (!currentTest) { pdDashboard.innerHTML = ""; return; }
  recallAll();
  if (globalClassicView) renderPDClassic(); else renderPDModern();
}

function renderPDModern() {
  const personas = currentTest.personas || [];
  const dims = currentTest.dimensions || [];
  const profiles = currentTest.personalityProfiles || [];
  const pqAll = getTestQuestions();

  const personaCards = personas.map(p => {
    const pqc = pqAll.filter(q => q.personaId === p.id).length;
    const color = audienceColors[personas.indexOf(p) % audienceColors.length];
    return `<div class="pd-persona-card" data-id="${p.id}" style="border-top:3px solid ${color}">
      <div class="pd-pc-header">
        <span class="pd-pc-name">${esc(p.name)}</span>
        ${pqc ? `<span class="pq-badge pd-pq-badge">${pqc} q</span>` : ""}
      </div>
      <div class="pd-pc-row"><span class="pd-pc-label">Persona</span><span class="pd-pc-val">${esc(p.persona)}</span></div>
      <div class="pd-pc-row"><span class="pd-pc-label">Goal</span><span class="pd-pc-val">${esc(p.goal)}</span></div>
      <div class="pd-pc-row"><span class="pd-pc-label">Personality</span><span class="pd-pc-val">${esc(p.personality)}</span></div>
      <div class="pd-pc-row"><span class="pd-pc-label">Knowledge</span><span class="pd-pc-val">${esc(p.knowledgeLevel)}</span></div>
      <div class="pd-pc-actions"><button class="pd-edit-btn" data-pid="${p.id}">Edit</button><button class="pd-del-btn" data-pid="${p.id}">Delete</button></div>
    </div>`;
  }).join("");

  const dimCards = dims.map((d, i) => {
    const color = audienceColors[(i + 2) % audienceColors.length];
    return `<div class="pd-dim-card" style="border-left:3px solid ${color}">
      <div class="pd-dim-name">${esc(d.name)}</div>
      <div class="pd-dim-vals">${d.values.map(v => `<span class="pd-dim-val">${esc(v.value)}</span>`).join("")}</div>
      <button class="pd-dim-del" data-did="${d.id}" title="Delete">&times;</button>
    </div>`;
  }).join("");

  const profileCards = profiles.map((p, i) => {
    const color = audienceColors[(i + 4) % audienceColors.length];
    return `<div class="pd-prof-card" style="border-left:3px solid ${color}">
      <div class="pd-prof-name">${esc(p.name)}</div>
      <div class="pd-prof-meta">${esc(p.tone)} \u00b7 ${esc(p.style)}</div>
      <div class="pd-prof-desc">${esc(p.description)}</div>
      <button class="pd-prof-del" data-pid="${p.id}" title="Delete">&times;</button>
    </div>`;
  }).join("");

  pdDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Classic View</button>
    </div>
    <div class="pd-stats">
      <div class="ad-stat"><div class="ad-stat-value c1">${personas.length}</div><div class="ad-stat-label">Testers</div></div>
      <div class="ad-stat"><div class="ad-stat-value c2">${pqAll.length}</div><div class="ad-stat-label">Questions</div></div>
      <div class="ad-stat"><div class="ad-stat-value c3">${dims.length}</div><div class="ad-stat-label">Dimensions</div></div>
      <div class="ad-stat"><div class="ad-stat-value c4">${profiles.length}</div><div class="ad-stat-label">Profiles</div></div>
    </div>
    <div class="ad-section-title"><span class="ad-section-icon">&#x1F464;</span> Testers</div>
    <div class="pd-controls row">
      <button id="btn-add-persona" class="secondary" type="button">+ Add Tester</button>
      <label class="inline-label">Count <input id="persona-count" type="number" min="1" max="20" value="${inputMemory.personaCount}" class="small-input" /></label>
      <button id="btn-generate" class="primary" type="button">Generate Testers</button>
      <button id="btn-clear-personas" class="secondary" type="button">Clear All</button>
    </div>
    <div id="pd-add-persona-slot"></div>
    ${personas.length ? `<div class="pd-persona-grid">${personaCards}</div>` : '<div class="q-empty">No testers yet. Generate or add one above.</div>'}
    <div class="pd-divider"></div>
    <div class="ad-section-title"><span class="ad-section-icon">&#x1F4CA;</span> Dimensions & Profiles</div>
    <div class="pd-controls row">
      <button id="btn-gen-dims" class="primary" type="button">Generate Dimensions</button>
      <button id="btn-gen-profiles" class="primary" type="button">Generate Profiles</button>
    </div>
    <div class="pd-dp-grid">
      <div>
        <h4 class="pd-sub-title">Dimensions <span class="pd-sub-count">${dims.length}</span></h4>
        ${dims.length ? `<div class="pd-dim-list">${dimCards}</div>` : '<div class="q-empty">No dimensions yet.</div>'}
      </div>
      <div>
        <h4 class="pd-sub-title">Profiles <span class="pd-sub-count">${profiles.length}</span></h4>
        ${profiles.length ? `<div class="pd-prof-list">${profileCards}</div>` : '<div class="q-empty">No profiles yet.</div>'}
      </div>
    </div>`;
  wirePDEvents();
}

function renderPDClassic() {
  const personas = currentTest.personas || [];
  const dims = currentTest.dimensions || [];
  const profiles = currentTest.personalityProfiles || [];

  const personaRows = personas.map(p => {
    const pqc = getTestQuestions().filter(q => q.personaId === p.id).length;
    return `<tr data-id="${p.id}"><td><strong>${esc(p.name)}</strong></td><td>${esc(p.persona)}</td><td>${esc(p.goal)}</td><td>${esc(p.personality)}</td><td>${esc(p.knowledgeLevel)}</td><td>${pqc}</td><td><button class="pd-edit-btn" data-pid="${p.id}">Edit</button> <button class="pd-del-btn" data-pid="${p.id}">Del</button></td></tr>`;
  }).join("");

  const dimRows = dims.map(d =>
    `<tr><td><strong>${esc(d.name)}</strong></td><td>${d.values.map(v => esc(v.value)).join(", ")}</td><td><button class="pd-dim-del" data-did="${d.id}">Del</button></td></tr>`
  ).join("");

  const profRows = profiles.map(p =>
    `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.tone)} \u00b7 ${esc(p.style)}</td><td>${esc(p.description)}</td><td><button class="pd-prof-del" data-pid="${p.id}">Del</button></td></tr>`
  ).join("");

  pdDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Dashboard View</button>
    </div>
    <h3>Testers</h3>
    <div class="pd-controls row">
      <button id="btn-add-persona" class="secondary" type="button">+ Add Tester</button>
      <label class="inline-label">Count <input id="persona-count" type="number" min="1" max="20" value="${inputMemory.personaCount}" class="small-input" /></label>
      <button id="btn-generate" class="primary" type="button">Generate Testers</button>
      <button id="btn-clear-personas" class="secondary" type="button">Clear All</button>
    </div>
    <div id="pd-add-persona-slot"></div>
    ${personas.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Persona</th><th>Goal</th><th>Personality</th><th>Knowledge</th><th>Qs</th><th></th></tr></thead><tbody>${personaRows}</tbody></table></div>` : '<p class="muted">No testers yet.</p>'}
    <div class="pd-divider"></div>
    <h3>Dimensions</h3>
    <div class="pd-controls row">
      <button id="btn-gen-dims" class="primary" type="button">Generate Dimensions</button>
      <button id="btn-gen-profiles" class="primary" type="button">Generate Profiles</button>
    </div>
    ${dims.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Dimension</th><th>Values</th><th></th></tr></thead><tbody>${dimRows}</tbody></table></div>` : '<p class="muted">No dimensions yet.</p>'}
    <h3 style="margin-top:.8rem">Profiles</h3>
    ${profiles.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Name</th><th>Tone & Style</th><th>Description</th><th></th></tr></thead><tbody>${profRows}</tbody></table></div>` : '<p class="muted">No profiles yet.</p>'}`;
  wirePDEvents();
}

function wirePDEvents() {
  wireViewToggle();

  const genBtn = pdDashboard.querySelector("#btn-generate");
  if (genBtn) genBtn.addEventListener("click", () => {
    if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
    const inp = pdDashboard.querySelector("#persona-count");
    const count = Math.min(20, Math.max(1, Number(inp?.value) || inputMemory.personaCount));
    inputMemory.personaCount = count;
    if (inp) inp.value = String(count);
    genBtn.disabled = true;
    setPersonaStatus("Generating diverse testers...", "running");
    ws.send(JSON.stringify({ type: "generate_personas", testId: currentTest.id, count }));
  });

  const addBtn = pdDashboard.querySelector("#btn-add-persona");
  if (addBtn) addBtn.addEventListener("click", () => {
    const slot = pdDashboard.querySelector("#pd-add-persona-slot");
    if (slot.children.length) { slot.innerHTML = ""; return; }
    slot.innerHTML = `<div class="card form-card" style="margin:.5rem 0">
      <div class="row" style="flex-wrap:wrap;gap:.4rem">
        <input id="ap-name" type="text" placeholder="Name" style="flex:1;min-width:120px" />
        <input id="ap-persona" type="text" placeholder="Persona" style="flex:1;min-width:120px" />
        <input id="ap-goal" type="text" placeholder="Goal" style="flex:2;min-width:200px" />
      </div>
      <div class="row" style="margin-top:.4rem;flex-wrap:wrap;gap:.4rem">
        <input id="ap-personality" type="text" placeholder="Personality" style="flex:1;min-width:120px" />
        <input id="ap-knowledge" type="text" placeholder="Knowledge Level" style="flex:1;min-width:120px" />
        <button id="btn-save-persona" class="primary" type="button">Save</button>
        <button id="btn-cancel-persona" class="secondary" type="button">Cancel</button>
      </div>
    </div>`;
    slot.querySelector("#btn-cancel-persona").addEventListener("click", () => { slot.innerHTML = ""; });
    slot.querySelector("#btn-save-persona").addEventListener("click", async () => {
      const name = document.getElementById("ap-name").value.trim();
      if (!name || !currentTest) return;
      const body = { name, persona: document.getElementById("ap-persona").value.trim() || "Visitor", goal: document.getElementById("ap-goal").value.trim() || "General inquiry", personality: document.getElementById("ap-personality").value.trim() || "Neutral", knowledgeLevel: document.getElementById("ap-knowledge").value.trim() || "Beginner" };
      const r = await fetch(`/api/tests/${currentTest.id}/personas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) { const { persona } = await r.json(); currentTest.personas.push(persona); renderPersonasDimsView(); setPersonaStatus("Tester added.", "ok"); }
    });
  });

  const clearBtn = pdDashboard.querySelector("#btn-clear-personas");
  if (clearBtn) clearBtn.addEventListener("click", async () => {
    if (!currentTest || !confirm("Clear all testers and their questions?")) return;
    await fetch(`/api/tests/${currentTest.id}/personas`, { method: "DELETE" });
    currentTest.personas = [];
    currentTest.questions = [];
    renderPersonasDimsView(); renderQuestionsView();
  });

  pdDashboard.querySelectorAll(".pd-edit-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const pid = btn.dataset.pid;
      const persona = currentTest.personas.find(p => p.id === pid);
      if (!persona) return;
      const card = btn.closest("[data-id], tr");
      openPersonaEdit(card, persona);
    });
  });

  pdDashboard.querySelectorAll(".pd-del-btn").forEach(btn => {
    btn.addEventListener("click", e => { e.stopPropagation(); deletePersona(btn.dataset.pid); });
  });

  pdDashboard.querySelectorAll(".pd-pq-badge").forEach(badge => {
    badge.addEventListener("click", e => { e.stopPropagation(); switchTestTab("questions"); });
  });

  const genDimsBtn = pdDashboard.querySelector("#btn-gen-dims");
  if (genDimsBtn) genDimsBtn.addEventListener("click", () => {
    if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentTest.analysis) { setDimsStatus("Analyze the site first.", "err"); return; }
    genDimsBtn.disabled = true;
    setDimsStatus("Generating dimensions...", "running");
    ws.send(JSON.stringify({ type: "generate_dimensions", testId: currentTest.id }));
  });

  const genProfBtn = pdDashboard.querySelector("#btn-gen-profiles");
  if (genProfBtn) genProfBtn.addEventListener("click", () => {
    if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
    genProfBtn.disabled = true;
    setDimsStatus("Generating profiles...", "running");
    ws.send(JSON.stringify({ type: "generate_profiles", testId: currentTest.id }));
  });

  pdDashboard.querySelectorAll(".pd-dim-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/tests/${currentTest.id}/dimensions/${btn.dataset.did}`, { method: "DELETE" });
      currentTest.dimensions = currentTest.dimensions.filter(x => x.id !== btn.dataset.did);
      renderPersonasDimsView();
    });
  });

  pdDashboard.querySelectorAll(".pd-prof-del").forEach(btn => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/tests/${currentTest.id}/profiles/${btn.dataset.pid}`, { method: "DELETE" });
      currentTest.personalityProfiles = currentTest.personalityProfiles.filter(x => x.id !== btn.dataset.pid);
      renderPersonasDimsView();
    });
  });
}

function openPersonaEdit(card, persona) {
  const existing = card.querySelector(".persona-edit-form");
  if (existing) { existing.remove(); return; }
  const form = document.createElement("div");
  form.className = "persona-edit-form";
  form.innerHTML = `
    <input name="name" value="${esc(persona.name)}" placeholder="Name" />
    <input name="persona" value="${esc(persona.persona)}" placeholder="Persona" />
    <input name="goal" value="${esc(persona.goal)}" placeholder="Goal" />
    <input name="personality" value="${esc(persona.personality)}" placeholder="Personality" />
    <input name="knowledgeLevel" value="${esc(persona.knowledgeLevel)}" placeholder="Knowledge Level" />
    <div class="row"><button type="button" class="primary save-btn">Save</button><button type="button" class="secondary cancel-btn">Cancel</button></div>`;
  form.querySelector(".cancel-btn").addEventListener("click", () => form.remove());
  form.querySelector(".save-btn").addEventListener("click", async () => {
    const body = {};
    for (const field of ["name", "persona", "goal", "personality", "knowledgeLevel"]) body[field] = form.querySelector(`[name="${field}"]`).value.trim();
    setPersonaStatus("Saving tester...", "running");
    const r = await fetch(`/api/tests/${currentTest.id}/personas/${persona.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) {
      Object.assign(persona, body);
      const t = await fetch(`/api/tests/${currentTest.id}`);
      if (t.ok) { const { test } = await t.json(); currentTest.questions = test.questions; }
      setPersonaStatus("Tester updated.", "ok");
      renderPersonasDimsView(); renderQuestionsView();
    }
  });
  card.appendChild(form);
}

async function deletePersona(personaId) {
  if (!currentTest) return;
  await fetch(`/api/tests/${currentTest.id}/personas/${personaId}`, { method: "DELETE" });
  currentTest.personas = currentTest.personas.filter(p => p.id !== personaId);
  currentTest.questions = (currentTest.questions || []).filter(q => q.personaId !== personaId);
  renderPersonasDimsView(); renderQuestionsView();
}

// ══════════════════════════════════
//  QUESTIONS
// ══════════════════════════════════

function renderQuestionsView() {
  if (!currentTest) { questionsDashboard.innerHTML = ""; return; }
  recallAll();
  if (globalClassicView) renderQClassic(); else renderQModern();
}

function renderQModern() {
  const qs = getTestQuestions();
  questionsDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Classic View</button>
    </div>
    <p class="muted" style="font-size:.8rem;margin-bottom:.6rem">Each question is tied to a tester, dimension value, and profile. Generate after you have testers, dimensions, and profiles.</p>
    <div class="pd-stats">
      <div class="ad-stat"><div class="ad-stat-value c1">${qs.length}</div><div class="ad-stat-label">Questions</div></div>
    </div>
    <div class="ad-section-title"><span class="ad-section-icon">&#x1F4DD;</span> Questions</div>
    <div class="pd-controls row" style="flex-wrap:wrap">
      <label class="inline-label">Total count <input id="question-count" type="number" min="1" value="${inputMemory.questionCount}" class="small-input" /></label>
      <button id="btn-gen-questions" class="primary" type="button">Generate</button>
      <button id="btn-add-question" class="secondary" type="button">+ Add Question</button>
      <label class="inline-label">Tester <select id="uq-filter-persona"><option value="">All</option>${[...new Set(qs.map(q => q.persona).filter(Boolean))].map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select></label>
      <label class="inline-label">Dimension <select id="uq-filter-dim"><option value="">All</option>${[...new Set(qs.map(q => q.dimension).filter(Boolean))].map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join("")}</select></label>
      <label class="inline-label">Profile <select id="uq-filter-profile"><option value="">All</option>${[...new Set(qs.map(q => q.personalityProfile).filter(Boolean))].map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("")}</select></label>
    </div>
    <div id="uq-add-slot"></div>
    <div id="uq-groups"></div>`;

  renderUnifiedQuestionGroups(document.getElementById("uq-groups"));
  wireQEvents();
}

function renderQClassic() {
  const qs = getTestQuestions();
  const rows = qs.map((q, i) =>
    `<tr><td>${i + 1}</td><td>${esc(q.text)}</td><td>${esc(q.persona || "")}</td><td>${esc(q.dimension || "")}</td><td>${esc(q.dimensionValue || "")}</td><td>${esc(q.personalityProfile || "")}</td><td><input type="text" class="ea-input" data-qid="${q.id}" value="${esc(q.expectedAnswer || "")}" placeholder="Optional" /></td><td><button class="q-del-btn" data-qid="${q.id}">&times;</button></td></tr>`
  ).join("");

  questionsDashboard.innerHTML = `
    <div class="ad-topbar">
      <button class="btn-view-toggle secondary ad-toggle-btn" type="button">Switch to Dashboard View</button>
    </div>
    <h3>Questions (${qs.length})</h3>
    <div class="pd-controls row" style="flex-wrap:wrap">
      <label class="inline-label">Total count <input id="question-count" type="number" min="1" value="${inputMemory.questionCount}" class="small-input" /></label>
      <button id="btn-gen-questions" class="primary" type="button">Generate</button>
      <button id="btn-add-question" class="secondary" type="button">+ Add Question</button>
    </div>
    <div id="uq-add-slot"></div>
    ${qs.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>#</th><th>Question</th><th>Tester</th><th>Dimension</th><th>Value</th><th>Profile</th><th>Expected</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No questions yet.</p>'}`;
  wireQEvents();
}

function renderUnifiedQuestionGroups(container) {
  const qs = getTestQuestions();
  const filterP = document.getElementById("uq-filter-persona")?.value || "";
  const filterD = document.getElementById("uq-filter-dim")?.value || "";
  const filterPr = document.getElementById("uq-filter-profile")?.value || "";
  const filtered = qs.filter(q => {
    if (filterP && q.persona !== filterP) return false;
    if (filterD && q.dimension !== filterD) return false;
    if (filterPr && q.personalityProfile !== filterPr) return false;
    return true;
  });
  container.innerHTML = "";

  if (!filtered.length) {
    container.innerHTML = `<div class="q-empty">${qs.length ? "No questions matching filters." : "No questions yet. Generate testers, dimensions, profiles, then generate questions."}</div>`;
    return;
  }

  const grouped = {};
  for (const q of filtered) {
    const key = q.dimension ? `${q.dimension} \u2014 ${q.dimensionValue || "Any"}` : "General";
    (grouped[key] ||= []).push(q);
  }

  for (const [groupName, items] of Object.entries(grouped)) {
    const isCollapsed = uqCollapsed[groupName] !== false;
    const group = document.createElement("div");
    group.className = "q-group";
    const profiles = [...new Set(items.map(q => q.personalityProfile).filter(Boolean))];
    const personas = [...new Set(items.map(q => q.persona).filter(Boolean))];
    const tagHtml = [...personas.slice(0, 2).map(p => `<span class="q-tag persona-tag">${esc(p)}</span>`), ...profiles.slice(0, 2).map(p => `<span class="q-tag profile-tag">${esc(p)}</span>`)].join("");
    const header = document.createElement("div");
    header.className = "q-group-header" + (isCollapsed ? "" : " open");
    header.innerHTML = `<span class="q-chevron">${isCollapsed ? "&#9654;" : "&#9660;"}</span><span class="q-group-name">${esc(groupName)}</span><span class="q-group-count">${items.length} question${items.length !== 1 ? "s" : ""}</span><span class="q-group-tags">${tagHtml}</span>`;
    header.addEventListener("click", () => { uqCollapsed[groupName] = !uqCollapsed[groupName] ? true : false; renderUnifiedQuestionGroups(container); });
    group.appendChild(header);
    if (!isCollapsed) {
      const body = document.createElement("div");
      body.className = "q-group-body";
      items.forEach((q, i) => {
        const row = document.createElement("div");
        row.className = "q-item";
        const metaParts = [q.persona, q.personalityProfile].filter(Boolean).map(m => esc(m));
        row.innerHTML = `<span class="q-num">${i + 1}</span><div class="q-item-content"><span class="q-text">${esc(q.text)}</span>${metaParts.length ? `<span class="q-meta">${metaParts.join(" \u00b7 ")}</span>` : ""}</div><input type="text" class="ea-input" data-qid="${q.id}" value="${esc(q.expectedAnswer || "")}" placeholder="Expected answer" /><button type="button" class="q-del" data-qid="${q.id}" title="Delete">&times;</button>`;
        wireQItemEvents(row, q);
        body.appendChild(row);
      });
      group.appendChild(body);
    }
    container.appendChild(group);
  }
}

function wireQItemEvents(row, q) {
  row.querySelector(".ea-input").addEventListener("blur", async e => {
    const val = e.target.value.trim();
    await fetch(`/api/tests/${currentTest.id}/questions/${q.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedAnswer: val }) });
    q.expectedAnswer = val;
  });
  row.querySelector(".q-del").addEventListener("click", async () => {
    await fetch(`/api/tests/${currentTest.id}/questions/${q.id}`, { method: "DELETE" });
    currentTest.questions = currentTest.questions.filter(x => x.id !== q.id);
    renderQuestionsView(); renderPersonasDimsView();
  });
}

function wireQEvents() {
  wireViewToggle();

  questionsDashboard.querySelectorAll(".ea-input[data-qid]").forEach(inp => {
    inp.addEventListener("blur", async () => {
      const qid = inp.dataset.qid;
      const val = inp.value.trim();
      await fetch(`/api/tests/${currentTest.id}/questions/${qid}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedAnswer: val }) });
      const q = (currentTest.questions || []).find(x => x.id === qid);
      if (q) q.expectedAnswer = val;
    });
  });

  questionsDashboard.querySelectorAll(".q-del-btn[data-qid]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await fetch(`/api/tests/${currentTest.id}/questions/${btn.dataset.qid}`, { method: "DELETE" });
      currentTest.questions = currentTest.questions.filter(x => x.id !== btn.dataset.qid);
      renderQuestionsView(); renderPersonasDimsView();
    });
  });

  const uqGrps = document.getElementById("uq-groups");
  const uqFP = document.getElementById("uq-filter-persona");
  const uqFD = document.getElementById("uq-filter-dim");
  const uqFPr = document.getElementById("uq-filter-profile");
  if (uqFP) uqFP.addEventListener("change", () => renderUnifiedQuestionGroups(uqGrps));
  if (uqFD) uqFD.addEventListener("change", () => renderUnifiedQuestionGroups(uqGrps));
  if (uqFPr) uqFPr.addEventListener("change", () => renderUnifiedQuestionGroups(uqGrps));

  const genQ = document.getElementById("btn-gen-questions");
  if (genQ) genQ.addEventListener("click", () => {
    if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentTest.analysis) { pqStatus.textContent = "Analyze the site first."; pqStatus.className = "status err"; return; }
    if (!currentTest.personas.length) { pqStatus.textContent = "Generate testers first."; pqStatus.className = "status err"; return; }
    if (!(currentTest.dimensions || []).length) { pqStatus.textContent = "Generate dimensions first."; pqStatus.className = "status err"; return; }
    if (!(currentTest.personalityProfiles || []).length) { pqStatus.textContent = "Generate profiles first."; pqStatus.className = "status err"; return; }
    const inp = document.getElementById("question-count");
    const count = Math.max(1, Number(inp?.value) || inputMemory.questionCount);
    inputMemory.questionCount = count;
    if (inp) inp.value = String(count);
    genQ.disabled = true;
    pqStatus.textContent = "";
    sqStatus.textContent = "Generating questions across testers, dimensions, and profiles...";
    sqStatus.className = "status running";
    ws.send(JSON.stringify({ type: "generate_questions", testId: currentTest.id, count }));
  });

  const addBtn = document.getElementById("btn-add-question");
  if (addBtn) addBtn.addEventListener("click", () => {
    const slot = document.getElementById("uq-add-slot");
    if (slot.children.length) { slot.innerHTML = ""; return; }
    const personas = currentTest?.personas || [], dims = currentTest?.dimensions || [], profiles = currentTest?.personalityProfiles || [];
    slot.innerHTML = `<div class="card form-card" style="margin:.5rem 0"><div class="row" style="flex-wrap:wrap;gap:.4rem">
      <label class="inline-label">Tester <select id="asq-persona-id"><option value="">Select...</option>${personas.map(p => `<option value="${p.id}" data-name="${esc(p.name)}">${esc(p.name)}</option>`).join("")}</select></label>
      <label class="inline-label">Dimension <select id="asq-dim"><option value="">Select...</option>${dims.map(d => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join("")}</select></label>
      <label class="inline-label">Value <select id="asq-dimval"><option value="">Select...</option></select></label>
      <label class="inline-label">Profile <select id="asq-profile"><option value="">Select...</option>${profiles.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join("")}</select></label>
    </div><div class="row" style="margin-top:.4rem;flex-wrap:wrap;gap:.4rem">
      <input id="asq-text" type="text" placeholder="Question text" style="flex:2;min-width:200px" />
      <input id="asq-expected" type="text" placeholder="Expected answer (optional)" style="flex:1;min-width:120px" />
      <button id="btn-save-uq" class="primary" type="button">Add</button>
      <button class="secondary" type="button" onclick="this.closest('.card').parentElement.innerHTML=''">Cancel</button>
    </div></div>`;
    document.getElementById("asq-dim").addEventListener("change", function () {
      const dim = dims.find(d => d.name === this.value);
      document.getElementById("asq-dimval").innerHTML = '<option value="">Select...</option>' + (dim?.values || []).map(v => `<option value="${esc(v.value)}">${esc(v.value)}</option>`).join("");
    });
    document.getElementById("btn-save-uq").addEventListener("click", async () => {
      const sid = document.getElementById("asq-persona-id").value;
      const txt = document.getElementById("asq-text").value.trim();
      if (!sid || !txt || !currentTest) return;
      const sel = document.getElementById("asq-persona-id");
      const name = sel.options[sel.selectedIndex]?.dataset?.name || "";
      const body = {
        text: txt, personaId: sid, persona: name,
        dimension: document.getElementById("asq-dim").value || undefined,
        dimensionValue: document.getElementById("asq-dimval").value || undefined,
        personalityProfile: document.getElementById("asq-profile").value || undefined,
        expectedAnswer: document.getElementById("asq-expected").value.trim() || undefined,
      };
      const r = await fetch(`/api/tests/${currentTest.id}/questions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (r.ok) {
        const { question } = await r.json();
        if (!currentTest.questions) currentTest.questions = [];
        currentTest.questions.push(question);
        renderQuestionsView(); renderPersonasDimsView(); updateMatrixButton();
      }
    });
  });
}

// ══════════════════════════════════
//  RUNS (Automated)
// ══════════════════════════════════

function getFilteredMatrixQuestions() {
  const qs = getTestQuestions();
  const fp = matrixFilterPersona.value;
  const fd = matrixFilterDim.value;
  const fpr = matrixFilterProfile.value;
  return qs.filter(q => {
    if (fp && q.personaId !== fp) return false;
    if (fd && q.dimension !== fd) return false;
    if (fpr && q.personalityProfile !== fpr) return false;
    return true;
  });
}

function updateMatrixButton() {
  const allQ = getTestQuestions();
  populateMatrixFilters();
  const filtered = getFilteredMatrixQuestions();
  const isFiltered = filtered.length !== allQ.length;

  if (allQ.length > 0) {
    matrixInfo.textContent = isFiltered
      ? `${filtered.length} of ${allQ.length} questions match filters.`
      : `${allQ.length} questions ready. Use filters to narrow the run, or run all.`;
    btnMatrixRun.disabled = running || filtered.length === 0;
    btnMatrixRun.textContent = filtered.length === allQ.length
      ? `Run all ${allQ.length} questions`
      : `Run ${filtered.length} question${filtered.length !== 1 ? "s" : ""}`;
  } else {
    matrixInfo.textContent = "No questions yet. Set up testers, dimensions, profiles, and questions in the Tests section first.";
    btnMatrixRun.disabled = true;
    btnMatrixRun.textContent = "Run questions";
  }
}

function populateMatrixFilters() {
  const qs = getTestQuestions();
  const idToName = new Map((currentTest?.personas || []).map(p => [p.id, p.name]));
  const testerIds = [...new Set(qs.map(q => q.personaId).filter(Boolean))];
  const dims = [...new Set(qs.map(q => q.dimension).filter(Boolean))];
  const profiles = [...new Set(qs.map(q => q.personalityProfile).filter(Boolean))];
  const curP = matrixFilterPersona.value, curD = matrixFilterDim.value, curPr = matrixFilterProfile.value;

  matrixFilterPersona.innerHTML = '<option value="">All testers</option>' + testerIds.map(id => {
    const name = idToName.get(id) || id;
    return `<option value="${esc(id)}">${esc(name)}</option>`;
  }).join("");
  matrixFilterDim.innerHTML = '<option value="">All dimensions</option>' + dims.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  matrixFilterProfile.innerHTML = '<option value="">All profiles</option>' + profiles.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join("");

  matrixFilterPersona.value = curP; matrixFilterDim.value = curD; matrixFilterProfile.value = curPr;
}

matrixFilterPersona.addEventListener("change", updateMatrixButton);
matrixFilterDim.addEventListener("change", updateMatrixButton);
matrixFilterProfile.addEventListener("change", updateMatrixButton);

function renderRunHistory() {
  runHistory.innerHTML = "";
  const runs = currentTest?.runs || [];
  if (!runs.length) {
    runHistory.innerHTML = '<div class="rh-empty">No runs yet. Run questions from the panel above.</div>';
    return;
  }
  for (const r of runs.slice(0, 30)) {
    const card = document.createElement("div");
    card.className = "rh-card";
    const statusCls = r.status === "ok" ? "ok" : r.status === "error" ? "err" : "running";
    const score = r.report ? Math.round(r.report.avgScore) : null;
    const duration = r.startedAt && r.endedAt ? msToHuman(new Date(r.endedAt) - new Date(r.startedAt)) : "\u2014";
    const questionsCount = r.results?.length || r.turns || 0;

    card.innerHTML = `
      <div class="rh-top">
        <span class="rh-status ${statusCls}">${r.status === "ok" ? "&#10003;" : r.status === "error" ? "&#10007;" : "&#9679;"}</span>
        <span class="rh-persona">${esc(r.personaName)}</span>
        <span class="rh-type-badge rh-type-matrix">Test</span>
      </div>
      <div class="rh-meta">
        <span title="Date">${fmtDate(r.startedAt)}</span>
        <span title="Duration">${duration}</span>
        <span title="Questions">${questionsCount} q</span>
      </div>
      ${score !== null ? `<div class="rh-score-bar"><div class="rh-score-fill" style="width:${score}%;background:${scoreColor(score)}"></div><span class="rh-score-label">${score}</span></div>` : ""}`;
    card.addEventListener("click", () => {
      [...runHistory.querySelectorAll(".rh-card")].forEach(c => c.classList.remove("active"));
      card.classList.add("active");
      showRunDetail(r);
    });
    runHistory.appendChild(card);
  }
}

function msToHuman(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}
function scoreColor(s) {
  if (s >= 80) return "var(--ok)";
  if (s >= 50) return "#f6ad55";
  return "var(--danger)";
}

function showRunDetail(run) {
  runActivity.innerHTML = "";
  activityCount = 0;
  for (const e of run.events || []) addActivityEntry(e.ts, e.message, false);
  runActivity.scrollTop = runActivity.scrollHeight;

  runTranscript.innerHTML = "";
  lastBotBubble = null;
  for (const m of run.transcript || []) {
    const b = document.createElement("div");
    b.className = `bubble ${m.role}`;
    b.innerHTML = `<div class="meta">${m.role}</div><div class="text"></div>`;
    b.querySelector(".text").textContent = m.text;
    runTranscript.appendChild(b);
  }
  runTranscript.scrollTop = runTranscript.scrollHeight;
  setRunStatus(`Run: ${run.personaName} (${run.status})`, run.status === "ok" ? "ok" : run.status === "error" ? "err" : "");

  if (run.results?.length) {
    liveResults = run.results;
    renderLiveResults();
    if (run.report) renderLiveReportCards(run.report);
  } else {
    runResultsSection.classList.add("hidden");
  }
}

function clearLiveRun() {
  runActivity.innerHTML = "";
  activityCount = 0;
  activityCounter.textContent = "0";
  runTranscript.innerHTML = "";
  lastBotBubble = null;
  liveResults = [];
  runResultsSection.classList.add("hidden");
  setRunStatus("", "");
}

function renderLiveResults() {
  runResultsSection.classList.remove("hidden");
  runResultsTbody.innerHTML = "";
  for (const r of liveResults) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(truncate(r.questionText))}</td>
      <td class="truncate">${esc(truncate(r.responseText, 120))}</td>
      <td>${r.followUps?.length || 0}</td>
      <td>${r.latencyMs}ms</td>
      <td>${scoreBadge(r.score)}</td>
      <td class="muted">${esc(r.evaluationNotes || "")}</td>`;
    runResultsTbody.appendChild(tr);
  }
}

function renderLiveReportCards(report) {
  runResultsCards.innerHTML = `
    <div class="score-card"><div class="sc-label">Questions</div><div class="sc-value">${report.totalQuestions}</div></div>
    <div class="score-card"><div class="sc-label">Passed</div><div class="sc-value" style="color:var(--ok)">${report.passCount}</div></div>
    <div class="score-card"><div class="sc-label">Pass Rate</div><div class="sc-value">${(report.passRate * 100).toFixed(0)}%</div></div>
    <div class="score-card"><div class="sc-label">Avg Score</div><div class="sc-value">${report.avgScore.toFixed(1)}</div></div>
    <div class="score-card"><div class="sc-label">Avg Latency</div><div class="sc-value">${Math.round(report.avgLatencyMs)}ms</div></div>`;
}

function categorizeEvent(msg) {
  const m = msg.toLowerCase();
  if (m.includes("error") || m.includes("fail") || m.includes("timed out")) return "error";
  if (m.includes("score") || m.includes("evaluat")) return "score";
  if (m.includes("done") || m.includes("complete") || m.includes("finished") || m.includes("report")) return "done";
  if (m.includes("navigat") || m.includes("open") || m.includes("launch") || m.includes("click")) return "browser";
  if (m.includes("question") || m.includes("asking") || m.includes("send")) return "question";
  if (m.includes("wait") || m.includes("reply") || m.includes("response") || m.includes("bot")) return "reply";
  return "info";
}
const eventIcons = { error: "&#10007;", score: "&#9733;", done: "&#10003;", browser: "&#9741;", question: "&#10148;", reply: "&#9776;", info: "&#8226;" };

function addActivityEntry(ts, message, scroll = true) {
  activityCount++;
  activityCounter.textContent = String(activityCount);
  const cat = categorizeEvent(message);
  const entry = document.createElement("div");
  entry.className = `af-entry af-${cat}`;
  entry.innerHTML = `<span class="af-icon">${eventIcons[cat]}</span><span class="af-time">${fmt(ts)}</span><span class="af-msg">${esc(message)}</span>`;
  runActivity.appendChild(entry);
  if (scroll) runActivity.scrollTop = runActivity.scrollHeight;
}

function addRunLog(ts, message) { addActivityEntry(ts, message, true); }

function addRunBubble(role, text, partial) {
  if (role === "bot" && lastBotBubble) {
    lastBotBubble.querySelector(".text").textContent = text;
    if (!partial) lastBotBubble = null;
    return;
  }
  const b = document.createElement("div");
  b.className = `bubble ${role}`;
  b.innerHTML = `<div class="meta">${role}</div><div class="text"></div>`;
  b.querySelector(".text").textContent = text;
  runTranscript.appendChild(b);
  runTranscript.scrollTop = runTranscript.scrollHeight;
  if (role === "bot" && partial) lastBotBubble = b;
  else lastBotBubble = null;
}

function setRunStatus(text, cls = "") { runStatusEl.textContent = text; runStatusEl.className = `status ${cls}`; }

btnMatrixRun.addEventListener("click", () => {
  if (!currentTest || running) return;
  const filtered = getFilteredMatrixQuestions();
  if (!filtered.length) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) { setRunStatus("WebSocket not connected", "err"); return; }
  clearLiveRun();
  running = true;
  btnMatrixRun.disabled = true;
  setRunStatus(`Running ${filtered.length} question${filtered.length !== 1 ? "s" : ""}...`, "running");
  const payload = { type: "matrix_run", testId: currentTest.id, headless: !matrixShowBrowser.checked };
  const tid = matrixFilterPersona.value;
  if (tid) payload.testerId = tid;
  const fd = matrixFilterDim.value;
  if (fd) payload.dimension = fd;
  const fpr = matrixFilterProfile.value;
  if (fpr) payload.personalityProfile = fpr;
  ws.send(JSON.stringify(payload));
});

// ══════════════════════════════════
//  REPORTS / SCORING
// ══════════════════════════════════

function populateReportSelects() {
  const runs = (currentTest?.runs || []).filter(r => r.status === "ok" && r.results?.length);
  const opts = runs.map(r => `<option value="${r.id}">${esc(r.personaName)} \u2014 ${fmtDate(r.startedAt)}${r.report ? ` (${r.report.avgScore.toFixed(0)})` : ""}</option>`).join("");
  reportRunSelect.innerHTML = '<option value="">Choose a completed run...</option>' + opts;
  compareA.innerHTML = '<option value="">Select...</option>' + opts;
  compareB.innerHTML = '<option value="">Select...</option>' + opts;
}

reportRunSelect.addEventListener("change", async () => {
  const runId = reportRunSelect.value;
  if (!runId || !currentTest) {
    reportSummary.classList.add("hidden");
    reportChartSection.classList.add("hidden");
    reportResultsSection.classList.add("hidden");
    btnExportCsv.disabled = true;
    return;
  }
  const r = await fetch(`/api/tests/${currentTest.id}/report/${runId}`);
  if (!r.ok) return;
  const { run, report } = await r.json();
  btnExportCsv.disabled = false;

  if (report) {
    reportSummary.classList.remove("hidden");
    reportSummary.innerHTML = `
      <div class="score-card"><div class="sc-label">Questions</div><div class="sc-value">${report.totalQuestions}</div></div>
      <div class="score-card"><div class="sc-label">Passed (\u226570)</div><div class="sc-value" style="color:var(--ok)">${report.passCount}</div></div>
      <div class="score-card"><div class="sc-label">Pass Rate</div><div class="sc-value">${(report.passRate * 100).toFixed(0)}%</div></div>
      <div class="score-card"><div class="sc-label">Avg Score</div><div class="sc-value">${report.avgScore.toFixed(1)}</div></div>
      <div class="score-card"><div class="sc-label">Avg Latency</div><div class="sc-value">${Math.round(report.avgLatencyMs)}ms</div></div>`;
  } else {
    reportSummary.classList.add("hidden");
  }

  const results = run.results || [];
  if (results.length) {
    renderScoreChart(results);
    reportChartSection.classList.remove("hidden");
    reportResultsSection.classList.remove("hidden");
    renderReportResults(results, run.id);
  } else {
    reportChartSection.classList.add("hidden");
    reportResultsSection.classList.add("hidden");
  }
});

function renderScoreChart(results) {
  const buckets = [
    { label: "0-25", min: 0, max: 25, color: "var(--danger)" },
    { label: "26-50", min: 26, max: 50, color: "var(--warn)" },
    { label: "51-75", min: 51, max: 75, color: "var(--accent)" },
    { label: "76-100", min: 76, max: 100, color: "var(--ok)" },
  ];
  const scored = results.filter(r => r.score != null);
  const maxCount = Math.max(1, ...buckets.map(b => scored.filter(r => r.score >= b.min && r.score <= b.max).length));

  scoreChart.innerHTML = buckets.map(b => {
    const count = scored.filter(r => r.score >= b.min && r.score <= b.max).length;
    const pct = (count / maxCount) * 100;
    return `<div class="bar-col">
      <div class="bar-count">${count}</div>
      <div class="bar-fill" style="height:${pct}%;background:${b.color}"></div>
      <div class="bar-label">${b.label}</div>
    </div>`;
  }).join("");
}

function renderReportResults(results, runId) {
  reportResultsTbody.innerHTML = "";
  results.forEach((r, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(truncate(r.questionText))}</td>
      <td class="truncate">${esc(truncate(r.responseText, 100))}</td>
      <td>${r.followUps?.length || 0}</td>
      <td>${r.latencyMs}ms</td>
      <td>${scoreBadge(r.score)}</td>
      <td class="muted">${esc(r.evaluationNotes || "")}</td>
      <td><input type="number" class="hs-input" min="0" max="100" value="${r.humanScore ?? ""}" placeholder="0-100" style="width:60px" /></td>
      <td><input type="text" class="hn-input" value="${esc(r.humanNotes || "")}" placeholder="Notes..." /></td>
      <td class="save-cell"><button type="button">Save</button></td>`;
    tr.querySelector(".save-cell button").addEventListener("click", async () => {
      const hs = tr.querySelector(".hs-input").value;
      const hn = tr.querySelector(".hn-input").value;
      await fetch(`/api/tests/${currentTest.id}/runs/${runId}/results/${idx}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ humanScore: hs === "" ? null : Number(hs), humanNotes: hn }),
      });
      tr.querySelector(".save-cell button").textContent = "Saved!";
      setTimeout(() => { tr.querySelector(".save-cell button").textContent = "Save"; }, 1200);
    });
    reportResultsTbody.appendChild(tr);
  });
}

btnExportCsv.addEventListener("click", () => {
  if (!currentTest || !reportRunSelect.value) return;
  window.open(`/api/tests/${currentTest.id}/export/${reportRunSelect.value}`, "_blank");
});

compareA.addEventListener("change", () => { btnCompare.disabled = !compareA.value || !compareB.value; });
compareB.addEventListener("change", () => { btnCompare.disabled = !compareA.value || !compareB.value; });

btnCompare.addEventListener("click", async () => {
  if (!currentTest || !compareA.value || !compareB.value) return;
  const r = await fetch(`/api/tests/${currentTest.id}/compare?runA=${compareA.value}&runB=${compareB.value}`);
  if (!r.ok) return;
  const data = await r.json();

  compareResults.classList.remove("hidden");
  compareSummary.innerHTML = `
    <div class="score-card"><div class="sc-label">Avg Score A</div><div class="sc-value">${data.avgScoreA.toFixed(1)}</div></div>
    <div class="score-card"><div class="sc-label">Avg Score B</div><div class="sc-value">${data.avgScoreB.toFixed(1)}</div></div>
    <div class="score-card"><div class="sc-label">Delta</div><div class="sc-value ${data.avgDelta >= 0 ? "delta-positive" : "delta-negative"}">${data.avgDelta >= 0 ? "+" : ""}${data.avgDelta.toFixed(1)}</div></div>`;

  compareTbody.innerHTML = "";
  for (const q of data.questions) {
    const tr = document.createElement("tr");
    const deltaStr = q.delta != null ? (q.delta >= 0 ? `+${q.delta}` : String(q.delta)) : "\u2014";
    const deltaCls = q.delta != null ? (q.delta >= 0 ? "delta-positive" : "delta-negative") : "";
    tr.innerHTML = `
      <td>${esc(truncate(q.questionText, 80))}</td>
      <td>${scoreBadge(q.scoreA)}</td>
      <td>${scoreBadge(q.scoreB)}</td>
      <td class="${deltaCls}">${deltaStr}</td>`;
    compareTbody.appendChild(tr);
  }
});

// ══════════════════════════════════
//  MANUAL CHAT
// ══════════════════════════════════

let manualLastBotBubble = null;

function addManualBubble(role, text, partial) {
  if (role === "bot" && manualLastBotBubble) {
    manualLastBotBubble.querySelector(".text").textContent = text;
    if (!partial) manualLastBotBubble = null;
    return;
  }
  const b = document.createElement("div");
  b.className = `bubble ${role}`;
  b.innerHTML = `<div class="meta">${role}</div><div class="text"></div>`;
  b.querySelector(".text").textContent = text;
  manualTranscript.appendChild(b);
  manualTranscript.scrollTop = manualTranscript.scrollHeight;
  if (role === "bot" && partial) manualLastBotBubble = b;
  else manualLastBotBubble = null;
}

btnManualConnect.addEventListener("click", () => {
  if (!currentTest || !ws || ws.readyState !== WebSocket.OPEN) return;
  btnManualConnect.disabled = true;
  manualTranscript.innerHTML = "";
  manualLastBotBubble = null;
  ws.send(JSON.stringify({
    type: "manual_start",
    testId: currentTest.id,
    headless: !manualShowBrowser.checked,
  }));
});

btnManualDisconnect.addEventListener("click", () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "manual_stop" }));
});

manualForm.addEventListener("submit", e => {
  e.preventDefault();
  const text = manualInput.value.trim();
  if (!text || !manualConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
  manualInput.value = "";
  ws.send(JSON.stringify({ type: "manual_send", text }));
});

// ══════════════════════════════════
//  SETTINGS — API KEY
// ══════════════════════════════════

const apiKeyInput = document.getElementById("api-key-input");
const btnSaveKey = document.getElementById("btn-save-key");
const btnClearKey = document.getElementById("btn-clear-key");
const btnToggleKeyVis = document.getElementById("btn-toggle-key-vis");
const apiKeyStatus = document.getElementById("api-key-status");
const lockBanner = document.getElementById("lock-banner");
const linkToSettings = document.getElementById("link-to-settings");

if (apiKeyInput && storedApiKey) apiKeyInput.value = storedApiKey;

function updateLockBanner() {
  const hasKey = Boolean(localStorage.getItem("openai_api_key"));
  if (lockBanner) lockBanner.classList.toggle("hidden", hasKey);
}

if (btnSaveKey) btnSaveKey.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  localStorage.setItem("openai_api_key", key);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_api_key", apiKey: key }));
  }
  updateLockBanner();
});

if (btnClearKey) btnClearKey.addEventListener("click", () => {
  localStorage.removeItem("openai_api_key");
  apiKeyInput.value = "";
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "set_api_key", apiKey: "" }));
  }
  apiKeyValid = false;
  if (apiKeyStatus) { apiKeyStatus.textContent = "Cleared"; apiKeyStatus.className = "badge"; }
  updateLockBanner();
});

if (btnToggleKeyVis) btnToggleKeyVis.addEventListener("click", () => {
  const isPass = apiKeyInput.type === "password";
  apiKeyInput.type = isPass ? "text" : "password";
  document.getElementById("eye-icon").style.opacity = isPass ? ".5" : "1";
});

if (linkToSettings) linkToSettings.addEventListener("click", e => {
  e.preventDefault();
  showSection("settings");
});

// ══════════════════════════════════
//  DARK / LIGHT THEME
// ══════════════════════════════════

const themeToggle = document.getElementById("theme-toggle");
const themeIconSun = document.getElementById("theme-icon-sun");
const themeIconMoon = document.getElementById("theme-icon-moon");
const themeLabel = document.getElementById("theme-label");

function applyTheme(theme) {
  document.documentElement.classList.toggle("light", theme === "light");
  localStorage.setItem("theme", theme);
  if (themeIconSun) themeIconSun.classList.toggle("hidden", theme === "light");
  if (themeIconMoon) themeIconMoon.classList.toggle("hidden", theme !== "light");
  if (themeLabel) themeLabel.textContent = theme === "light" ? "Dark mode" : "Light mode";
  if (themeToggle) themeToggle.setAttribute("data-tooltip", theme === "light" ? "Dark mode" : "Light mode");
}

if (themeToggle) themeToggle.addEventListener("click", () => {
  const next = document.documentElement.classList.contains("light") ? "dark" : "light";
  applyTheme(next);
});

// ══════════════════════════════════
//  INIT
// ══════════════════════════════════

applyTheme(storedTheme);
updateLockBanner();
connectWs();
showSection("dashboard");
