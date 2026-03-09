import React, { useState } from "react";
import OfflineModule from "./OfflineModule";
import IptvModule from "./IptvModule";
import {
  AppContainer,
  BackgroundLayer,
  VignetteOverlay,
  LogoOverlay,
  Tile,
  FolderTitle,
  ContentInfo
} from "./styles";

const modeCardStyle = {
  width: 360,
  minHeight: 220,
  justifyContent: "center",
  padding: "28px 22px",
};

const backBtnStyle = {
  position: "fixed",
  top: 20,
  right: 20,
  zIndex: 2147483647,
  background: "rgba(17,17,17,0.9)",
  color: "#ff0000",
  border: "2px solid #ff0000",
  borderRadius: 10,
  padding: "10px 14px",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "0 0 12px #ff000066",
};

export default function App() {
  const [mode, setMode] = useState(null);

  if (mode === "offline") {
    return (
      <>
        <button type="button" style={backBtnStyle} onClick={() => setMode(null)}>
          Menu Inicial
        </button>
        <OfflineModule />
      </>
    );
  }

  if (mode === "iptv") {
    return <IptvModule onBack={() => setMode(null)} />;
  }

  return (
    <>
      <BackgroundLayer />
      <VignetteOverlay />
      <LogoOverlay src={"topo.png"} alt="Logo" />
      <AppContainer>
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 32,
            flexWrap: "wrap",
            paddingTop: 80,
          }}
        >
          <Tile style={modeCardStyle} onClick={() => setMode("offline")}>
            <FolderTitle style={{ fontSize: "1.35em", marginBottom: 10 }}>Modo Offline</FolderTitle>
            <ContentInfo style={{ fontSize: "1.02em", lineHeight: 1.5 }}>
              Continua com o funcionamento nativo do app, lendo suas pastas e vídeos locais.
            </ContentInfo>
          </Tile>

          <Tile style={modeCardStyle} onClick={() => setMode("iptv")}>
            <FolderTitle style={{ fontSize: "1.35em", marginBottom: 10 }}>Modo IPTV</FolderTitle>
            <ContentInfo style={{ fontSize: "1.02em", lineHeight: 1.5 }}>
              Login no servidor IPTV, carregamento de playlist M3U e reprodução de canais.
            </ContentInfo>
          </Tile>
        </div>
      </AppContainer>
    </>
  );
}
