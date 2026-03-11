// main.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const Store = require('electron-store');

const store = new Store();

const IPTV_CACHE_TTL_MS = 2 * 60 * 1000;
const IPTV_MAX_LIMIT = 20000;
const iptvCache = new Map();
const iptvLogoCache = new Map();
const iptvLogoInFlight = new Map();
const synopsisMemoryCache = new Map();
const synopsisDiskCache = new Map();
const synopsisPosterInFlight = new Map();
let cachedTmdbApiKey = '';

const PROJECT_CACHE_DIR = path.join(__dirname, 'cache');
const PLAYLIST_CACHE_DIR = path.join(PROJECT_CACHE_DIR, 'playlist');
const LOCAL_PLAYLIST_PATH = path.join(PLAYLIST_CACHE_DIR, 'playlist.m3u');
const LOGO_CACHE_DIR = path.join(PROJECT_CACHE_DIR, 'logos');
const SYNOPSIS_CACHE_DIR = path.join(PROJECT_CACHE_DIR, 'synopsis');
const SYNOPSIS_POSTERS_DIR = path.join(SYNOPSIS_CACHE_DIR, 'posters');
const SYNOPSIS_CACHE_FILE = path.join(SYNOPSIS_CACHE_DIR, 'synopses.json');
const CHROMIUM_CACHE_DIR = path.join(PROJECT_CACHE_DIR, 'chromium');

try {
  if (!fs.existsSync(CHROMIUM_CACHE_DIR)) {
    fs.mkdirSync(CHROMIUM_CACHE_DIR, { recursive: true });
  }
  app.setPath('sessionData', CHROMIUM_CACHE_DIR);
  app.commandLine.appendSwitch('disk-cache-dir', CHROMIUM_CACHE_DIR);
} catch (err) {
  console.error('Failed to configure Chromium cache directory:', err);
}

const IPTV_DEFAULT_LIMITS = {
  live: 5000,
  movie: 5000,
  series: 5000,
  other: 1000,
  all: 15000,
};

// FFmpeg outside ASAR
function getBinPath(...segments) {
  const baseDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
  return path.join(baseDir, 'bin', ...segments);
}

const ffmpegPath = getBinPath(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

// Thumbs directory in project cache
const thumbsDir = path.join(PROJECT_CACHE_DIR, 'thumbs');

// Dedicated meta file (avoid collisions with electron-store)
const metaPath = path.join(app.getPath('userData'), 'user-meta.json');

function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  const indexPath = path.join(app.getAppPath(), 'public', 'index.html');
  win.loadFile(indexPath).catch((err) => {
    console.error('Error loading index.html:', err);
    dialog.showErrorBox('Erro', `Falha ao carregar interface:\n${err.message}`);
  });
}

function ensureDirSafe(targetPath, label) {
  if (fs.existsSync(targetPath)) return;
  try {
    fs.mkdirSync(targetPath, { recursive: true });
  } catch (err) {
    console.error(`Failed to create ${label}:`, err);
  }
}

function ensureProjectCacheDirs() {
  ensureDirSafe(PROJECT_CACHE_DIR, 'project cache directory');
  ensureDirSafe(PLAYLIST_CACHE_DIR, 'playlist cache directory');
  ensureDirSafe(LOGO_CACHE_DIR, 'logo cache directory');
  ensureDirSafe(SYNOPSIS_CACHE_DIR, 'synopsis cache directory');
  ensureDirSafe(SYNOPSIS_POSTERS_DIR, 'synopsis posters cache directory');
  ensureDirSafe(CHROMIUM_CACHE_DIR, 'chromium cache directory');
  ensureDirSafe(thumbsDir, 'thumbnails cache directory');
}

function clearDirContentsSafe(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const entries = fs.readdirSync(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(targetPath, entry.name);
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch (err) {
      console.warn(`Falha ao remover item de cache: ${fullPath}`, err);
    }
  }
}

function clearIptvMemoryCaches() {
  iptvCache.clear();
  iptvLogoCache.clear();
  iptvLogoInFlight.clear();
  synopsisMemoryCache.clear();
  synopsisDiskCache.clear();
  synopsisPosterInFlight.clear();
}

function removeFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(() => {
  ensureProjectCacheDirs();
  readSynopsisDiskCache();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// =========================
// IPTV helpers
// =========================

function sanitizeServerUrl(rawServer) {
  let value = String(rawServer || '').trim();
  if (!value) return '';

  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`;
  }
  return value;
}

function ensureLogoCacheDir() {
  if (!fs.existsSync(LOGO_CACHE_DIR)) {
    fs.mkdirSync(LOGO_CACHE_DIR, { recursive: true });
  }
}

function hashText(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function extensionFromContentType(contentType) {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized.includes('image/jpeg') || normalized.includes('image/jpg')) return '.jpg';
  if (normalized.includes('image/png')) return '.png';
  if (normalized.includes('image/webp')) return '.webp';
  if (normalized.includes('image/gif')) return '.gif';
  if (normalized.includes('image/svg+xml')) return '.svg';
  if (normalized.includes('image/bmp')) return '.bmp';
  if (normalized.includes('image/x-icon') || normalized.includes('image/vnd.microsoft.icon')) return '.ico';
  return '';
}

function extensionFromUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    const ext = path.extname(parsed.pathname || '').toLowerCase();
    if (ext && ext.length <= 6) return ext;
  } catch {
    return '';
  }
  return '';
}

function resolveLogoExtension(urlValue, contentType) {
  return extensionFromContentType(contentType) || extensionFromUrl(urlValue) || '.img';
}

function ensureSynopsisCacheDirs() {
  if (!fs.existsSync(SYNOPSIS_CACHE_DIR)) {
    fs.mkdirSync(SYNOPSIS_CACHE_DIR, { recursive: true });
  }
  if (!fs.existsSync(SYNOPSIS_POSTERS_DIR)) {
    fs.mkdirSync(SYNOPSIS_POSTERS_DIR, { recursive: true });
  }
}

function findExistingLogoPathByHash(hash) {
  const files = fs.readdirSync(LOGO_CACHE_DIR);
  const found = files.find((name) => name.startsWith(`${hash}.`));
  if (!found) return '';
  return path.join(LOGO_CACHE_DIR, found);
}

function findExistingSynopsisPosterPathByHash(hash) {
  if (!fs.existsSync(SYNOPSIS_POSTERS_DIR)) return '';
  const files = fs.readdirSync(SYNOPSIS_POSTERS_DIR);
  const found = files.find((name) => name.startsWith(`${hash}.`));
  if (!found) return '';
  return path.join(SYNOPSIS_POSTERS_DIR, found);
}

function normalizeSynopsisCacheResult(value) {
  return {
    text: String(value?.text || '').trim(),
    year: String(value?.year || '').trim(),
    rating: Number.isFinite(Number(value?.rating)) ? Number(value.rating) : null,
    posterUrl: String(value?.posterUrl || '').trim(),
    source: String(value?.source || '').trim(),
    reason: String(value?.reason || '').trim(),
  };
}

function readSynopsisDiskCache() {
  try {
    if (!fs.existsSync(SYNOPSIS_CACHE_FILE)) return;
    const raw = fs.readFileSync(SYNOPSIS_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    for (const [cacheKey, value] of Object.entries(parsed)) {
      synopsisDiskCache.set(cacheKey, normalizeSynopsisCacheResult(value));
    }
  } catch {
    synopsisDiskCache.clear();
  }
}

function writeSynopsisDiskCache() {
  try {
    ensureSynopsisCacheDirs();
    const payload = {};
    for (const [cacheKey, value] of synopsisDiskCache.entries()) {
      payload[cacheKey] = normalizeSynopsisCacheResult(value);
    }
    fs.writeFileSync(SYNOPSIS_CACHE_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.warn('Falha ao persistir cache de sinopses:', err);
  }
}

async function fetchLogoBuffer(urlValue, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(urlValue, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'MindFlix-IPTV/1.0' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();
    return {
      contentType,
      buffer: Buffer.from(arrayBuffer),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function cacheIptvLogoLocally(logoUrl) {
  const value = String(logoUrl || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;

  const memoryHit = iptvLogoCache.get(value);
  if (memoryHit && fs.existsSync(memoryHit.filePath)) {
    return memoryHit.fileUrl;
  }

  if (iptvLogoInFlight.has(value)) {
    return iptvLogoInFlight.get(value);
  }

  const task = (async () => {
    try {
      ensureLogoCacheDir();
      const hash = hashText(value);
      const existingPath = findExistingLogoPathByHash(hash);
      if (existingPath && fs.existsSync(existingPath)) {
        const existingUrl = pathToFileURL(existingPath).href;
        iptvLogoCache.set(value, { filePath: existingPath, fileUrl: existingUrl });
        return existingUrl;
      }

      const payload = await fetchLogoBuffer(value);
      const ext = resolveLogoExtension(value, payload.contentType);
      const filePath = path.join(LOGO_CACHE_DIR, `${hash}${ext}`);
      fs.writeFileSync(filePath, payload.buffer);
      const fileUrl = pathToFileURL(filePath).href;
      iptvLogoCache.set(value, { filePath, fileUrl });
      return fileUrl;
    } catch {
      return value;
    } finally {
      iptvLogoInFlight.delete(value);
    }
  })();

  iptvLogoInFlight.set(value, task);
  return task;
}

async function cacheSynopsisPosterLocally(posterUrl) {
  const value = String(posterUrl || '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value;

  if (synopsisPosterInFlight.has(value)) {
    return synopsisPosterInFlight.get(value);
  }

  const task = (async () => {
    try {
      ensureSynopsisCacheDirs();
      const hash = hashText(value);
      const existingPath = findExistingSynopsisPosterPathByHash(hash);
      if (existingPath && fs.existsSync(existingPath)) {
        return pathToFileURL(existingPath).href;
      }

      const payload = await fetchLogoBuffer(value);
      const ext = resolveLogoExtension(value, payload.contentType);
      const filePath = path.join(SYNOPSIS_POSTERS_DIR, `${hash}${ext}`);
      fs.writeFileSync(filePath, payload.buffer);
      return pathToFileURL(filePath).href;
    } catch {
      return value;
    } finally {
      synopsisPosterInFlight.delete(value);
    }
  })();

  synopsisPosterInFlight.set(value, task);
  return task;
}

function findUnquotedCommaIndex(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' || char === "'") {
      if (!quote) {
        quote = char;
      } else if (quote === char) {
        quote = null;
      }
      continue;
    }
    if (char === ',' && !quote) {
      return index;
    }
  }
  return -1;
}

function sanitizeParsedTitle(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const cleaned = text
    .replace(/\s+tvg-(id|name|logo)\s*=\s*["'][\s\S]*$/i, '')
    .replace(/\s+group-title\s*=\s*["'][\s\S]*$/i, '')
    .trim();
  return cleaned || text;
}

function parseExtInf(line) {
  const attrs = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let match = attrRegex.exec(line);

  while (match) {
    attrs[match[1]] = match[2];
    match = attrRegex.exec(line);
  }

  const commaIndex = findUnquotedCommaIndex(line);
  const rawName = commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : '';
  const name = sanitizeParsedTitle(rawName);
  const tvgName = sanitizeParsedTitle(attrs['tvg-name'] || '');

  return {
    name,
    tvgId: attrs['tvg-id'] || '',
    tvgName,
    logo: attrs['tvg-logo'] || '',
    group: attrs['group-title'] || 'Sem grupo',
  };
}

function detectKind(group, streamUrl) {
  const groupNorm = String(group || '').toLowerCase();
  const urlNorm = String(streamUrl || '').toLowerCase();

  // URL-based detection is often more reliable for Xtream Codes / XUI systems
  if (urlNorm.includes('/series/')) return 'series';
  if (urlNorm.includes('/movie/')) return 'movie';

  if (
    groupNorm.includes('séries') || 
    groupNorm.includes('series') || 
    groupNorm.includes('serie') || 
    groupNorm.includes('novelas') ||
    groupNorm.includes('novela') ||
    groupNorm.includes('season') ||
    groupNorm.includes('temporada') ||
    groupNorm.includes('anime') ||
    groupNorm.includes('desenho')
  ) {
    return 'series';
  }

  if (
    groupNorm.includes('filmes') || 
    groupNorm.includes('filme') || 
    groupNorm.includes('movies') || 
    groupNorm.includes('movie') || 
    groupNorm.includes('vod') || 
    groupNorm.includes('cinema') ||
    groupNorm.includes('4k') || // Often movies
    groupNorm.includes('fhd')   // Often movies if not channel
  ) {
    // Check if it's explicitly a channel
    if (!groupNorm.includes('canais') && !groupNorm.includes('tv')) {
        return 'movie';
    }
  }

  if (groupNorm.includes('canais') || urlNorm.includes('/live/') || /\.(m3u8|ts)(\?|$)/i.test(streamUrl)) {
    return 'live';
  }

  return 'other';
}

function parseM3u(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
  const channels = [];
  let pending = null;

  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      pending = parseExtInf(line);
      continue;
    }

    if (line.startsWith('#')) continue;
    if (!pending) continue;

    let group = pending.group || 'Sem grupo';
    let kind = 'other';

    // 1. Strict Pattern Matching (Redefining content disposition based on playlist analysis)
    // Pattern: Symbol + Category + " | " + Subcategory
    
    // Live TV: "♦️Canais | ..."
    if (group.includes('Canais |')) {
        kind = 'live';
        // Remove the prefix (Symbol + "Canais | ")
        // We use a regex that is flexible with the symbol part
        group = group.replace(/^.*Canais\s*\|\s*/i, '').trim();
    }
    // Movies: "♠️Filmes | ..."
    else if (group.includes('Filmes |')) {
        kind = 'movie';
        group = group.replace(/^.*Filmes\s*\|\s*/i, '').trim();
    }
    // Series: "♣️Séries | ..."
    else if (group.includes('Séries |') || group.includes('Series |')) {
        kind = 'series';
        group = group.replace(/^.*(Séries|Series)\s*\|\s*/i, '').trim();
    }
    else {
        // 2. Fallback Detection
        kind = detectKind(group, line);
    }

    channels.push({
      id: channels.length + 1,
      name: pending.name || pending.tvgName || pending.tvgId || `Canal ${channels.length + 1}`,
      group: group, // Now cleaned
      logo: pending.logo || '',
      url: line,
      tvgId: pending.tvgId || '',
      kind: kind,
    });

    pending = null;
  }

  return channels;
}

function normalizeSynopsisText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= 240) return text;
  return `${text.slice(0, 237).trimEnd()}...`;
}

function normalizeTitleForSearch(rawTitle) {
  return String(rawTitle || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\b(s\d{1,2}e\d{1,2}|\d{1,2}x\d{1,2}|temporada\s*\d+)\b/gi, ' ')
    .replace(/\(\d{4}\)\s*$/g, ' ')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleAndYear(rawTitle) {
  const value = String(rawTitle || '').trim();
  const yearMatch = value.match(/\((\d{4})\)\s*$/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  const title = normalizeTitleForSearch(value);
  return { title, year: Number.isFinite(year) ? year : null };
}

function getTmdbApiKey() {
  const envValue = String(process.env.TMDB_API_KEY || '').trim();
  if (envValue) {
    cachedTmdbApiKey = envValue;
    return envValue;
  }

  if (cachedTmdbApiKey) {
    return cachedTmdbApiKey;
  }

  const storedValue = String(store.get('tmdb_api_key') || '').trim();
  if (storedValue) {
    cachedTmdbApiKey = storedValue;
    process.env.TMDB_API_KEY = storedValue;
    return storedValue;
  }

  if (process.platform === 'win32') {
    const readFromScope = (scope) => {
      const output = spawnSync(
        'powershell',
        ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('TMDB_API_KEY','${scope}')`],
        { encoding: 'utf8', windowsHide: true }
      );
      if (output.status !== 0) return '';
      return String(output.stdout || '').trim();
    };

    const userValue = readFromScope('User');
    if (userValue) {
      cachedTmdbApiKey = userValue;
      process.env.TMDB_API_KEY = userValue;
      return userValue;
    }

    const machineValue = readFromScope('Machine');
    if (machineValue) {
      cachedTmdbApiKey = machineValue;
      process.env.TMDB_API_KEY = machineValue;
      return machineValue;
    }
  }

  return '';
}

async function searchTmdbOverview(kind, title, year, language) {
  const apiKey = getTmdbApiKey();
  if (!apiKey || !title) return null;

  const endpoint = kind === 'series' ? 'tv' : 'movie';
  const url = new URL(`https://api.themoviedb.org/3/search/${endpoint}`);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('query', title);
  url.searchParams.set('language', language);
  url.searchParams.set('include_adult', 'false');
  if (year) {
    if (endpoint === 'tv') url.searchParams.set('first_air_date_year', String(year));
    else url.searchParams.set('year', String(year));
  }

  const payload = await fetchJsonWithTimeout(url.toString(), 20000);
  const first = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!first) return null;

  const dateValue = String(first?.release_date || first?.first_air_date || '').trim();
  const yearValue = /^\d{4}/.test(dateValue) ? dateValue.slice(0, 4) : '';
  const ratingValue = Number(first?.vote_average);
  const posterPath = String(first?.poster_path || '').trim();

  return {
    text: normalizeSynopsisText(first?.overview || ''),
    year: yearValue,
    rating: Number.isFinite(ratingValue) ? ratingValue : null,
    posterUrl: posterPath ? `https://image.tmdb.org/t/p/w342${posterPath}` : '',
  };
}

async function getTmdbSynopsis(channel) {
  const contentKind = String(channel?.kind || '').toLowerCase();
  if (contentKind !== 'movie' && contentKind !== 'series') {
    return { text: '', source: '', reason: 'unsupported_kind' };
  }

  const apiKey = getTmdbApiKey();
  if (!apiKey) {
    return { text: '', source: '', reason: 'missing_api_key' };
  }

  const { title, year } = extractTitleAndYear(channel?.name || channel?.tvgName || '');
  if (!title) {
    return { text: '', source: '', reason: 'missing_title' };
  }

  const cacheKey = `${contentKind}::${title.toLowerCase()}::${year || ''}`;
  if (synopsisMemoryCache.has(cacheKey)) {
    return synopsisMemoryCache.get(cacheKey);
  }

  if (synopsisDiskCache.has(cacheKey)) {
    const diskHit = normalizeSynopsisCacheResult(synopsisDiskCache.get(cacheKey));
    synopsisMemoryCache.set(cacheKey, diskHit);
    return diskHit;
  }

  let details = null;
  let reason = 'not_found';
  try {
    details = await searchTmdbOverview(contentKind, title, year, 'pt-BR');
    const hasDetails =
      details &&
      (details.text || details.year || Number.isFinite(details.rating) || details.posterUrl);
    if (!hasDetails) {
      details = await searchTmdbOverview(contentKind, title, year, 'en-US');
    }
  } catch {
    reason = 'request_error';
  }

  const result =
    details && (details.text || details.year || Number.isFinite(details.rating) || details.posterUrl)
    ? {
        text: details.text || '',
        year: details.year || '',
        rating: Number.isFinite(details.rating) ? details.rating : null,
        posterUrl: details.posterUrl ? await cacheSynopsisPosterLocally(details.posterUrl) : '',
        source: 'tmdb',
        reason: '',
      }
    : {
        text: '',
        year: '',
        rating: null,
        posterUrl: '',
        source: '',
        reason,
      };

  synopsisMemoryCache.set(cacheKey, result);
  synopsisDiskCache.set(cacheKey, result);
  writeSynopsisDiskCache();
  return result;
}

async function resolveSynopsisForChannel(channel) {
  return getTmdbSynopsis(channel);
}

function parseKind(value) {
  const normalized = String(value || 'live').toLowerCase();
  if (['live', 'movie', 'series', 'other', 'all'].includes(normalized)) return normalized;
  return 'live';
}

function parseLimit(rawLimit, kind) {
  const fallback = IPTV_DEFAULT_LIMITS[kind] || IPTV_DEFAULT_LIMITS.live;
  const parsed = Number(rawLimit);

  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50000, Math.floor(parsed)));
}

function parseOffset(rawOffset) {
  const parsed = Number(rawOffset);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function applyFilters(channels, kind, search) {
  const searchNorm = String(search || '').trim().toLowerCase();

  return channels.filter((item) => {
    const kindMatch = kind === 'all' || item.kind === kind;
    if (!kindMatch) return false;

    if (!searchNorm) return true;

    return (
      item.name.toLowerCase().includes(searchNorm) ||
      item.group.toLowerCase().includes(searchNorm)
    );
  });
}

function uniqueGroups(channels) {
  return [...new Set((channels || []).map((item) => item.group))].sort((a, b) => a.localeCompare(b));
}

function kindCountsFromChannels(channels) {
  const counts = { live: 0, vod: 0, other: 0 };
  for (const item of channels || []) {
    if (Object.prototype.hasOwnProperty.call(counts, item.kind)) {
      counts[item.kind] += 1;
    }
  }
  return counts;
}

async function fetchTextWithTimeout(url, timeoutMs = 120000, onProgress = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const reportProgress = typeof onProgress === 'function' ? onProgress : null;

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'MindFlix-IPTV/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const totalBytes = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
    const reader = response.body && typeof response.body.getReader === 'function'
      ? response.body.getReader()
      : null;

    if (!reader) {
      const buffer = await response.arrayBuffer();
      const rawBuffer = Buffer.from(buffer);
      reportProgress?.({
        receivedBytes: rawBuffer.length,
        totalBytes: totalBytes || rawBuffer.length,
        speedBps: 0,
        done: true,
      });
      return rawBuffer.toString('utf8');
    }

    const chunks = [];
    let receivedBytes = 0;
    const startedAt = Date.now();
    let lastEmitAt = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || !value.byteLength) continue;

      const chunkBuffer = Buffer.from(value);
      chunks.push(chunkBuffer);
      receivedBytes += chunkBuffer.length;

      const now = Date.now();
      if (now - lastEmitAt >= 180) {
        const elapsed = Math.max(0.001, (now - startedAt) / 1000);
        reportProgress?.({
          receivedBytes,
          totalBytes,
          speedBps: receivedBytes / elapsed,
          done: false,
        });
        lastEmitAt = now;
      }
    }

    const elapsed = Math.max(0.001, (Date.now() - startedAt) / 1000);
    reportProgress?.({
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      speedBps: receivedBytes / elapsed,
      done: true,
    });

    return Buffer.concat(chunks, receivedBytes).toString('utf8');
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJsonWithTimeout(url, timeoutMs = 30000) {
  const raw = await fetchTextWithTimeout(url, timeoutMs);

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Resposta JSON inválida do servidor IPTV.');
  }
}

async function validateIptvLogin(payload) {
  const sourceUrl = sanitizeServerUrl(payload.url);
  if (!sourceUrl) throw new Error('URL da playlist é obrigatória.');

  // Simple validation by fetching the header
  try {
    const response = await fetch(sourceUrl, { method: 'HEAD', headers: { 'User-Agent': 'MindFlix-IPTV/1.0' } });
    if (!response.ok && response.status !== 405) { // Some servers block HEAD
       // try GET with range if HEAD fails
    }
  } catch (e) {
     // ignore and try full fetch in load
  }

  return {
    sourceUrl,
    sourceMasked: sourceUrl, // No masking needed for raw URL unless we want to hide token
    userInfo: {
      status: 'active',
    },
  };
}

async function getParsedPlaylistForSource(sourceUrl, forceRefresh = false, onProgress = null) {
  const reportProgress = typeof onProgress === 'function' ? onProgress : null;
  const now = Date.now();
  const existing = iptvCache.get(sourceUrl);

  // In-memory cache is still valid
  if (!forceRefresh && existing && now - existing.cachedAt < IPTV_CACHE_TTL_MS) {
    reportProgress?.({
      stage: 'cache_memory',
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      done: true,
    });
    return existing;
  }

  let playlistText = '';

  if (!forceRefresh && fs.existsSync(LOCAL_PLAYLIST_PATH)) {
    try {
      const localStat = fs.statSync(LOCAL_PLAYLIST_PATH);
      reportProgress?.({
        stage: 'cache_local',
        receivedBytes: localStat.size,
        totalBytes: localStat.size,
        speedBps: 0,
        done: true,
      });
      const localText = fs.readFileSync(LOCAL_PLAYLIST_PATH, 'utf8');
      const localChannels = parseM3u(localText);
      if (localChannels.length) {
        const localPayload = {
          sourceUrl: sourceUrl,
          sourceMasked: sourceUrl,
          channels: localChannels,
          kindCounts: kindCountsFromChannels(localChannels),
          cachedAt: Date.now(),
        };
        iptvCache.set(sourceUrl, localPayload);
        return localPayload;
      }
    } catch (err) {
      console.warn('Falha ao ler playlist local em cache:', err);
    }
  }

  try {
    // 1. Try to download from URL
    console.log('Downloading playlist from URL:', sourceUrl);
    reportProgress?.({
      stage: 'download_start',
      receivedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      done: false,
    });
    playlistText = await fetchTextWithTimeout(sourceUrl, 120000, (payload) => {
      reportProgress?.({
        stage: 'downloading',
        receivedBytes: Number(payload?.receivedBytes || 0),
        totalBytes: Number(payload?.totalBytes || 0),
        speedBps: Number(payload?.speedBps || 0),
        done: Boolean(payload?.done),
      });
    });
    
    // 2. Save to local file
    try {
      fs.writeFileSync(LOCAL_PLAYLIST_PATH, playlistText, 'utf8');
      console.log('Playlist saved to disk:', LOCAL_PLAYLIST_PATH);
    } catch (err) {
      console.warn('Failed to save playlist to disk:', err);
    }
  } catch (err) {
    console.warn('Failed to download playlist:', err);
    
    // 3. Fallback: Try to read from local file
    if (fs.existsSync(LOCAL_PLAYLIST_PATH)) {
      console.log('Using local cached playlist as fallback.');
      const localStat = fs.statSync(LOCAL_PLAYLIST_PATH);
      reportProgress?.({
        stage: 'cache_fallback',
        receivedBytes: localStat.size,
        totalBytes: localStat.size,
        speedBps: 0,
        done: true,
      });
      playlistText = fs.readFileSync(LOCAL_PLAYLIST_PATH, 'utf8');
    } else {
      throw new Error('Falha ao baixar playlist e nenhum cache local encontrado.');
    }
  }

  const channels = parseM3u(playlistText);

  if (!channels.length) {
    throw new Error('A playlist foi carregada, mas nenhum canal foi identificado.');
  }

  const payload = {
    sourceUrl: sourceUrl,
    sourceMasked: sourceUrl,
    channels,
    kindCounts: kindCountsFromChannels(channels),
    cachedAt: Date.now(),
  };

  iptvCache.set(sourceUrl, payload);
  return payload;
}

async function loadIptvChannels(params, options = {}) {
  const sourceUrl = String(params.sourceUrl || '').trim();
  const kind = parseKind(params.kind);
  const limit = parseLimit(params.limit, kind);
  const offset = parseOffset(params.offset);
  const force = Boolean(params.force);
  const search = String(params.search || '');

  if (!sourceUrl) {
    throw new Error('Fonte IPTV ausente. Faça login novamente.');
  }

  const cached = await getParsedPlaylistForSource(sourceUrl, force, options.reportProgress);
  const filtered = applyFilters(cached.channels, kind, search);
  const groups = uniqueGroups(filtered);
  const channels = filtered.slice(offset, offset + limit);
  const nextOffset = offset + channels.length;
  const hasMore = nextOffset < filtered.length;

  return {
    source: cached.sourceMasked,
    kind,
    totalAll: cached.channels.length,
    totalFiltered: filtered.length,
    returned: channels.length,
    offset,
    nextOffset,
    hasMore,
    limit,
    groups,
    kindCounts: cached.kindCounts,
    channels,
    cachedAt: new Date(cached.cachedAt).toISOString(),
    fetchedAt: new Date().toISOString(),
  };
}

// =========================
// IPC handlers (existing)
// =========================

ipcMain.handle('load-config', () => {
  const legacyCfgPath = path.join(app.getPath('userData'), 'config.json');

  try {
    if (fs.existsSync(metaPath)) {
      const cfg = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return cfg || {};
    }

    if (fs.existsSync(legacyCfgPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyCfgPath, 'utf8'));
      return {
        folders: legacy.folders || [],
        watchedVideos: legacy.watchedVideos || [],
        videoOrders: legacy.videoOrders || {},
      };
    }
  } catch (e) {
    console.warn('Falha ao ler config/meta:', e);
  }

  return {};
});

ipcMain.handle('save-config', (e, cfg) => {
  try {
    fs.writeFileSync(metaPath, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar user-meta.json:', err);
    return false;
  }
});

ipcMain.handle('get-thumbs-path', () => thumbsDir);

ipcMain.handle('select-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('load-folders', () => store.get('folders', []));
ipcMain.handle('save-folders', (e, folders) => {
  store.set('folders', folders);
  return true;
});
ipcMain.handle('load-watched', () => store.get('watchedVideos', []));
ipcMain.handle('save-watched', (e, watched) => {
  store.set('watchedVideos', watched);
  return true;
});
ipcMain.handle('load-positions', () => store.get('positions', {}));
ipcMain.handle('save-position', (e, { videoPath, position }) => {
  const positions = store.get('positions', {});
  positions[videoPath] = position;
  store.set('positions', positions);
  return true;
});
ipcMain.handle('clear-positions', (e, videoPaths) => {
  const positions = store.get('positions', {});
  for (const p of videoPaths) delete positions[p];
  store.set('positions', positions);
  return true;
});

ipcMain.handle('load-annotations', () => store.get('videoAnnotations', {}));
ipcMain.handle('save-annotations', (e, annotations) => {
  store.set('videoAnnotations', annotations);
  return true;
});

// =========================
// IPC handlers (IPTV)
// =========================

ipcMain.handle('iptv-validate-login', async (e, payload) => {
  try {
    const result = await validateIptvLogin(payload || {});
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error?.message || 'Falha no login IPTV.' };
  }
});

ipcMain.handle('iptv-load-channels', async (e, params) => {
  const offset = Number(params?.offset || 0);
  const shouldReportProgress = Number.isFinite(offset) && offset === 0;
  const reportProgress = shouldReportProgress
    ? (payload) => {
      if (!e?.sender || e.sender.isDestroyed()) return;
      e.sender.send('iptv-download-progress', {
        stage: String(payload?.stage || ''),
        receivedBytes: Number(payload?.receivedBytes || 0),
        totalBytes: Number(payload?.totalBytes || 0),
        speedBps: Number(payload?.speedBps || 0),
        done: Boolean(payload?.done),
      });
    }
    : null;

  try {
    const result = await loadIptvChannels(params || {}, { reportProgress });
    reportProgress?.({ stage: 'complete', done: true });
    return { ok: true, ...result };
  } catch (error) {
    reportProgress?.({ stage: 'error', done: true });
    return { ok: false, error: error?.message || 'Falha ao carregar canais IPTV.' };
  }
});

ipcMain.handle('iptv-get-synopsis', async (e, payload) => {
  try {
    const channel = payload?.channel || {};
    const result = await resolveSynopsisForChannel(channel);
    return {
      ok: true,
      synopsis: result?.text || '',
      year: result?.year || '',
      rating: Number.isFinite(result?.rating) ? result.rating : null,
      posterUrl: result?.posterUrl || '',
      source: result?.source || '',
      reason: result?.reason || '',
    };
  } catch (error) {
    return {
      ok: false,
      synopsis: '',
      year: '',
      rating: null,
      posterUrl: '',
      source: '',
      reason: 'request_error',
      error: error?.message || 'Falha ao carregar sinopse.',
    };
  }
});

ipcMain.handle('iptv-get-tmdb-key-status', () => {
  const apiKey = String(getTmdbApiKey() || '').trim();
  return { ok: true, hasKey: Boolean(apiKey) };
});

ipcMain.handle('iptv-set-tmdb-key', (e, payload) => {
  try {
    const apiKey = String(payload?.apiKey || '').trim();
    if (!apiKey) {
      return { ok: false, error: 'Informe uma chave TMDB válida.' };
    }
    store.set('tmdb_api_key', apiKey);
    cachedTmdbApiKey = apiKey;
    process.env.TMDB_API_KEY = apiKey;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Falha ao salvar chave TMDB.' };
  }
});

ipcMain.handle('iptv-cache-logo', async (e, logoUrl) => {
  try {
    const logoPath = await cacheIptvLogoLocally(logoUrl);
    return { ok: true, logoPath };
  } catch {
    return { ok: false, logoPath: String(logoUrl || '') };
  }
});

ipcMain.handle('iptv-has-local-playlist', () => {
  try {
    if (!fs.existsSync(LOCAL_PLAYLIST_PATH)) return { ok: true, hasPlaylist: false };
    const stat = fs.statSync(LOCAL_PLAYLIST_PATH);
    return { ok: true, hasPlaylist: stat.isFile() && stat.size > 0 };
  } catch (error) {
    return { ok: false, hasPlaylist: false, error: error?.message || 'Falha ao verificar playlist local.' };
  }
});

ipcMain.handle('iptv-clear-cache', () => {
  try {
    clearIptvMemoryCaches();
    clearDirContentsSafe(PROJECT_CACHE_DIR);
    ensureProjectCacheDirs();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Falha ao limpar cache.' };
  }
});

ipcMain.handle('iptv-delete-local-playlist', () => {
  try {
    clearIptvMemoryCaches();
    ensureDirSafe(PLAYLIST_CACHE_DIR, 'playlist cache directory');
    const removed = removeFileIfExists(LOCAL_PLAYLIST_PATH);
    return { ok: true, removed };
  } catch (error) {
    return { ok: false, error: error?.message || 'Falha ao remover playlist local.' };
  }
});

ipcMain.handle('iptv-clear-all', () => {
  try {
    clearIptvMemoryCaches();
    store.clear();
    removeFileIfExists(metaPath);
    removeFileIfExists(path.join(app.getPath('userData'), 'config.json'));
    clearDirContentsSafe(PROJECT_CACHE_DIR);
    ensureProjectCacheDirs();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || 'Falha ao limpar dados do aplicativo.' };
  }
});

ipcMain.handle('iptv-exit-app', () => {
  app.quit();
  return { ok: true };
});

// =========================
// Thumbnail generation
// =========================

function processDirectoryRecursive(dirPath, exts, callback) {
  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return;
  }

  for (const file of files) {
    const fullPath = path.join(dirPath, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      processDirectoryRecursive(fullPath, exts, callback);
    } else if (exts.includes(path.extname(file).toLowerCase())) {
      callback(fullPath, file);
    }
  }
}

ipcMain.handle('generate-thumbnails', async (e, folders) => {
  const exts = ['.mp4', '.avi', '.mkv', '.mov', '.webm', '.wmv', '.flv'];
  let totalVideos = 0;
  let processedVideos = 0;

  for (const f of folders) {
    processDirectoryRecursive(f.path, exts, () => totalVideos++);
  }

  for (const f of folders) {
    processDirectoryRecursive(f.path, exts, async (videoPath, fileName) => {
      const safeName = fileName.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.jpg';
      const thumbPath = path.join(thumbsDir, safeName);

      if (!fs.existsSync(thumbPath)) {
        try {
          await new Promise((resolve, reject) => {
            const ff = spawn(ffmpegPath, ['-y', '-i', videoPath, '-ss', '00:00:01', '-frames:v', '1', thumbPath]);
            ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
            ff.on('error', reject);
          });
        } catch (error) {
          console.error('Error generating thumbnail for:', videoPath, error);
        }
      }

      processedVideos += 1;
      e.sender.send('thumbnail-progress', { processed: processedVideos, total: totalVideos });
    });
  }

  return { success: true, total: totalVideos, processed: processedVideos };
});
