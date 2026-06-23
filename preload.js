const { contextBridge, ipcRenderer } = require('electron');

const INVOKE_CHANNELS = new Set([
  'chromecast-cast',
  'chromecast-discover',
  'chromecast-pause',
  'chromecast-resume',
  'chromecast-seek',
  'chromecast-status-request',
  'chromecast-stop',
  'chromecast-volume',
  'clear-positions',
  'generate-thumbnails',
  'get-thumbs-path',
  'iptv-add-item-to-custom-playlist',
  'iptv-block-category',
  'iptv-cache-logo',
  'iptv-clear-all',
  'iptv-clear-cache',
  'iptv-create-custom-playlist',
  'iptv-delete-local-playlist',
  'iptv-exit-app',
  'iptv-get-blocked-categories',
  'iptv-get-custom-playlists',
  'iptv-get-fullscreen-state',
  'iptv-get-last-episodes',
  'iptv-get-synopsis',
  'iptv-get-tmdb-key-status',
  'iptv-has-local-playlist',
  'iptv-load-channels',
  'iptv-open-external-player',
  'iptv-remove-custom-playlist',
  'iptv-remove-item-from-custom-playlist',
  'iptv-set-last-episode',
  'iptv-set-tmdb-key',
  'iptv-toggle-fullscreen',
  'iptv-unblock-category',
  'iptv-validate-login',
  'load-annotations',
  'load-config',
  'load-folders',
  'load-positions',
  'load-watched',
  'save-annotations',
  'save-config',
  'save-folders',
  'save-position',
  'save-watched',
  'scan-video-folder',
  'select-folder',
]);

const EVENT_CHANNELS = new Set([
  'chromecast-status',
  'iptv-download-progress',
  'thumbnail-progress',
]);

contextBridge.exposeInMainWorld('desktopApi', {
  invoke(channel, ...args) {
    if (!INVOKE_CHANNELS.has(channel)) {
      return Promise.reject(new Error(`Canal IPC não permitido: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  on(channel, listener) {
    if (!EVENT_CHANNELS.has(channel) || typeof listener !== 'function') {
      throw new Error(`Evento IPC não permitido: ${channel}`);
    }
    const wrappedListener = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, wrappedListener);
    return () => ipcRenderer.removeListener(channel, wrappedListener);
  },
});
