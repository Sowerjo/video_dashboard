import styled, { keyframes } from "styled-components";

// 🔄 Animações
const gradientMove = keyframes`
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
`;

const glassGlow = keyframes`
  0%, 100% { box-shadow: 0 0 16px #ff3333aa, 0 0 36px #44000055; }
  50% { box-shadow: 0 0 28px #ff0000, 0 0 64px #55000088; }
`;

export const DashboardContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 36px;
  padding: 46px 42px;
  min-height: 100vh;
  justify-content: flex-start;
  align-items: flex-start;
  background: #000;
`;

// 🔻 Barra superior dos botões
export const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin: 32px 0 18px 0;
  background: #111;
  border-radius: 19px;
  box-shadow: 0 2px 14px #ff000033;
  padding: 12px 24px;
  backdrop-filter: blur(5px);
`;

export const Tile = styled.div`
  background: #111;
  box-shadow: 0 8px 38px #22000099, 0 0 22px #ff000088;
  border-radius: 26px;
  width: 330px;
  min-height: 240px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 22px 14px 18px 14px;
  position: relative;
  cursor: pointer;
  animation: ${glassGlow} 6s infinite;
  border: 2px solid #ff0000;
  transition: 
    transform 0.24s cubic-bezier(.16,1.01,.36,1),
    box-shadow 0.3s,
    border-color 0.28s;

  &:hover {
    transform: scale(1.06);
    box-shadow: 0 14px 48px #ff0000cc;
    background: #1a0000;
  }
`;

export const Preview = styled.video`
  width: 92%;
  height: 142px;
  border-radius: 16px;
  object-fit: cover;
  margin-bottom: 14px;
  background: #200;
  box-shadow: 0 0 14px #ff000088;
  border: 2.5px solid #ff0000;
  filter: brightness(1.05);
`;

export const FolderTitle = styled.div`
  font-weight: 700;
  color: #fff;
  font-size: 1.15em;
  text-align: center;
  margin-bottom: 2px;
  letter-spacing: 1.2px;
  text-shadow: 0 0 8px #ff000088;
`;

export const ContentInfo = styled.div`
  color: #ddd;
  font-size: 1em;
  text-align: center;
  text-shadow: 0 1px 5px #44000055;
`;

export const AddButton = styled.button`
  background: #1a0000;
  color: #fff;
  font-weight: bold;
  border: 2px solid #ff0000;
  border-radius: 16px;
  padding: 14px 34px;
  font-size: 1.18em;
  margin: 0 8px 0 0;
  cursor: pointer;
  box-shadow: 0 0 12px #ff000044;
  backdrop-filter: blur(4px);
  transition:
    box-shadow 0.17s,
    transform 0.14s,
    background 0.18s;

  &:hover {
    background: #ff0000;
    color: #000;
    box-shadow: 0 0 28px #ff0000cc;
  }
`;

export const ModalOverlay = styled.div`
  position: fixed;
  z-index: 100;
  left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
`;

export const Modal = styled.div`
  background: #111;
  border-radius: 22px;
  padding: 38px 46px;
  min-width: 410px;
  color: #fff;
  box-shadow: 0 0 40px #ff000055;
  position: relative;
  display: flex;
  flex-direction: column;
  border: 2px solid #ff0000;
`;

export const ModalInput = styled.input`
  width: 100%;
  margin-bottom: 18px;
  padding: 13px;
  border-radius: 10px;
  border: 2px solid #ff0000;
  font-size: 1.09em;
  background: #000;
  color: #fff;
  outline: none;

  &:focus {
    box-shadow: 0 0 14px #ff0000aa;
    background: #111;
    border: 2px solid #ff0000;
  }
`;

export const CloseButton = styled.button`
  background: none;
  border: none;
  color: #ff0000;
  font-size: 2.3em;
  position: absolute;
  right: 28px;
  top: 18px;
  cursor: pointer;
  transition: color 0.20s, transform 0.13s;
  z-index: 101;
  line-height: 1;

  &:hover {
    color: #fff;
    transform: scale(1.25);
    text-shadow: 0 0 10px #ff0000;
  }
`;

export const VideosContainer = styled.div`
  margin-top: 8px;
  display: flex;
  gap: 26px;
  flex-wrap: wrap;
  justify-content: flex-start;
`;

export const VideoName = styled.div`
  margin-top: 7px;
  font-size: 1.06em;
  text-align: center;
  font-weight: 600;
  max-width: 292px;
  word-break: break-all;
  color: #fff;
  text-shadow: 0 0 12px #ff0000aa;
`;

export const Spinner = styled.div`
  border: 6px solid #3a000050;
  border-top: 6px solid #ff0000;
  border-radius: 50%;
  width: 54px;
  height: 54px;
  animation: spin 1.2s linear infinite;
  margin: 0 auto;

  @keyframes spin {
    0% { transform: rotate(0deg);}
    100% { transform: rotate(360deg);}
  }
`;

export const ThemeSwitch = styled.button`
  background: transparent;
  border: none;
  font-size: 2.2em;
  margin-right: 10px;
  cursor: pointer;
  transition: transform 0.16s;
  color: #fff;

  &:hover {
    transform: scale(1.25) rotate(-10deg);
    filter: drop-shadow(0 0 8px #ff0000aa);
  }
`;
export const AppContainer = styled.div`
  padding: 24px;
  background: #000;
  min-height: 100vh;
`;
// Barra de progresso
export const ProgressBarContainer = styled.div`
  width: 60vw;
  margin: 100px auto;
  background: rgba(255,255,255,0.05);
  border: 2px solid #A48ADE;
  border-radius: 12px;
  padding: 24px;
  text-align: center;
`;

export const ProgressBarFill = styled.div`
  height: 16px;
  background: linear-gradient(90deg, #ff0000, #a30000);
  border-radius: 10px;
  transition: width 0.3s ease;
`;