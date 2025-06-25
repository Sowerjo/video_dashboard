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
import { FaTrashAlt, FaExpandAlt, FaFolder, FaCheck, FaBan } from "react-icons/fa";

const { ipcRenderer } = window.require("electron");

const Dashboard = ({
  folders,
  watched,
  onWatchedToggle,
  onClearWatched,
  onDeleteFolder
}) => {
  const [expanded, setExpanded]           = useState(null);
  const [subfolderOpen, setSubfolderOpen] = useState(null);
  const [fullscreen, setFullscreen]       = useState(false);
  const [fullscreenVideo, setFullscreenVideo] = useState(null);
  const [fullscreenVideoNome, setFullscreenVideoNome] = useState("");
  const [positions, setPositions]         = useState({});
  const fullscreenVideoRef                = useRef();
  const loadedPanelsRef                   = useRef({});

  // carrega posições salvas
  useEffect(() => {
    ipcRenderer.invoke("load-positions").then(setPositions);
  }, []);

  // limpa cache quando watched ou positions mudam
  useEffect(() => {
    loadedPanelsRef.current = {};
  }, [watched, positions]);

  // salva posição se o app fechar
  useEffect(() => {
    const beforeUnload = () => {
      const v = fullscreenVideoRef.current;
      if (v && fullscreenVideo) {
        ipcRenderer.invoke("save-position", {
          videoPath: fullscreenVideo,
          position: v.currentTime
        });
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
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

  const renderPanel = (folder, closePanel, idx) => {
    if (loadedPanelsRef.current[idx]) {
      return loadedPanelsRef.current[idx];
    }
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
            <div style={{ flex: "0 0 260px" }}>
              <h2 style={{
                color: "#ff0000", marginTop: 0,
                textShadow: "0 0 5px #ff0000aa"
              }}>{folder.nome}</h2>
              <button style={{
                marginTop: 8,
                background: "#ff0000",
                color: "#fff",
                border: "none",
                padding: "6px 12px",
                borderRadius: 8,
                cursor: "pointer",
                boxShadow: "0 0 6px #ff0000aa",
                display: "flex",
                alignItems: "center"
              }}
              title="Limpar checks desta playlist"
              onClick={() => handleClearFolder(folder)}>
                <FaBan style={{ marginRight: 6 }}/>Limpar Checks
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
                }}>
                  {folder.subfolders.map((sub, subIdx) => (
                    <div key={sub.path} style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      background: "#111",
                      padding: "18px 16px",
                      borderRadius: 14,
                      minWidth: 180,
                      maxWidth: 220,
                      cursor: "pointer",
                      boxShadow: "0 0 12px #ff000055",
                      transition: "background .18s"
                    }}
                      onClick={() => setSubfolderOpen({ parentIdx: idx, subIdx })}>
                      <FaFolder size={36} color="#ff0000"
                        style={{ marginBottom: 6, filter: "drop-shadow(0 0 4px #ff0000aa)" }}/>
                      <span style={{
                        color: "#fff",
                        fontWeight: "bold",
                        fontSize: "1.1em",
                        marginBottom: 4,
                        textShadow: "0 0 4px #ff0000cc"
                      }}>{sub.nome}</span>
                      <span style={{
                        color: "#ffaaaa",
                        fontSize: "0.9em",
                        textShadow: "0 0 2px #ff0000aa"
                      }}>{sub.videos.length} vídeo(s)</span>
                      {/* botão “Limpar” removido das subpastas */}
                    </div>
                  ))}
                </div>
              )}

              <VideosContainer style={{
                flexWrap: "wrap",
                gap: "28px 24px",
                alignItems: "flex-start",
                justifyContent: "flex-start"
              }}>
                {folder.videos.map((video, i) => (
                  <div key={video.path} style={{
                    position: "relative",
                    marginBottom: 8,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: "pointer"
                  }}
                    onClick={() => handleFullscreen(video.path, video.nome)}>
                    <img src={video.thumb} alt={video.nome} style={{
                      width: "320px",
                      height: "180px",
                      objectFit: "cover",
                      borderRadius: 14,
                      background: "#000",
                      marginBottom: 4
                    }} loading="lazy"/>
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
                      onClick={e => { e.stopPropagation(); handleFullscreen(video.path, video.nome); }}
                      title="Expandir vídeo">
                      <FaExpandAlt/>
                    </button>
                    <VideoName>{video.nome}</VideoName>
                  </div>
                ))}
              </VideosContainer>
            </div>
          </div>
        </Modal>
      </ModalOverlay>
    );
    loadedPanelsRef.current[idx] = panel;
    return panel;
  };

  return (
    <DashboardContainer>
      {folders.map((folder, idx) => (
        <React.Fragment key={folder.path + folder.nome}>
          <FolderTile folder={folder} onClick={() => setExpanded(idx)}>
            <button style={{
              position: "absolute",
              top: 12,
              right: 12,
              border: "none",
              background: "rgba(255,255,255,0.07)",
              color: "#ff0000",
              borderRadius: 8,
              padding: 6,
              cursor: "pointer"
            }}
              onClick={e => { e.stopPropagation(); delete loadedPanelsRef.current[idx]; onDeleteFolder(idx); }}
              title="Excluir playlist">
              <FaTrashAlt/>
            </button>
          </FolderTile>

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
            width: "70vw",
            height: "60vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#181f29",
            padding: 0
          }}>
            <CloseButton onClick={closeFS}>×</CloseButton>
            <div style={{
              border: "4px solid #ff0000",
              boxShadow: "0 0 12px #ff0000aa",
              borderRadius: 16,
              overflow: "hidden",
              width: "100%",
              height: "100%",
              maxHeight: "58vh"
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
                  ipcRenderer.invoke("save-position", { videoPath: fullscreenVideo, position: cur });
                  setPositions(p => ({ ...p, [fullscreenVideo]: cur }));
                }}
                onPause={e => {
                  const cur = e.target.currentTime;
                  ipcRenderer.invoke("save-position", { videoPath: fullscreenVideo, position: cur });
                  setPositions(p => ({ ...p, [fullscreenVideo]: cur }));
                }}
                onSeeked={e => {
                  const cur = e.target.currentTime;
                  ipcRenderer.invoke("save-position", { videoPath: fullscreenVideo, position: cur });
                  setPositions(p => ({ ...p, [fullscreenVideo]: cur }));
                }}
              />
            </div>
            <VideoName style={{ marginTop: 12, textAlign: "center" }}>
              {fullscreenVideoNome}
            </VideoName>
          </Modal>
        </ModalOverlay>
      )}
    </DashboardContainer>
  );
};

export default Dashboard;
