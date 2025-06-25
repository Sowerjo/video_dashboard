import React from "react";
import { Tile, FolderTitle, ContentInfo } from "./styles";

const FolderTile = ({ folder, onClick, children }) => {
  const thumb = folder.videos[0]?.thumb;
  return (
    <Tile onClick={onClick} style={{ position: "relative" }}>
      {children}
      {thumb
        ? <img
            src={thumb}
            alt={folder.nome}
            style={{
              width:"92%", height:142, objectFit:"cover",
              borderRadius:16, marginBottom:14,
              boxShadow:"0 0 14px #ff000088",
              border:"2.5px solid #ff0000"
            }}
          />
        : <div style={{
            height:140, display:"flex", alignItems:"center", justifyContent:"center",
            color:"#ff0000", background:"#181f1f", borderRadius:16
          }}>(Sem Vídeos)</div>
      }
      <FolderTitle>{folder.nome}</FolderTitle>
      <ContentInfo>{folder.tipo} | {folder.ano}</ContentInfo>
    </Tile>
  );
};

export default FolderTile;
