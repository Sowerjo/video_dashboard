import React, { useState, useEffect, useRef } from "react";
import FolderTile from "./FolderTile";
import {
  DashboardContainer,
  VideosContainer,
  ModalOverlay,
  Modal,
  CloseButton,
  VideoName
} from "./styles";
import { FaTrashAlt, FaExpandAlt, FaFolder, FaCheck, FaBan, FaUndo, FaPlus, FaEdit, FaTimes, FaStickyNote } from "react-icons/fa";

const { ipcRenderer } = window.require("electron");

const Dashboard = ({
  folders,
  watched,
  onWatchedToggle,
  onClearWatched,
  onDeleteFolder,
  onReorderFolders,
  onReorderVideos,
  onReorderSubfolders,
  onResetOrder
}) => {
  const [expanded, setExpanded]           = useState(null);
  const [subfolderOpen, setSubfolderOpen] = useState(null);
  const [fullscreen, setFullscreen]       = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [fullscreenVideoNome, setFullscreenVideoNome] = useState("");
  const [positions, setPositions]         = useState({});
  // NOVO: estado para anotações dos vídeos
  const [videoAnnotations, setVideoAnnotations] = useState({});
  // Estados para interface de anotações
  const [showAnnotations, setShowAnnotations] = useState(false); // Sempre começa oculta
  const [editingAnnotation, setEditingAnnotation] = useState(null);
  const [newAnnotationText, setNewAnnotationText] = useState("");
  const [newAnnotationTopic, setNewAnnotationTopic] = useState("");
  // Estado para throttling do salvamento de posição
  const [lastSaveTime, setLastSaveTime] = useState(0);
  const savePositionRef = useRef(null);
  const fullscreenVideoRef                = useRef();
  const loadedPanelsRef                   = useRef({});

  // Drag state
  const [dragFolderIdx, setDragFolderIdx] = useState(null);
  // NOVO: estados para reordenação visual de playlists
  const [displayFolders, setDisplayFolders] = useState(null);
  const [dragFolderOriginIdx, setDragFolderOriginIdx] = useState(null);
  const [dragFolderHoverIdx, setDragFolderHoverIdx] = useState(null);
  const [ghostFolderIdx, setGhostFolderIdx] = useState(null);
  // NOVO: estados para reordenação visual de vídeos
  const [draggingVideoFolderPath, setDraggingVideoFolderPath] = useState(null);
  const [tempVideos, setTempVideos] = useState([]);
  const [dragVideoOriginIndex, setDragVideoOriginIndex] = useState(null);
  const [dragVideoHoverIndex, setDragVideoHoverIndex] = useState(null);
  const [dragVideoPath, setDragVideoPath] = useState(null);
  const [ghostVideoIndex, setGhostVideoIndex] = useState(null);
  // NOVO: estados para reordenação de subpastas
  const [draggingSubFolderParentPath, setDraggingSubFolderParentPath] = useState(null);
  const [tempSubfolders, setTempSubfolders] = useState([]);
  const [dragSubOriginIdx, setDragSubOriginIdx] = useState(null);
  const [dragSubHoverIdx, setDragSubHoverIdx] = useState(null);
  const [ghostSubIdx, setGhostSubIdx] = useState(null);

  // Função para salvar posição com throttling
  const savePositionThrottled = (videoPath, position) => {
    const now = Date.now();
    
    // Limpa timeout anterior se existir
    if (savePositionRef.current) {
      clearTimeout(savePositionRef.current);
    }
    
    // Salva imediatamente se passou mais de 8 segundos desde o último salvamento
    if (now - lastSaveTime > 8000) {
      ipcRenderer.invoke("save-position", { videoPath, position });
      setPositions(p => ({ ...p, [videoPath]: position }));
      setLastSaveTime(now);
    } else {
      // Agenda salvamento para daqui a 2 segundos
      savePositionRef.current = setTimeout(() => {
        ipcRenderer.invoke("save-position", { videoPath, position });
        setPositions(p => ({ ...p, [videoPath]: position }));
        setLastSaveTime(Date.now());
      }, 2000);
    }
  };
  
  // Função para salvar posição imediatamente (para pause, seek, etc.)
  const savePositionImmediate = (videoPath, position) => {
    if (savePositionRef.current) {
      clearTimeout(savePositionRef.current);
    }
    ipcRenderer.invoke("save-position", { videoPath, position });
    setPositions(p => ({ ...p, [videoPath]: position }));
    setLastSaveTime(Date.now());
  };

  // carrega posições salvas
  useEffect(() => {
    ipcRenderer.invoke("load-positions").then(setPositions);
  }, []);

  // carrega anotações salvas
  useEffect(() => {
    ipcRenderer.invoke("load-annotations").then(setVideoAnnotations);
  }, []);

  // salva anotações quando mudarem
  useEffect(() => {
    if (Object.keys(videoAnnotations).length > 0) {
      ipcRenderer.invoke("save-annotations", videoAnnotations);
    }
  }, [videoAnnotations]);

  // limpa cache quando watched ou positions mudam
  useEffect(() => {
    loadedPanelsRef.current = {};
  }, [watched, positions]);

  // salva posição se o app fechar
  useEffect(() => {
    const beforeUnload = () => {
      const v = fullscreenVideoRef.current;
      if (v && fullscreenVideo) {
        savePositionImmediate(fullscreenVideo, v.currentTime);
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      // Limpa timeout pendente
      if (savePositionRef.current) {
        clearTimeout(savePositionRef.current);
      }
    };
  }, [fullscreenVideo]);

  // ESC fecha modais
  useEffect(() => {
    if (expanded !== null || subfolderOpen || fullscreen) {
      const onEsc = e => {
        if (e.key === "Escape") {
          if (fullscreen) closeFS();
          else if (subfolderOpen) setSubfolderOpen(null);
          else setExpanded(null);
        }
      };
      window.addEventListener("keydown", onEsc);
      return () => window.removeEventListener("keydown", onEsc);
    }
  }, [expanded, subfolderOpen, fullscreen]);

  // Funções para gerenciar anotações
  const addAnnotation = () => {
    if (!newAnnotationTopic.trim() || !newAnnotationText.trim() || !fullscreenVideo) return;
    
    const newAnnotation = {
      id: Date.now(),
      topic: newAnnotationTopic.trim(),
      text: newAnnotationText.trim(),
      createdAt: new Date().toISOString()
    };
    
    setVideoAnnotations(prev => ({
      ...prev,
      [fullscreenVideo]: [...(prev[fullscreenVideo] || []), newAnnotation]
    }));
    
    setNewAnnotationTopic("");
    setNewAnnotationText("");
  };
  
  const editAnnotation = (annotationId, newTopic, newText) => {
    if (!fullscreenVideo) return;
    
    setVideoAnnotations(prev => ({
      ...prev,
      [fullscreenVideo]: (prev[fullscreenVideo] || []).map(ann => 
        ann.id === annotationId 
          ? { ...ann, topic: newTopic.trim(), text: newText.trim() }
          : ann
      )
    }));
    
    setEditingAnnotation(null);
  };
  
  const removeAnnotation = (annotationId) => {
    if (!fullscreenVideo) return;
    
    setVideoAnnotations(prev => ({
      ...prev,
      [fullscreenVideo]: (prev[fullscreenVideo] || []).filter(ann => ann.id !== annotationId)
    }));
  };

  const closeFS = () => {
    const v = fullscreenVideoRef.current;
    if (v && fullscreenVideo) {
      ipcRenderer.invoke("save-position", {
        videoPath: fullscreenVideo,
        position: v.currentTime
      });
    }
    setFullscreen(false);
    setFullscreenVideo(null);
    setFullscreenVideoNome("");
  };

  const handleFullscreen = (videoUrl, nome) => {
    onWatchedToggle(videoUrl);
    setFullscreenVideo(videoUrl);
    setFullscreenVideoNome(nome || "");
    setFullscreen(true);
  };

  // Limpa checks e posições desta playlist
  const handleClearFolder = async (folder) => {
    // limpa checks
    onClearWatched(folder);
    // limpa posições no store
    const vids = folder.videos.map(v => v.path);
    await ipcRenderer.invoke("clear-positions", vids);
    // atualiza estado local de positions
    setPositions(p => {
      const copy = { ...p };
      vids.forEach(path => delete copy[path]);
      return copy;
    });
  };

  // Helpers de drag
  const reorder = (list, startIndex, endIndex) => {
    const result = [...list];
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return result;
  };

  // Playlists: drag handlers
  const onDragStartFolder = (idx) => (e) => {
    setDragFolderIdx(idx);
    setDragFolderOriginIdx(idx);
    setDragFolderHoverIdx(idx);
    setGhostFolderIdx(idx);
    setDisplayFolders(folders.slice());
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const onDragOverFolder = (idx) => (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    // Reordenação visual em tempo real
    if (dragFolderHoverIdx !== null && dragFolderHoverIdx !== idx && Array.isArray(displayFolders)) {
      setDisplayFolders(prev => reorder(prev, dragFolderHoverIdx, idx));
      setDragFolderHoverIdx(idx);
      setDragFolderIdx(idx);
      setGhostFolderIdx(idx);
    }
  };
  const onDropFolder = (toIdx) => (e) => {
    e.preventDefault();
    const fromIdx = dragFolderOriginIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
    const finalIdx = dragFolderHoverIdx ?? toIdx;
    if (Number.isInteger(fromIdx) && Number.isInteger(finalIdx)) onReorderFolders(fromIdx, finalIdx);
    // limpar estados temporários
    setDragFolderIdx(null);
    setDragFolderOriginIdx(null);
    setDragFolderHoverIdx(null);
    setGhostFolderIdx(null);
    setDisplayFolders(null);
  };
  const onDragEndFolder = () => {
    setDragFolderIdx(null);
    setDragFolderOriginIdx(null);
    setDragFolderHoverIdx(null);
    setGhostFolderIdx(null);
    setDisplayFolders(null);
  };

  // Vídeos: drag handlers (versão final otimizada)
  const onDragStartVideo = (folderObj, fromIndex) => (e) => {
    e.stopPropagation();
    const v = folderObj.videos[fromIndex];
    setDraggingVideoFolderPath(folderObj.path);
    setTempVideos(folderObj.videos.slice());
    setDragVideoOriginIndex(fromIndex);
    setDragVideoHoverIndex(null); // Inicia como null para detectar primeiro hover
    setGhostVideoIndex(null);
    setDragVideoPath(v?.path || null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ folderPath: folderObj.path, fromIndex }));
  };
  const onDragOverVideo = (folderObj, hoverIndex) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggingVideoFolderPath === folderObj.path) {
      // Se é o primeiro hover ou mudou de posição
      if (dragVideoHoverIndex !== hoverIndex) {
        const currentHover = dragVideoHoverIndex ?? dragVideoOriginIndex;
        setTempVideos(prev => reorder(prev, currentHover, hoverIndex));
        setDragVideoHoverIndex(hoverIndex);
        setGhostVideoIndex(hoverIndex);
      }
    }
  };
  const onDropVideo = (folderObj) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingVideoFolderPath === folderObj.path && 
        Number.isInteger(dragVideoOriginIndex) && 
        Number.isInteger(dragVideoHoverIndex) &&
        dragVideoOriginIndex !== dragVideoHoverIndex) {
      onReorderVideos(folderObj.path, dragVideoOriginIndex, dragVideoHoverIndex);
    }
    // limpar estados temporários
    setDraggingVideoFolderPath(null);
    setTempVideos([]);
    setDragVideoOriginIndex(null);
    setDragVideoHoverIndex(null);
    setGhostVideoIndex(null);
    setDragVideoPath(null);
  };
  const onDragEndVideo = () => {
    // Fallback: se drop não foi capturado, mas temos origem e hover válidos, efetiva reordenação
    if (draggingVideoFolderPath && 
        Number.isInteger(dragVideoOriginIndex) && 
        Number.isInteger(dragVideoHoverIndex) &&
        dragVideoOriginIndex !== dragVideoHoverIndex) {
      onReorderVideos(draggingVideoFolderPath, dragVideoOriginIndex, dragVideoHoverIndex);
    }
    setDraggingVideoFolderPath(null);
    setTempVideos([]);
    setDragVideoOriginIndex(null);
    setDragVideoHoverIndex(null);
    setGhostVideoIndex(null);
    setDragVideoPath(null);
  };

  // Subpastas: drag handlers
  const onDragStartSub = (parentFolder, fromIdx) => (e) => {
    e.stopPropagation();

    setDraggingSubFolderParentPath(parentFolder.path);
    setTempSubfolders(parentFolder.subfolders.slice());
    setDragSubOriginIdx(fromIdx);
    setDragSubHoverIdx(null); // inicia como null para detectar primeiro hover
    setGhostSubIdx(null);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ parentPath: parentFolder.path, fromIdx }));
  };
  const onDragOverSub = (parentFolder, hoverIdx) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (draggingSubFolderParentPath === parentFolder.path) {
      const currentHover = dragSubHoverIdx ?? dragSubOriginIdx;
      if (currentHover !== hoverIdx) {
        setTempSubfolders(prev => reorder(prev, currentHover, hoverIdx));
        setDragSubHoverIdx(hoverIdx);
        setGhostSubIdx(hoverIdx);
      }
    }
  };
  const onDropSub = (parentFolder) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (draggingSubFolderParentPath === parentFolder.path && Number.isInteger(dragSubOriginIdx) && Number.isInteger(dragSubHoverIdx) && dragSubOriginIdx !== dragSubHoverIdx) {
      onReorderSubfolders(parentFolder.path, dragSubOriginIdx, dragSubHoverIdx);
    }
    // limpar estados temporários
    setDraggingSubFolderParentPath(null);
    setTempSubfolders([]);
    setDragSubOriginIdx(null);
    setDragSubHoverIdx(null);
    setGhostSubIdx(null);
  };
  const onDragEndSub = () => {
    if (draggingSubFolderParentPath && Number.isInteger(dragSubOriginIdx) && Number.isInteger(dragSubHoverIdx) && dragSubOriginIdx !== dragSubHoverIdx) {
      onReorderSubfolders(draggingSubFolderParentPath, dragSubOriginIdx, dragSubHoverIdx);
    }
    setDraggingSubFolderParentPath(null);
    setTempSubfolders([]);
    setDragSubOriginIdx(null);
    setDragSubHoverIdx(null);
    setGhostSubIdx(null);
  };


  const renderPanel = (folder, closePanel, idx) => {
    // Removido cache para permitir re-renderizações durante drag e atualizações em tempo real
    const panel = (
      <ModalOverlay onClick={closePanel}>
        <Modal onClick={e => e.stopPropagation()} style={{
          width: "96vw", maxWidth: "1800px",
          height: "60vh", maxHeight: "600px",
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          padding: "32px 2vw"
        }}>
            <CloseButton onClick={closePanel}>×</CloseButton>
            <div style={{
              display: "flex", flexDirection: "row",
              alignItems: "flex-start", gap: 40,
              height: "100%", width: "100%"
            }}>
              {/* Cabeçalho da playlist */}
              <div style={{ 
                flex: "0 0 260px",
                position: "relative"
              }}
                onMouseEnter={(e) => {
                  const buttons = e.currentTarget.querySelectorAll('.playlist-action-btn');
                  buttons.forEach(btn => btn.style.opacity = '1');
                }}
                onMouseLeave={(e) => {
                  const buttons = e.currentTarget.querySelectorAll('.playlist-action-btn');
                  buttons.forEach(btn => btn.style.opacity = '0');
                }}
              >
                <h2 style={{
                  color: "#ff0000", marginTop: 0,
                  textShadow: "0 0 5px #ff0000aa"
                }}>{folder.nome}</h2>
                <button 
                  className="playlist-action-btn"
                  style={{
                    marginTop: 8,
                    background: "#ff0000",
                    color: "#fff",
                    border: "none",
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    boxShadow: "0 0 6px #ff0000aa",
                    display: "flex",
                    alignItems: "center",
                    opacity: 0,
                    transition: "opacity 0.3s ease"
                  }}
                  title="Limpar checks desta playlist"
                  onClick={() => handleClearFolder(folder)}>
                    <FaBan style={{ marginRight: 6 }}/>Limpar Checks
                </button>
                <button 
                  className="playlist-action-btn"
                  style={{
                    marginTop: 8,
                    background: "#111",
                    color: "#ff0000",
                    border: "1px solid #ff0000",
                    padding: "6px 12px",
                    borderRadius: 8,
                    cursor: "pointer",
                    boxShadow: "0 0 6px #ff000099",
                    display: "flex",
                    alignItems: "center",
                    opacity: 0,
                    transition: "opacity 0.3s ease"
                  }}
                  title="Resetar ordem desta playlist"
                  onClick={() => onResetOrder(folder.path)}>
                    <FaUndo style={{ marginRight: 6 }}/>Resetar ordem
                </button>
                {folder.tipo && <p><b>Tipo:</b> {folder.tipo}</p>}
                {folder.ano  && <p><b>Ano:</b>  {folder.ano}</p>}
              </div>

              {/* Conteúdo: subpastas + vídeos */}
              <div style={{
                flex: 1,
                overflowY: "auto",
                height: "100%",
                display: "flex",
                flexDirection: "column"
              }}>
                {folder.subfolders?.length > 0 && (
                  <div style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: 18,
                    marginBottom: 24,
                    flexWrap: "wrap"
                  }}
                    onDragEnter={(e)=>{ 
                      e.preventDefault(); 
                      if (draggingSubFolderParentPath===folder.path && Number.isInteger(dragSubOriginIdx)) { 
                        const subs = tempSubfolders.length ? tempSubfolders : folder.subfolders;
                        const lastIdx = Math.max(0, subs.length - 1); 
                        if (dragSubHoverIdx === null) { 
                          setDragSubHoverIdx(lastIdx); 
                          setGhostSubIdx(lastIdx); 
                        } 
                      } 
                    }}
                    onDragOver={(e)=>{ 
                      e.preventDefault(); 
                      e.dataTransfer.dropEffect='move'; 
                      if (draggingSubFolderParentPath===folder.path && Number.isInteger(dragSubOriginIdx)) { 
                        const subs = tempSubfolders.length ? tempSubfolders : folder.subfolders;
                        const lastIdx = Math.max(0, subs.length - 1);
                        if (dragSubHoverIdx === null) {
                          setDragSubHoverIdx(lastIdx);
                          setGhostSubIdx(lastIdx);
                        }
                      } 
                    }}
                    onDrop={onDropSub(folder)}
                  >
                    {(draggingSubFolderParentPath===folder.path && tempSubfolders.length ? tempSubfolders : folder.subfolders).map((sub, subIdx) => (
                      <React.Fragment key={sub.path}>
                        {ghostSubIdx===subIdx && (
                           <div style={{ width: 200, height: 120, border: "2px dashed #ff4444", borderRadius: 12, margin: 6, boxShadow: "0 0 10px #ff000066" }}/>
                         )}
                         <div style={{
                          display: "flex",
                          flexDirection: "column",
                          background: ghostSubIdx===subIdx ? "#1a1a1a" : "linear-gradient(145deg, #1a1a1a, #0d0d0d)",
                          padding: "20px 18px",
                          borderRadius: 16,
                          minWidth: 200,
                          maxWidth: 210,
                          cursor: draggingSubFolderParentPath === folder.path ? "grabbing" : "grab",
                          boxShadow: ghostSubIdx===subIdx ? 
                            '0 0 20px #ff000088, inset 0 1px 0 rgba(255,255,255,0.1)' : 
                            '0 8px 32px rgba(0,0,0,0.3), 0 0 12px #ff000055, inset 0 1px 0 rgba(255,255,255,0.05)',
                          transform: ghostSubIdx===subIdx ? 'scale(0.98)' : 'scale(1)',
                          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                          border: "1px solid rgba(255, 0, 0, 0.2)",
                          backdropFilter: "blur(10px)",
                          position: "relative",
                          overflow: "hidden"
                        }}
                          draggable
                          onDragStart={onDragStartSub(folder, subIdx)}
                          onDragEnter={onDragOverSub(folder, subIdx)}
                          onDragOver={onDragOverSub(folder, subIdx)}
                          onDrop={onDropSub(folder)}
                          onDragEnd={onDragEndSub}
                          onClick={(e) => { 

                            if (draggingSubFolderParentPath) {
                              e.preventDefault();
                              return;
                            }
                            setSubfolderOpen({ parentIdx: idx, subIdx }); 
                          }}
                        >
                          {/* Efeito de brilho no topo */}
                          <div style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: "1px",
                            background: "linear-gradient(90deg, transparent, rgba(255,0,0,0.5), transparent)"
                          }} />
                          
                          {/* Preview de thumbnails (ampliada) */}
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(3, 58px)",
                            gap: 6,
                            justifyContent: "center",
                            marginBottom: 12
                          }}>
                            {sub.videos.slice(0, 6).map((video, vIdx) => (
                              video.thumb ? (
                                <div key={vIdx} style={{
                                  width: 58,
                                  height: 36,
                                  borderRadius: 8,
                                  backgroundImage: `url(${video.thumb})`,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                  border: "2px solid #ff0000",
                                  boxShadow: "0 2px 8px rgba(0,0,0,0.5)"
                                }} />
                              ) : null
                            ))}
                            {sub.videos.length === 0 && (
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gridColumn: "1 / -1", padding: 8 }}>
                                <FaFolder size={56} color="#ff0000"
                                  style={{ 
                                    filter: "drop-shadow(0 0 8px #ff0000aa)",
                                    opacity: 0.9
                                  }}/>
                              </div>
                            )}
                          </div>
                          
                          {/* Nome da subpasta */}
                          <div style={{
                            textAlign: "center",
                            marginBottom: 8
                          }}>
                            <span style={{
                              color: "#fff",
                              fontWeight: "600",
                              fontSize: "1.1em",
                              textShadow: "0 0 6px #ff0000cc",
                              display: "block",
                              lineHeight: "1.2",
                              wordBreak: "break-word"
                            }}>{sub.nome}</span>
                          </div>
                          
                          {/* Estatísticas */}
                          <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "rgba(0,0,0,0.3)",
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid rgba(255,0,0,0.1)"
                          }}>
                            <span style={{
                              color: "#ffaaaa",
                              fontSize: "0.85em",
                              fontWeight: "500"
                            }}>
                              {sub.videos.length} vídeo{sub.videos.length !== 1 ? 's' : ''}
                            </span>
                            {sub.subfolders && sub.subfolders.length > 0 && (
                              <span style={{
                                color: "#ff6666",
                                fontSize: "0.8em",
                                opacity: 0.8
                              }}>
                                +{sub.subfolders.length} pasta{sub.subfolders.length !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        </div>
                        </React.Fragment>
                      ))}
                    </div>
                  )}

                  <div style={{
                    width: "100%",
                    height: 2,
                    background: "linear-gradient(90deg, transparent, #ff0000, transparent)",
                    boxShadow: "0 0 10px #ff0000, 0 0 18px #ff000088",
                    borderRadius: 999,
                    margin: "16px 0 12px 0"
                  }} />

                  <VideosContainer style={{
                    flexWrap: "wrap",
                    gap: "28px 24px",
                    alignItems: "flex-start",
                    justifyContent: "flex-start",
                    minHeight: "200px", // Garante área de drop
                    padding: "10px"
                  }}
                    onDragEnter={(e)=>{ 
                      e.preventDefault(); 
                      if (draggingVideoFolderPath===folder.path && Number.isInteger(dragVideoOriginIndex)) { 
                        const videos = tempVideos.length ? tempVideos : folder.videos;
                        const lastIdx = Math.max(0, videos.length - 1); 
                        if (dragVideoHoverIndex === null) { 
                          setDragVideoHoverIndex(lastIdx); 
                          setGhostVideoIndex(lastIdx); 
                        } 
                      } 
                    }}
                    onDragOver={(e)=>{ 
                      e.preventDefault(); 
                      e.dataTransfer.dropEffect='move'; 
                      if (draggingVideoFolderPath===folder.path && Number.isInteger(dragVideoOriginIndex)) { 
                        const videos = tempVideos.length ? tempVideos : folder.videos;
                        const lastIdx = Math.max(0, videos.length - 1);
                        if (dragVideoHoverIndex === null) {
                          setDragVideoHoverIndex(lastIdx);
                          setGhostVideoIndex(lastIdx);
                        }
                      } 
                    }}
                    onDrop={(e)=>{ 
                      e.preventDefault(); 
                      if (draggingVideoFolderPath===folder.path && 
                          Number.isInteger(dragVideoOriginIndex) && 
                          Number.isInteger(dragVideoHoverIndex) &&
                          dragVideoOriginIndex !== dragVideoHoverIndex) { 
                        onReorderVideos(folder.path, dragVideoOriginIndex, dragVideoHoverIndex); 
                      } 
                      setDraggingVideoFolderPath(null); 
                      setTempVideos([]); 
                      setDragVideoOriginIndex(null); 
                      setDragVideoHoverIndex(null); 
                      setGhostVideoIndex(null); 
                      setDragVideoPath(null); 
                    }}
                  >
                    {(draggingVideoFolderPath===folder.path && tempVideos.length ? tempVideos : folder.videos).map((video, i) => (
                      <React.Fragment key={video.path}>
                        {ghostVideoIndex===i && (
                          <div style={{ width: "320px", height: "180px", border: "2px dashed #ff4444", borderRadius: 14, margin: 2, boxShadow: "0 0 12px #ff000066" }}/>
                        )}
                        <div style={{
                          position: "relative",
                          marginBottom: 8,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          userSelect: 'none',
                          cursor: 'grab',
                          transform: draggingVideoFolderPath===folder.path && dragVideoPath===video.path ? 'scale(1.03)' : 'none',
                          opacity: draggingVideoFolderPath===folder.path && dragVideoPath===video.path ? 0.85 : 1,
                          boxShadow: draggingVideoFolderPath===folder.path && dragVideoPath===video.path ? '0 6px 16px rgba(0,0,0,0.35)' : 'none'
                        }}
                          draggable
                          onDragStart={onDragStartVideo(folder, i)}
                          onDragEnter={onDragOverVideo(folder, i)}
                          onDragOver={onDragOverVideo(folder, i)}
                          onDrop={onDropVideo(folder)}
                          onDragEnd={onDragEndVideo}
                          onClick={() => { if (draggingVideoFolderPath===folder.path) return; handleFullscreen(video.path, video.nome); }}
                        >
                          <img src={video.thumb} alt={video.nome} style={{
                            width: "320px",
                            height: "180px",
                            objectFit: "cover",
                            borderRadius: 14,
                            background: "#000",
                            marginBottom: 4,
                            boxShadow: draggingVideoFolderPath===folder.path && dragVideoPath===video.path ? '0 0 14px #ff000088' : 'none',
                            pointerEvents: 'none'
                          }} loading="lazy" draggable={false}/>
                          {watched.includes(video.path) && (
                            <FaCheck size={24} color="#ff0000" style={{
                              position: "absolute",
                              top: 8,
                              right: 8,
                              filter: "drop-shadow(0 0 4px #ff0000aa)"
                            }}/>
                          )}
                          <button style={{
                            position: "absolute",
                            bottom: 30,
                            right: 16,
                            border: "none",
                            background: "#ff0000cc",
                            color: "#fff",
                            borderRadius: 8,
                            padding: 5,
                            cursor: "pointer"
                          }}
                            onClick={e => { e.stopPropagation(); if (draggingVideoFolderPath===folder.path) return; handleFullscreen(video.path, video.nome); }}
                            title="Expandir vídeo">
                            <FaExpandAlt/>
                          </button>
                          <VideoName>{video.nome}</VideoName>
                        </div>
                      </React.Fragment>
                    ))}
                  </VideosContainer>
                </div>
              </div>
        </Modal>
      </ModalOverlay>
    );
    return panel;
  };

  return (
    <DashboardContainer>
      {(displayFolders ?? folders).map((folder, idx) => (
        <React.Fragment key={folder.path + folder.nome}>
          {ghostFolderIdx===idx && (
            <div style={{ height: 10, borderRadius: 8, margin: "8px 0", border: "2px dashed #ff4444", boxShadow: "0 0 12px #ff000066" }}/>
          )}
          <div
            draggable={expanded !== idx}
            onDragStart={expanded !== idx ? onDragStartFolder(idx) : undefined}
            onDragOver={expanded !== idx ? onDragOverFolder(idx) : undefined}
            onDrop={expanded !== idx ? onDropFolder(idx) : undefined}
            onMouseEnter={(e) => {
              const deleteBtn = e.currentTarget.querySelector('.delete-playlist-btn');
              if (deleteBtn) deleteBtn.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              const deleteBtn = e.currentTarget.querySelector('.delete-playlist-btn');
              if (deleteBtn) deleteBtn.style.opacity = '0';
            }}
          >
            <FolderTile
              folder={folder}
              index={idx}
              isDragging={dragFolderIdx === idx}
              isGhost={ghostFolderIdx === idx}
              onDelete={() => onDeleteFolder(idx)}
              onClick={() => setExpanded(expanded === idx ? null : idx)}
            >
              <button
                className="delete-playlist-btn"
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  background: "#111",
                  color: "#ff0000",
                  border: "1px solid #ff0000",
                  padding: "6px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  boxShadow: "0 0 6px #ff000099",
                  display: "flex",
                  alignItems: "center",
                  opacity: 0,
                  transition: "opacity 0.3s ease"
                }}
                onClick={e => { e.stopPropagation(); onDeleteFolder(idx); }}
                title="Excluir playlist"
              >
                <FaTrashAlt/>
              </button>
            </FolderTile>
          </div>

          {expanded === idx && !subfolderOpen &&
            renderPanel(folder, () => setExpanded(null), idx)}

          {expanded === idx && subfolderOpen &&
            renderPanel(
              folder.subfolders[subfolderOpen.subIdx],
              () => setSubfolderOpen(null),
              `${idx}-${subfolderOpen.subIdx}`
            )}
        </React.Fragment>
      ))}

      {fullscreen && (
        <ModalOverlay>
          <Modal style={{
            width: "95vw",
            maxWidth: "1400px", 
            height: "95vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            background: "#181f29",
            padding: "20px",
            overflow: "auto"
          }}>
            <CloseButton onClick={closeFS}>×</CloseButton>
            <div style={{
              border: "4px solid #ff0000",
              boxShadow: "0 0 12px #ff0000aa",
              borderRadius: 16,
              overflow: "hidden",
              width: "100%",
              height: "75vh",
              marginBottom: "20px"
            }}>
              <video ref={fullscreenVideoRef}
                src={fullscreenVideo}
                style={{ width: "100%", height: "100%", background: "#000" }}
                controls autoPlay
                onLoadedMetadata={() => {
                  const t = positions[fullscreenVideo] || 0;
                  if (t && fullscreenVideoRef.current) fullscreenVideoRef.current.currentTime = t;
                }}
                onTimeUpdate={e => {
                  const cur = e.target.currentTime;
                  // Usa throttling para evitar salvamentos excessivos
                  savePositionThrottled(fullscreenVideo, cur);
                }}
                onPause={e => {
                  const cur = e.target.currentTime;
                  // Salva imediatamente quando pausa
                  savePositionImmediate(fullscreenVideo, cur);
                }}
                onSeeked={e => {
                  const cur = e.target.currentTime;
                  // Salva imediatamente quando busca nova posição
                  savePositionImmediate(fullscreenVideo, cur);
                }}
              />
            </div>
            <VideoName style={{ marginTop: 12, textAlign: "center" }}>
              {fullscreenVideoNome}
            </VideoName>
            
            {/* Interface de Anotações */}
            <div style={{
              width: "100%",
              maxWidth: "800px",
              marginTop: "20px",
              background: "#1a1a1a",
              borderRadius: "12px",
              border: "2px solid #ff0000",
              padding: "16px"
            }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: showAnnotations ? "16px" : "8px"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <h3 style={{
                    color: "#ff0000",
                    margin: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <FaStickyNote /> Anotações e Tópicos
                  </h3>
                  {/* Contador de anotações */}
                  {(videoAnnotations[fullscreenVideo] || []).length > 0 && (
                    <span style={{
                      background: "#ff0000",
                      color: "#fff",
                      borderRadius: "12px",
                      padding: "2px 8px",
                      fontSize: "12px",
                      fontWeight: "bold"
                    }}>
                      {(videoAnnotations[fullscreenVideo] || []).length}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setShowAnnotations(!showAnnotations)}
                  style={{
                    background: "transparent",
                    border: "1px solid #ff0000",
                    color: "#ff0000",
                    borderRadius: "6px",
                    padding: "4px 8px",
                    cursor: "pointer"
                  }}
                >
                  {showAnnotations ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              
              {/* Preview das anotações quando oculta */}
              {!showAnnotations && (videoAnnotations[fullscreenVideo] || []).length > 0 && (
                <div style={{
                  maxHeight: "120px",
                  overflowY: "auto",
                  background: "#2a2a2a",
                  borderRadius: "8px",
                  padding: "8px"
                }}>
                  {(videoAnnotations[fullscreenVideo] || []).slice(0, 3).map((annotation) => (
                    <div key={annotation.id} style={{
                      marginBottom: "6px",
                      paddingBottom: "6px",
                      borderBottom: "1px solid #444"
                    }}>
                      <div style={{
                        color: "#ff0000",
                        fontSize: "12px",
                        fontWeight: "bold",
                        marginBottom: "2px"
                      }}>
                        {annotation.topic}
                      </div>
                      <div style={{
                        color: "#ccc",
                        fontSize: "11px",
                        lineHeight: "1.3",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      }}>
                        {annotation.text}
                      </div>
                    </div>
                  ))}
                  {(videoAnnotations[fullscreenVideo] || []).length > 3 && (
                    <div style={{
                      color: "#888",
                      fontSize: "11px",
                      textAlign: "center",
                      fontStyle: "italic"
                    }}>
                      +{(videoAnnotations[fullscreenVideo] || []).length - 3} mais...
                    </div>
                  )}
                </div>
              )}
              
              {showAnnotations && (
                <>
                  {/* Formulário para nova anotação */}
                  <div style={{
                    background: "#2a2a2a",
                    borderRadius: "8px",
                    padding: "12px",
                    marginBottom: "16px"
                  }}>
                  <div style={{ marginBottom: "8px" }}>
                    <input
                      type="text"
                      placeholder="Tópico (ex: Conceito importante, Dica, etc.)"
                      value={newAnnotationTopic}
                      onChange={(e) => setNewAnnotationTopic(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        borderRadius: "4px",
                        color: "#fff",
                        fontSize: "14px"
                      }}
                    />
                  </div>
                  <div style={{ marginBottom: "8px" }}>
                    <textarea
                      placeholder="Descrição da anotação..."
                      value={newAnnotationText}
                      onChange={(e) => setNewAnnotationText(e.target.value)}
                      rows={3}
                      style={{
                        width: "100%",
                        padding: "8px",
                        background: "#333",
                        border: "1px solid #555",
                        borderRadius: "4px",
                        color: "#fff",
                        fontSize: "14px",
                        resize: "vertical"
                      }}
                    />
                  </div>
                  <button
                    onClick={addAnnotation}
                    disabled={!newAnnotationTopic.trim() || !newAnnotationText.trim()}
                    style={{
                      background: newAnnotationTopic.trim() && newAnnotationText.trim() ? "#ff0000" : "#666",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "8px 16px",
                      cursor: newAnnotationTopic.trim() && newAnnotationText.trim() ? "pointer" : "not-allowed",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px"
                    }}
                  >
                    <FaPlus size={12} /> Adicionar Anotação
                  </button>
                </div>
                
                {/* Lista de anotações existentes */}
                <div style={{ maxHeight: "200px", overflowY: "auto" }}>
                  {(videoAnnotations[fullscreenVideo] || []).map((annotation) => (
                    <div key={annotation.id} style={{
                      background: "#2a2a2a",
                      borderRadius: "8px",
                      padding: "12px",
                      marginBottom: "8px",
                      border: "1px solid #444"
                    }}>
                      {editingAnnotation === annotation.id ? (
                        <div data-editing={annotation.id}>
                          <input
                            type="text"
                            defaultValue={annotation.topic}
                            ref={(el) => { if (el) el.focus(); }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const container = e.target.parentNode;
                                const newTopic = container.querySelector('input').value;
                                const newText = container.querySelector('textarea').value;
                                editAnnotation(annotation.id, newTopic, newText);
                              }
                              if (e.key === 'Escape') setEditingAnnotation(null);
                            }}
                            style={{
                              width: "100%",
                              padding: "6px",
                              background: "#333",
                              border: "1px solid #555",
                              borderRadius: "4px",
                              color: "#fff",
                              marginBottom: "8px"
                            }}
                          />
                          <textarea
                            defaultValue={annotation.text}
                            rows={2}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && e.ctrlKey) {
                                const container = e.target.parentNode;
                                const newTopic = container.querySelector('input').value;
                                const newText = container.querySelector('textarea').value;
                                editAnnotation(annotation.id, newTopic, newText);
                              }
                              if (e.key === 'Escape') setEditingAnnotation(null);
                            }}
                            style={{
                              width: "100%",
                              padding: "6px",
                              background: "#333",
                              border: "1px solid #555",
                              borderRadius: "4px",
                              color: "#fff",
                              resize: "vertical"
                            }}
                          />
                          <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
                            <button
                              onClick={(e) => {
                                const container = e.target.closest('[data-editing]');
                                const newTopic = container.querySelector('input').value;
                                const newText = container.querySelector('textarea').value;
                                editAnnotation(annotation.id, newTopic, newText);
                              }}
                              style={{
                                background: "#ff0000",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: "12px"
                              }}
                            >
                              Salvar
                            </button>
                            <button
                              onClick={() => setEditingAnnotation(null)}
                              style={{
                                background: "#666",
                                color: "#fff",
                                border: "none",
                                borderRadius: "4px",
                                padding: "4px 8px",
                                cursor: "pointer",
                                fontSize: "12px"
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            marginBottom: "8px"
                          }}>
                            <h4 style={{
                              color: "#ff0000",
                              margin: 0,
                              fontSize: "14px",
                              fontWeight: "bold"
                            }}>
                              {annotation.topic}
                            </h4>
                            <div style={{ display: "flex", gap: "4px" }}>
                              <button
                                onClick={() => setEditingAnnotation(annotation.id)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#ff0000",
                                  cursor: "pointer",
                                  padding: "2px"
                                }}
                                title="Editar"
                              >
                                <FaEdit size={12} />
                              </button>
                              <button
                                onClick={() => removeAnnotation(annotation.id)}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#ff6666",
                                  cursor: "pointer",
                                  padding: "2px"
                                }}
                                title="Remover"
                              >
                                <FaTimes size={12} />
                              </button>
                            </div>
                          </div>
                          <p style={{
                            color: "#ccc",
                            margin: 0,
                            fontSize: "13px",
                            lineHeight: "1.4"
                          }}>
                            {annotation.text}
                          </p>
                          <small style={{
                            color: "#888",
                            fontSize: "11px"
                          }}>
                            {new Date(annotation.createdAt).toLocaleString('pt-BR')}
                          </small>
                        </div>
                      )}
                    </div>
                  ))}
                    
                    {(!videoAnnotations[fullscreenVideo] || videoAnnotations[fullscreenVideo].length === 0) && (
                      <p style={{
                        color: "#888",
                        textAlign: "center",
                        fontStyle: "italic",
                        margin: "20px 0"
                      }}>
                        Nenhuma anotação ainda. Adicione tópicos importantes sobre este vídeo!
                      </p>
                    )}
                  </div>
                </>
               )}
            </div>
          </Modal>
        </ModalOverlay>
      )}
    </DashboardContainer>
  );
};

export default Dashboard;
