// main.js
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');
const Store   = require('electron-store');
const store   = new Store();

// FFmpeg fora do ASAR
function getBinPath(...segments) {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', ...segments)
    : path.join(__dirname, 'bin', ...segments);
}
const ffmpegPath = getBinPath(
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
);

// Pasta de thumbs em userData
const thumbsDir = path.join(app.getPath('userData'), 'thumbs');

// Caminho de meta do app (separado do electron-store para evitar conflitos)
const metaPath = path.join(app.getPath('userData'), 'user-meta.json');

// Cria janela e carrega HTML
function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  const indexPath = path.join(app.getAppPath(), 'public', 'index.html');
  win.loadFile(indexPath).catch(err => {
    console.error('Erro ao carregar index.html:', err);
    dialog.showErrorBox('Erro', `Falha ao carregar interface:\n${err.message}`);
  });
}

app.whenReady().then(() => {
  if (!fs.existsSync(thumbsDir)) fs.mkdirSync(thumbsDir, { recursive: true });
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate',   () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// --- IPC Handlers ---

// Ler config de meta (separado do electron-store). Fallback para antigo config.json se existir
ipcMain.handle('load-config', () => {
  const legacyCfgPath = path.join(app.getPath('userData'), 'config.json'); // usado por electron-store por padrão
  try {
    if (fs.existsSync(metaPath)) {
      const cfg = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      return cfg || {};
    }
    // Fallback de migração: tentar ler legado (pode conter videoOrders salvo manualmente)
    if (fs.existsSync(legacyCfgPath)) {
      const legacy = JSON.parse(fs.readFileSync(legacyCfgPath, 'utf8'));
      // Apenas retornar campos relevantes caso existam
      return {
        folders: legacy.folders || [],
        watchedVideos: legacy.watchedVideos || [],
        videoOrders: legacy.videoOrders || {}
      };
    }
  } catch (e) {
    console.warn('Falha ao ler config/meta:', e);
  }
  return {};
});

// Salvar config/meta em arquivo separado para não conflitar com electron-store
ipcMain.handle('save-config', (e, cfg) => {
  try {
    fs.writeFileSync(metaPath, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error('Erro ao salvar user-meta.json:', err);
    return false;
  }
});

// Expor thumbsDir
ipcMain.handle('get-thumbs-path', () => thumbsDir);

// Selecionar pasta
ipcMain.handle('select-folder', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return res.canceled ? null : res.filePaths[0];
});

// Electron-store (playlists, watched, positions)
ipcMain.handle('load-folders',  () => store.get('folders', []));
ipcMain.handle('save-folders', (e, folders) => { store.set('folders', folders); return true; });
ipcMain.handle('load-watched',  () => store.get('watchedVideos', []));
ipcMain.handle('save-watched', (e, watched) => { store.set('watchedVideos', watched); return true; });
ipcMain.handle('load-positions',() => store.get('positions', {}));
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

// Handlers para anotações de vídeos
ipcMain.handle('load-annotations', () => store.get('videoAnnotations', {}));
ipcMain.handle('save-annotations', (e, annotations) => {
  store.set('videoAnnotations', annotations);
  return true;
});

// Gerar thumbnails
ipcMain.handle('generate-thumbnails', async (e, folders) => {
  const exts = ['.mp4','.avi','.mkv','.mov','.webm','.wmv','.flv'];
  for (const f of folders) {
    let files;
    try { files = fs.readdirSync(f.path); } catch { continue; }
    for (const file of files) {
      if (!exts.includes(path.extname(file).toLowerCase())) continue;
      const vp = path.join(f.path, file);
      const safeName = file.replace(/[^a-z0-9]/gi,'_').toLowerCase()+'.jpg';
      const tp = path.join(thumbsDir, safeName);
      if (fs.existsSync(tp)) continue;
      await new Promise((res, rej) => {
        const ff = spawn(ffmpegPath, ['-y','-i',vp,'-ss','00:00:01','-frames:v','1',tp]);
        ff.on('close', code => code===0 ? res() : rej());
      });
    }
  }
  return true;
});
