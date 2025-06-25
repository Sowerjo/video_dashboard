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

// Ler config.json manualmente
ipcMain.handle('load-config', () => {
  const cfgPath = path.join(app.getPath('userData'), 'config.json');
  if (!fs.existsSync(cfgPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return {};
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
