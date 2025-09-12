// src/App.jsx
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import Dashboard from "./Dashboard";
import { ThemeProvider } from "styled-components";
import {
  AddButton,
  TopBar,
  AppContainer,
  ModalOverlay,
  Modal,
  ModalInput,
  CloseButton,
  BackgroundLayer,
  VignetteOverlay,
  LogoOverlay
} from "./styles";
import { FaBars, FaPlus, FaSync, FaFileImport, FaFileExport } from "react-icons/fa";

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

// util: reordena lista
const reorder = (list, startIndex, endIndex) => {
  const result = [...list];
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
};

// util: aplica ordem customizada de vídeos a um array de vídeos
const sortVideosByOrder = (videos, orderArr = []) => {
  if (!Array.isArray(videos) || videos.length === 0) return videos;
  if (!Array.isArray(orderArr) || orderArr.length === 0) return videos;
  const idx = new Map(orderArr.map((p, i) => [p, i]));
  const present = videos.filter(v => idx.has(v.path)).sort((a, b) => idx.get(a.path) - idx.get(b.path));
  const missing = videos.filter(v => !idx.has(v.path));
  return [...present, ...missing];
};

// util: aplica ordem de vídeos recursivamente por path
const applyVideoOrdersRec = (folder, ordersMap) => {
  const curOrder = ordersMap[folder.path];
  const newVideos = sortVideosByOrder(folder.videos || [], curOrder);
  const newSubs = (folder.subfolders || []).map(sf => applyVideoOrdersRec(sf, ordersMap));
  return { ...folder, videos: newVideos, subfolders: newSubs };
};

// util: atualiza uma pasta específica (por path) na árvore
const updateFolderByPath = (folder, targetPath, updater) => {
  if (folder.path === targetPath) return updater(folder);
  const subs = folder.subfolders || [];
  if (subs.length === 0) return folder;
  return { ...folder, subfolders: subs.map(sf => updateFolderByPath(sf, targetPath, updater)) };
};

export default function App() {
  const [thumbsDir, setThumbsDir] = useState("");
  const [folders, setFolders]     = useState([]);
  const [watched, setWatched]     = useState([]);
  const [videoOrders, setVideoOrders] = useState({}); // { [folderPath]: [videoPath, ...] }
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState({ tipo:'', nome:'', ano:'', path:'' });
  const [theme, setTheme]         = useState(localStorage.getItem('theme') || 'dark');
  const [isReordering, setIsReordering] = useState(false);
  // Estado para controlar o menu hambúrguer
  const [showMenu, setShowMenu] = useState(false);

  // Fechar menu ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showMenu && !event.target.closest('.hamburger-menu')) {
        setShowMenu(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  useEffect(() => { localStorage.setItem('theme', theme); }, [theme]);

  // 1) Leitura direta do config.json
  useEffect(() => {
    async function loadConfig() {
      const cfg = await ipcRenderer.invoke('load-config');
      if (cfg.folders) setFolders(cfg.folders);
      if (cfg.watchedVideos) setWatched(cfg.watchedVideos);
      if (cfg.videoOrders) setVideoOrders(cfg.videoOrders);
    }
    loadConfig();
  }, []);

  // 2) Pega thumbsDir
  useEffect(() => {
    ipcRenderer.invoke('get-thumbs-path')
      .then(dir => setThumbsDir(dir))
      .catch(console.error);
  }, []);

  // 3) Gera thumbs e faz scan (mantendo o que já veio do config) e aplica ordem customizada de vídeos
  useEffect(() => {
    if (!thumbsDir || folders.length === 0) return;
    if (isReordering) return; // evitar sobrescrever enquanto houver reordenação
    async function doThumbs() {
      await ipcRenderer.invoke('generate-thumbnails', folders);
      setFolders(prev => {
        const scanned = prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }));
        // aplica ordem customizada de vídeos recursivamente
        return scanned.map(f => applyVideoOrdersRec(f, videoOrders));
      });
    }
    doThumbs();
  }, [thumbsDir, /* aplica novamente quando ordem mudar */ videoOrders, isReordering]);

  // 4) Persistência
  useEffect(() => { ipcRenderer.invoke('save-folders', folders); }, [folders]);
  useEffect(() => { ipcRenderer.invoke('save-watched', watched); }, [watched]);
  // Salva config.json preferencialmente (ordem customizada e demais dados)
  useEffect(() => {
    ipcRenderer.invoke('save-config', { folders, watchedVideos: watched, videoOrders });
  }, [folders, watched, videoOrders]);

  // Handlers... (mantidos)
  const handleRefresh = () => {
    ipcRenderer.invoke('generate-thumbnails', folders)
      .then(() => {
        setFolders(prev => {
          const scanned = prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }));
          return scanned.map(f => applyVideoOrdersRec(f, videoOrders));
        });
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

  // NOVO: Reordenar pastas (playlists)
  const handleReorderFolders = (from, to) => {
    if (from === to) return;
    setFolders(prev => reorder(prev, from, to));
  };

  // NOVO: Reordenar subpastas dentro de uma pasta específica
  const handleReorderSubfolders = (folderPath, from, to) => {
    if (from === to) return;
    setFolders(prev => prev.map(f => updateFolderByPath(f, folderPath, (folder) => {
      const newSubs = reorder(folder.subfolders || [], from, to);
      return { ...folder, subfolders: newSubs };
    })));
  };

  // NOVO: Reordenar vídeos dentro de uma pasta (ou subpasta) por path da pasta
  const handleReorderVideos = (folderPath, from, to) => {
    setIsReordering(true);
    setFolders(prev => prev.map(f => updateFolderByPath(f, folderPath, (folder) => {
      const newVideos = reorder(folder.videos || [], from, to);
      // atualiza orders map
      setVideoOrders(vo => ({ ...vo, [folderPath]: newVideos.map(v => v.path) }));
      return { ...folder, videos: newVideos };
    })));
    // libera flag na próxima volta do event loop
    setTimeout(()=> setIsReordering(false), 0);
  };

  // NOVO: Resetar ordem por playlist (voltar ao sistema de arquivos)
  const handleResetOrder = (folderPath) => {
    setIsReordering(true);
    // remove ordem customizada de vídeos desta pasta
    setVideoOrders(vo => {
      const copy = { ...vo };
      delete copy[folderPath];
      return copy;
    });
    // re-scaneia esta pasta para restaurar ordem padrão de vídeos e subpastas
    setFolders(prev => prev.map(f => updateFolderByPath(f, folderPath, (folder) => {
      const scanned = scanFolder(folder.path, thumbsDir);
      return { ...folder, videos: scanned.videos, subfolders: scanned.subfolders };
    })));
    setTimeout(()=> setIsReordering(false), 0);
  };

  return (
    <ThemeProvider theme={themes[theme]}>
      {/* Camadas de fundo e vinheta */}
      <BackgroundLayer />
      <VignetteOverlay />
      {/* Logo fixo no topo */}
      <LogoOverlay src={"topo.png"} alt="Logo" />
      <AppContainer>
        <TopBar style={{
          background: "transparent",
          border: "none",
          boxShadow: "none",
          padding: 0,
          margin: 0,
          position: "relative"
        }}>
          {/* Menu Hambúrguer */}
          <div className="hamburger-menu" style={{ 
            position: "absolute",
            top: "20px",
            left: "20px",
            zIndex: 999999
          }}>
            <button
              onClick={() => setShowMenu(!showMenu)}
              style={{
                background: "rgba(26, 26, 26, 0.9)",
                border: "2px solid #ff0000",
                color: "#ff0000",
                padding: "12px",
                borderRadius: "8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.3s ease",
                boxShadow: showMenu ? "0 0 15px #ff000066" : "0 0 8px #ff000033",
                backdropFilter: "blur(10px)"
              }}
              title="Menu de Ações"
            >
              <FaBars size={18} />
            </button>
            
            {/* Dropdown Menu */}
            {showMenu && createPortal(
              <div className="hamburger-menu" style={{
                position: "fixed",
                top: "72px",
                left: "20px",
                background: "rgba(26, 26, 26, 0.95)",
                border: "2px solid #ff0000",
                borderRadius: "12px",
                boxShadow: "0 8px 25px rgba(255, 0, 0, 0.4)",
                zIndex: 2147483647,
                minWidth: "200px",
                overflow: "hidden",
                backdropFilter: "blur(15px)"
              }}>
                <div style={{
                  padding: "8px 0"
                }}>
                  <button
                    onClick={() => { openModal(); setShowMenu(false); }}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      color: "#fff",
                      padding: "12px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      fontSize: "14px",
                      transition: "background 0.2s ease"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#ff000020"}
                    onMouseLeave={(e) => e.target.style.background = "transparent"}
                  >
                    <FaPlus size={14} color="#ff0000" />
                    Adicionar Pasta
                  </button>
                  
                  <button
                    onClick={() => { handleRefresh(); setShowMenu(false); }}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      color: "#fff",
                      padding: "12px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      fontSize: "14px",
                      transition: "background 0.2s ease"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#ff000020"}
                    onMouseLeave={(e) => e.target.style.background = "transparent"}
                  >
                    <FaSync size={14} color="#ff0000" />
                    Atualizar
                  </button>
                  
                  <label style={{
                    width: "100%",
                    background: "transparent",
                    border: "none",
                    color: "#fff",
                    padding: "12px 16px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "14px",
                    transition: "background 0.2s ease"
                  }}
                    onMouseEnter={(e) => e.target.style.background = "#ff000020"}
                    onMouseLeave={(e) => e.target.style.background = "transparent"}
                  >
                    <FaFileImport size={14} color="#ff0000" />
                    Importar
                    <input 
                      type="file" 
                      accept="application/json" 
                      onChange={(e) => { handleImport(e); setShowMenu(false); }} 
                      style={{display:'none'}}
                    />
                  </label>
                  
                  <button
                    onClick={() => { handleExport(); setShowMenu(false); }}
                    style={{
                      width: "100%",
                      background: "transparent",
                      border: "none",
                      color: "#fff",
                      padding: "12px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      fontSize: "14px",
                      transition: "background 0.2s ease"
                    }}
                    onMouseEnter={(e) => e.target.style.background = "#ff000020"}
                    onMouseLeave={(e) => e.target.style.background = "transparent"}
                  >
                    <FaFileExport size={14} color="#ff0000" />
                    Exportar
                  </button>
                </div>
              </div>,
              document.body
            )}
          </div>
        </TopBar>

        <Dashboard
          folders={folders}
          watched={watched}
          onWatchedToggle={handleWatchedToggle}
          onClearWatched={handleClearWatched}
          onDeleteFolder={handleDeleteFolder}
          onReorderFolders={handleReorderFolders}
          onReorderVideos={handleReorderVideos}
          onReorderSubfolders={handleReorderSubfolders}
          onResetOrder={handleResetOrder}
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
