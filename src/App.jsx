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
const { pathToFileURL } = window.require("url");

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
      const thumbURL  = fs.existsSync(thumbPath) ? pathToFileURL(thumbPath).href : null;
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

// util: aplica ordem customizada de subpastas a um array de subpastas
const sortSubfoldersByOrder = (subfolders, orderArr = []) => {
  if (!orderArr.length) return subfolders;
  const ordered = [];
  const remaining = [...subfolders];
  
  orderArr.forEach(path => {
    const idx = remaining.findIndex(sf => sf.path === path);
    if (idx >= 0) ordered.push(remaining.splice(idx, 1)[0]);
  });
  
  return [...ordered, ...remaining];
};

// util: aplica ordem de vídeos recursivamente por path
const applyVideoOrdersRec = (folder, ordersMap, subOrdersMap = {}) => {
  const curOrder = ordersMap[folder.path];
  const newVideos = sortVideosByOrder(folder.videos || [], curOrder);
  const sortedSubs = sortSubfoldersByOrder(folder.subfolders || [], subOrdersMap[folder.path]);
  const newSubs = sortedSubs.map(sf => applyVideoOrdersRec(sf, ordersMap, subOrdersMap));
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
  const [subfolderOrders, setSubfolderOrders] = useState({}); // { [folderPath]: [subfolderPath, ...] }
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState({ tipo:'', nome:'', ano:'', path:'' });
  const [theme, setTheme]         = useState(localStorage.getItem('theme') || 'dark');
  const [isReordering, setIsReordering] = useState(false);
  // Estado para controlar o menu hambúrguer
  const [showMenu, setShowMenu] = useState(false);
  // Estados para feedback visual de geração de thumbnails
  const [isGeneratingThumbs, setIsGeneratingThumbs] = useState(false);
  const [thumbProgress, setThumbProgress] = useState({ processed: 0, total: 0 });

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

  // Listener para progresso de thumbnails
  useEffect(() => {
    const handleThumbProgress = (event, data) => {
      setThumbProgress(data);
      if (data.processed >= data.total) {
        setTimeout(() => {
          setIsGeneratingThumbs(false);
          setThumbProgress({ processed: 0, total: 0 });
        }, 1000); // Mostra 100% por 1 segundo antes de esconder
      }
    };

    ipcRenderer.on('thumbnail-progress', handleThumbProgress);
    return () => ipcRenderer.removeListener('thumbnail-progress', handleThumbProgress);
  }, []);

  // 1) Leitura direta do config.json
  useEffect(() => {
    async function loadConfig() {
      const cfg = await ipcRenderer.invoke('load-config');
      if (cfg.folders) setFolders(cfg.folders);
      if (cfg.watchedVideos) setWatched(cfg.watchedVideos);
      if (cfg.videoOrders) setVideoOrders(cfg.videoOrders);
      if (cfg.subfolderOrders) setSubfolderOrders(cfg.subfolderOrders);
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
      setIsGeneratingThumbs(true);
      setThumbProgress({ processed: 0, total: 0 });
      
      try {
        const result = await ipcRenderer.invoke('generate-thumbnails', folders);
        console.log('Thumbnail generation completed:', result);
        
        // Atualiza a UI após a geração
        setFolders(prev => {
          const scanned = prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }));
          // aplica ordem customizada de vídeos e subpastas recursivamente
          return scanned.map(f => applyVideoOrdersRec(f, videoOrders, subfolderOrders));
        });
      } catch (error) {
        console.error('Error generating thumbnails:', error);
        setIsGeneratingThumbs(false);
        setThumbProgress({ processed: 0, total: 0 });
      }
    }
    doThumbs();
  }, [thumbsDir, /* aplica novamente quando ordem mudar */ videoOrders, subfolderOrders, isReordering]);

  // 4) Persistência
  useEffect(() => { ipcRenderer.invoke('save-folders', folders); }, [folders]);
  useEffect(() => { ipcRenderer.invoke('save-watched', watched); }, [watched]);
  useEffect(() => { ipcRenderer.invoke('save-config', { videoOrders, subfolderOrders }); }, [videoOrders, subfolderOrders]);
  // Salva config.json preferencialmente (ordem customizada e demais dados)
  useEffect(() => {
    ipcRenderer.invoke('save-config', { folders, watchedVideos: watched, videoOrders, subfolderOrders });
  }, [folders, watched, videoOrders, subfolderOrders]);

  // Handlers... (mantidos)
  const handleRefresh = () => {
    ipcRenderer.invoke('generate-thumbnails', folders)
      .then(() => {
        setFolders(prev => {
          const scanned = prev.map(f => ({ ...f, ...scanFolder(f.path, thumbsDir) }));
          return scanned.map(f => applyVideoOrdersRec(f, videoOrders, subfolderOrders));
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

      // atualiza orders map das subpastas
      setSubfolderOrders(so => ({ ...so, [folderPath]: newSubs.map(sf => sf.path) }));
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
        
        {/* Feedback visual para geração de thumbnails */}
        {isGeneratingThumbs && (
          <div style={{
            position: "fixed",
            top: "20px",
            right: "20px",
            background: "linear-gradient(145deg, #1a1a1a, #0d0d0d)",
            border: "2px solid #ff0000",
            borderRadius: "12px",
            padding: "16px 20px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 20px #ff000055",
            backdropFilter: "blur(10px)",
            zIndex: 10000,
            minWidth: "280px",
            color: "#fff"
          }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "12px",
              gap: "10px"
            }}>
              <div style={{
                width: "20px",
                height: "20px",
                border: "2px solid #ff0000",
                borderTop: "2px solid transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite"
              }} />
              <span style={{
                fontWeight: "600",
                fontSize: "14px",
                color: "#ff0000"
              }}>Gerando Thumbnails...</span>
            </div>
            
            {thumbProgress.total > 0 && (
              <>
                <div style={{
                  background: "#333",
                  borderRadius: "8px",
                  height: "8px",
                  overflow: "hidden",
                  marginBottom: "8px"
                }}>
                  <div style={{
                    background: "linear-gradient(90deg, #ff0000, #ff4444)",
                    height: "100%",
                    width: `${(thumbProgress.processed / thumbProgress.total) * 100}%`,
                    transition: "width 0.3s ease",
                    borderRadius: "8px"
                  }} />
                </div>
                <div style={{
                  fontSize: "12px",
                  color: "#ccc",
                  textAlign: "center"
                }}>
                  {thumbProgress.processed} de {thumbProgress.total} vídeos processados
                </div>
              </>
            )}
          </div>
        )}
        
        {/* CSS para animação de loading */}
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </AppContainer>
    </ThemeProvider>
  );
}
