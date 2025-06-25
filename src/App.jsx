// src/App.jsx
import React, { useState, useEffect } from "react";
import Dashboard from "./Dashboard";
import { ThemeProvider } from "styled-components";
import {
  AddButton,
  TopBar,
  AppContainer,
  ModalOverlay,
  Modal,
  ModalInput,
  CloseButton
} from "./styles";

const { ipcRenderer } = window.require("electron");
const fs             = window.require("fs");
const path           = window.require("path");

const VIDEO_EXTS = ['.mp4','.avi','.mkv','.mov','.webm','.wmv','.flv'];

function scanFolder(folderPath, thumbsDir) {
  const result = { videos: [], subfolders: [] };
  for (const file of fs.readdirSync(folderPath)) {
    const full = path.join(folderPath, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      const sub = scanFolder(full, thumbsDir);
      if (sub.videos.length || sub.subfolders.length) {
        result.subfolders.push({
          path: full,
          nome: file,
          videos: sub.videos,
          subfolders: sub.subfolders
        });
      }
    } else if (VIDEO_EXTS.includes(path.extname(file).toLowerCase())) {
      const safeName = file.replace(/[^a-z0-9]/gi,'_').toLowerCase() + '.jpg';
      const thumbPath = path.join(thumbsDir, safeName);
      const thumbURL  = fs.existsSync(thumbPath) ? `file://${thumbPath}` : null;
      result.videos.push({ path: full, nome: file, thumb: thumbURL });
    }
  }
  return result;
}

const themes = {
  dark:  { bg:"#000", card:"#111", text:"#fff", neon:"#ff0000", shadow:"#550000" },
  light: { bg:"#fff", card:"#eee", text:"#000", neon:"#ff0000", shadow:"#aaa" }
};

export default function App() {
  const [thumbsDir, setThumbsDir] = useState("");
  const [folders, setFolders]     = useState([]);
  const [watched, setWatched]     = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState({ tipo:'', nome:'', ano:'', path:'' });
  const [theme, setTheme]         = useState(localStorage.getItem('theme') || 'dark');

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);

  // 1) Leitura direta do config.json
  useEffect(() => {
    async function loadConfig() {
      const cfg = await ipcRenderer.invoke('load-config');
      if (cfg.folders) setFolders(cfg.folders);
      if (cfg.watchedVideos) setWatched(cfg.watchedVideos);
    }
    loadConfig();
  }, []);

  // 2) Pega thumbsDir
  useEffect(() => {
    ipcRenderer.invoke('get-thumbs-path')
      .then(dir => setThumbsDir(dir))
      .catch(console.error);
  }, []);

  // 3) Gera thumbs e faz scan (mantendo o que já veio do config)
  useEffect(() => {
    if (!thumbsDir || folders.length === 0) return;
    async function doThumbs() {
      await ipcRenderer.invoke('generate-thumbnails', folders);
      setFolders(prev =>
        prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }))
      );
    }
    doThumbs();
  }, [thumbsDir, folders]);

  // 4) Persistência
  useEffect(() => { ipcRenderer.invoke('save-folders', folders); }, [folders]);
  useEffect(() => { ipcRenderer.invoke('save-watched', watched); }, [watched]);

  // Handlers (iguais aos anteriores)...
  const handleRefresh = () => {
    ipcRenderer.invoke('generate-thumbnails', folders)
      .then(() => {
        setFolders(prev =>
          prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }))
        );
      });
  };
  const openModal = async () => {
    const p = await ipcRenderer.invoke('select-folder');
    if (!p) return;
    setForm({ tipo:'', nome:path.basename(p), ano:'', path:p });
    setModalOpen(true);
  };
  const handleSubmit = e => {
    e.preventDefault();
    const data = scanFolder(form.path, thumbsDir);
    setFolders(prev => [...prev, { ...form, ...data }]);
    setModalOpen(false);
  };
  const handleImport = async e => {
    const txt = await e.target.files[0].text();
    try { setFolders(JSON.parse(txt)); }
    catch { alert("JSON inválido"); }
  };
  const handleExport = () => {
    const blob = new Blob([JSON.stringify(folders,null,2)],{type:"application/json"});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download="meus_cursos.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const handleDeleteFolder = idx =>
    setFolders(prev => prev.filter((_,i)=>i!==idx));
  const handleWatchedToggle = videoPath =>
    setWatched(prev => prev.includes(videoPath) ? prev : [...prev, videoPath]);
  const handleClearWatched = async folderObj => {
    const vids = folderObj.videos.map(v=>v.path);
    setWatched(prev => prev.filter(p=>!vids.includes(p)));
    await ipcRenderer.invoke('clear-positions', vids);
  };

  return (
    <ThemeProvider theme={themes[theme]}>
      <AppContainer>
        <TopBar>
          <AddButton onClick={openModal}>Adicionar Pasta +</AddButton>
          <AddButton onClick={handleRefresh}>Atualizar</AddButton>
          <AddButton as="label">
            Importar<input type="file" accept="application/json" onChange={handleImport} style={{display:'none'}}/>
          </AddButton>
          <AddButton onClick={handleExport}>Exportar</AddButton>
        </TopBar>

        <Dashboard
          folders={folders}
          watched={watched}
          onWatchedToggle={handleWatchedToggle}
          onClearWatched={handleClearWatched}
          onDeleteFolder={handleDeleteFolder}
        />

        {modalOpen && (
          <ModalOverlay>
            <Modal>
              <CloseButton onClick={()=>setModalOpen(false)}>×</CloseButton>
              <form onSubmit={handleSubmit}>
                <label>Tipo:</label>
                <ModalInput required value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}/>
                <label>Nome:</label>
                <ModalInput required value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/>
                <label>Ano:</label>
                <ModalInput required type="number" value={form.ano} onChange={e=>setForm({...form,ano:e.target.value})}/>
                <button type="submit" style={{
                  marginTop:16,padding:"10px 28px",
                  background:"#ff0000",borderRadius:10,
                  fontWeight:"bold",border:"none",color:"#000"
                }}>Adicionar</button>
              </form>
            </Modal>
          </ModalOverlay>
        )}
      </AppContainer>
    </ThemeProvider>
  );
}
