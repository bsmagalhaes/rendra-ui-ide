/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
const fs = require('fs');
const path = require('path');
const { calcClaudeRecordCost, calcCacheSavings } = require('./pricer');

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
const LOOKBACK_DAYS = 90;

// project-aliases.json maps a decoded folder name (the folder the session was opened in) to
// the name to display, so a renamed project keeps its old sessions under the new name
// (e.g. "old-name" → "new-name"). It's personal data, so it lives in the user's data folder
// (setAliasesFile); the copy next to the app is only an empty example.
let projectAliases = null;
let aliasesFile = null;
function setAliasesFile(file) {
  if (file !== aliasesFile) { aliasesFile = file; projectAliases = null; }
}
function loadAliases() {
  if (projectAliases) return projectAliases;
  let raw = {};
  for (const f of [aliasesFile, path.join(__dirname, '..', 'project-aliases.json')].filter(Boolean)) {
    try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch { /* try the next one */ }
  }
  projectAliases = Object.fromEntries(Object.entries(raw).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string'));
  return projectAliases;
}

function decodeProjectName(folderName) {
  const name = decodeFolderName(folderName);
  return loadAliases()[name] || name;
}

function decodeFolderName(folderName) {
  // e.g. "C--Users-Dewashish-Lambore-desktop-projects-burnlink" → "burnlink"
  if (folderName.includes('-desktop-projects-')) {
    const parts = folderName.split('-desktop-projects-');
    return parts[parts.length - 1] || folderName;
  }
  // e.g. "C--MeusProjetos-Desenvolvimento-loja-online" → "loja-online" (any drive letter)
  const devRoot = folderName.match(/^[A-Z]--MeusProjetos-Desenvolvimento(?:-(.+))?$/i);
  if (devRoot) return devRoot[1] || 'Desenvolvimento';
  // e.g. "C--Users-ana" → "Home", "C--Users-ana--local-bin" → "Home/.local-bin"
  const userHome = folderName.match(/^[A-Z]--Users-[^-]+(?:-(.+))?$/i);
  if (userHome) return userHome[1] ? 'Home/' + userHome[1].replace(/^-/, '.') : 'Home';
  // macOS / Linux: "/Users/ana/projects/app" is stored as "-Users-ana-projects-app"
  // ("/home/ana/…" on Linux). The home folder alone is "Home"; a usual container folder
  // (projects, Documents, dev…) is dropped so the project name is what's left.
  const unixHome = folderName.match(/^-(?:Users|home)-[^-]+(?:-(.+))?$/);
  if (unixHome) {
    if (!unixHome[1]) return 'Home';
    return unixHome[1].replace(/^(Desktop|Documents|Documentos|Projects|projects|projetos|Projetos|dev|Developer|code|Code|src|repos|workspace|git)-(?=.)/, '');
  }
  return folderName;
}

// Parsed files are kept in memory keyed by path and only re-read when mtime/size change,
// so re-filtering (projects / period) doesn't pay the full parse again. The same cache is
// persisted to disk (setCacheFile) so a new launch only reads files that changed since:
// a cold scan of a multi-GB history takes tens of seconds, a warm one about a second.
const parseCache = new Map();
const CACHE_VERSION = 3; // v3: 1h cache writes, fast mode and web searches per record
let cacheFile = null;
let diskLoaded = false;
let cacheDirty = false;

function setCacheFile(file) {
  cacheFile = file;
}

// On disk each file is { m: mtime, s: size, models: [..],
//   r: [[id, ts, modelIdx, in, out, cacheRead, cacheWrite, cacheWrite1h, fast, webSearches]] }
function loadDiskCache() {
  diskLoaded = true;
  if (!cacheFile) return;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (raw.v !== CACHE_VERSION) return;
    for (const [p, f] of Object.entries(raw.files || {})) {
      parseCache.set(p, {
        mtime: f.m, size: f.s,
        records: f.r.map(([id, ts, mi, i, o, cr, cw, cw1h, fast, ws]) => ({
          id, ts, model: f.models[mi], inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw,
          cacheWrite1hTokens: cw1h || 0, fast: fast || 0, webSearches: ws || 0,
        })),
      });
    }
  } catch { /* missing or corrupt: start fresh */ }
}

function saveDiskCache(seenPaths) {
  if (!cacheFile || !cacheDirty) return;
  const files = {};
  for (const [p, entry] of parseCache) {
    if (!seenPaths.has(p)) { parseCache.delete(p); continue; } // file deleted or aged out
    const models = [...new Set(entry.records.map(r => r.model))];
    files[p] = {
      m: entry.mtime, s: entry.size, models,
      r: entry.records.map(r => [r.id, r.ts, models.indexOf(r.model), r.inputTokens, r.outputTokens, r.cacheReadTokens,
        r.cacheWriteTokens, r.cacheWrite1hTokens, r.fast, r.webSearches]),
    };
  }
  try {
    const tmp = `${cacheFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, files }));
    fs.renameSync(tmp, cacheFile);
    cacheDirty = false;
  } catch { /* cache is an optimisation only */ }
}

function parseClaudeJsonl(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) return null;

  const cutoff = Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  if (stat.mtimeMs < cutoff) return null;

  const cached = parseCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) return cached;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const records = [];

  for (const line of lines) {
    // Most of the history is tool results and long texts; only assistant lines carry usage.
    // Skipping the rest before JSON.parse is what keeps a multi-GB history scan fast.
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try { obj = JSON.parse(trimmed); } catch { continue; }

    if (obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || !msg.usage) continue;

    const usage = msg.usage;
    const model = msg.model || 'unknown';
    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : stat.mtimeMs;

    records.push({
      // Claude Code writes one line per content block, each repeating the whole message's
      // usage; this id lets the aggregation count every API response exactly once
      id: msg.id ? `${msg.id}:${obj.requestId || ''}` : null,
      model,
      ts,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0, // includes thinking tokens (billed as output)
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheWriteTokens: usage.cache_creation_input_tokens || 0,
      // 1h cache writes bill at 2x input vs 1.25x for 5m; Claude Code uses both
      cacheWrite1hTokens: usage.cache_creation?.ephemeral_1h_input_tokens || 0,
      fast: usage.speed === 'fast' ? 1 : 0,                               // fast mode has its own rates
      webSearches: usage.server_tool_use?.web_search_requests || 0,       // billed per search
    });
  }

  const parsed = { records, mtime: stat.mtimeMs, size: stat.size };
  parseCache.set(filePath, parsed);
  cacheDirty = true;
  return parsed;
}

// Session transcripts sit at the project root; subagent transcripts (Explore, general-purpose…)
// live in "<session-id>/subagents/*.jsonl" and are where most non-main-model usage shows up
function listSessionFiles(projectPath) {
  const out = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); }
      else if (e.name.endsWith('.jsonl')) out.push({ filePath: p, isSubagent: depth > 0 });
    }
  };
  walk(projectPath, 0);
  return out;
}

// Local midnight at the start of a period of `days` days that ends today (days=1 → today)
function periodStartMs(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.getTime();
}

// filters.projects: names to include (empty/missing = all); filters.days: 1..90 (1 = today)
// extraDirs: pastas `projects` de outros ambientes onde o terminal roda o Claude Code (distros WSL)
function aggregateClaude(claudeDir, filters = {}, extraDirs = []) {
  const roots = [claudeDir, ...extraDirs].filter(d => d && fs.existsSync(d));
  if (!roots.length) {
    return { available: false };
  }
  if (!diskLoaded) loadDiskCache();
  const seenPaths = new Set();

  const days = Math.min(Math.max(parseInt(filters.days) || LOOKBACK_DAYS, 1), LOOKBACK_DAYS);
  const selected = Array.isArray(filters.projects) && filters.projects.length ? new Set(filters.projects) : null;
  const periodStart = periodStartMs(days);

  const projectDirs = roots.flatMap(root => fs.readdirSync(root, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(root, d.name)));

  const allProjects = new Map(); // every project seen in the lookback window → 90-day tokens (for the filter list)
  const projectMap = new Map();  // project name → aggregated (period)
  const modelMap = new Map();    // model name → aggregated (period)
  const dailyMap = new Map();    // "YYYY-MM-DD" → aggregated (period)
  const historyMap = new Map();  // "YYYY-MM-DD" → aggregated (selected projects, full 90 days)
  const projectDailyMap = new Map();
  const recentSessions = [];
  const hourlyMap = new Array(24).fill(0);

  let totalInput = 0, totalOutput = 0, totalCacheRead = 0, totalCacheWrite = 0;
  let totalCost = 0, totalSessions = 0, totalCacheSavings = 0;

  const addDay = (map, dateKey, rec, recCost) => {
    if (!map.has(dateKey)) map.set(dateKey, { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 });
    const day = map.get(dateKey);
    day.inputTokens += rec.inputTokens;
    day.outputTokens += rec.outputTokens;
    day.totalTokens += rec.inputTokens + rec.outputTokens;
    day.estimatedCostUSD += recCost;
  };

  const seen = new Set(); // message ids already counted (duplicate lines, resumed sessions)

  for (const projectPath of projectDirs) {
    const projectFolder = path.basename(projectPath);

    const projectName = decodeProjectName(projectFolder);

    for (const { filePath, isSubagent } of listSessionFiles(projectPath)) {
      let parsed;
      seenPaths.add(filePath);
      try { parsed = parseClaudeJsonl(filePath); } catch { continue; }
      if (!parsed || !parsed.records.length) continue;

      const records = parsed.records.filter(r => {
        if (!r.id) return true;
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });
      if (!records.length) continue;

      const fileTokens = records.reduce((s, r) => s + r.inputTokens + r.outputTokens, 0);
      allProjects.set(projectName, (allProjects.get(projectName) || 0) + fileTokens);
      if (selected && !selected.has(projectName)) continue;

      let sIn = 0, sOut = 0, sCacheRead = 0, sCacheWrite = 0, sCost = 0, sLastTs = 0;
      let lastModel = 'unknown';

      for (const rec of records) {
        const dateKey = new Date(rec.ts).toLocaleDateString('en-CA'); // YYYY-MM-DD
        const recTokens = rec.inputTokens + rec.outputTokens;
        const recCost = calcClaudeRecordCost(rec);

        // heatmap, sparklines and the 30-day projection always look at the full history
        addDay(historyMap, dateKey, rec, recCost);
        if (!projectDailyMap.has(projectName)) projectDailyMap.set(projectName, new Map());
        const pdm = projectDailyMap.get(projectName);
        pdm.set(dateKey, (pdm.get(dateKey) || 0) + recTokens);

        if (rec.ts < periodStart) continue;

        sIn += rec.inputTokens;
        sOut += rec.outputTokens;
        sCacheRead += rec.cacheReadTokens;
        sCacheWrite += rec.cacheWriteTokens;
        sCost += recCost;
        sLastTs = Math.max(sLastTs, rec.ts);
        lastModel = rec.model;

        hourlyMap[new Date(rec.ts).getHours()] += recTokens;
        addDay(dailyMap, dateKey, rec, recCost);
        totalCacheSavings += calcCacheSavings(rec.model, rec.cacheReadTokens);

        if (!modelMap.has(rec.model)) {
          modelMap.set(rec.model, { inputTokens: 0, outputTokens: 0, estimatedCostUSD: 0 });
        }
        const m = modelMap.get(rec.model);
        m.inputTokens += rec.inputTokens;
        m.outputTokens += rec.outputTokens;
        m.estimatedCostUSD += recCost;
      }

      if (!sLastTs) continue; // session had no activity inside the period

      // Subagent transcripts add tokens and cost but belong to their parent session
      if (!isSubagent) totalSessions++;
      totalInput += sIn;
      totalOutput += sOut;
      totalCacheRead += sCacheRead;
      totalCacheWrite += sCacheWrite;
      totalCost += sCost;

      if (!projectMap.has(projectName)) {
        projectMap.set(projectName, { name: projectName, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0, sessionCount: 0 });
      }
      const p = projectMap.get(projectName);
      p.inputTokens += sIn;
      p.outputTokens += sOut;
      p.totalTokens += sIn + sOut;
      p.estimatedCostUSD += sCost;
      if (isSubagent) continue;
      p.sessionCount++;

      recentSessions.push({
        project: projectName,
        mtime: Math.max(sLastTs, parsed.mtime),
        inputTokens: sIn,
        outputTokens: sOut,
        model: lastModel,
        totalTokens: sIn + sOut,
      });
    }
  }

  saveDiskCache(seenPaths);
  const daily = buildDailyArray(dailyMap, days);
  const heatmap = buildDailyArray(historyMap, LOOKBACK_DAYS);
  const last7 = heatmap.slice(-7);
  const avg7Cost = last7.reduce((s, d) => s + d.estimatedCostUSD, 0) / 7;
  const costProjection30d = avg7Cost * 30;

  const projectBreakdown = Array.from(projectMap.values())
    .filter(p => p.totalTokens > 0)
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .map(proj => ({
      ...proj,
      sparkline: buildSparkline(projectDailyMap.get(proj.name) || new Map(), 14),
    }));

  const sortedSessions = recentSessions
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 10);

  const modelBreakdown = {};
  for (const [name, data] of modelMap.entries()) {
    if (data.inputTokens + data.outputTokens > 0) modelBreakdown[name] = data;
  }

  const projects = Array.from(allProjects.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name, totalTokens]) => ({ name, totalTokens }));

  return {
    available: true,
    filters: { days, projects: selected ? [...selected] : [] },
    projects,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheWriteTokens: totalCacheWrite,
    totalTokens: totalInput + totalOutput,
    estimatedCostUSD: totalCost,
    totalSessions,
    modelBreakdown,
    projectBreakdown,
    daily,
    heatmap,
    hourly: hourlyMap,
    cacheSavingsUSD: totalCacheSavings,
    costProjection30d,
    recentSessions: sortedSessions,
  };
}

function buildDailyArray(dailyMap, days) {
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateKey = d.toLocaleDateString('en-CA');
    const label = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const data = dailyMap.get(dateKey) || { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUSD: 0 };
    result.push({ date: dateKey, label, ...data });
  }
  return result;
}

function buildSparkline(projDailyTokens, days) {
  const now = new Date();
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    result.push(projDailyTokens.get(d.toLocaleDateString('en-CA')) || 0);
  }
  return result;
}

module.exports = { aggregateClaude, setCacheFile, setAliasesFile };
