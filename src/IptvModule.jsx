import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactPlayer from "react-player";
import {
  AppContainer,
  BackgroundLayer,
  VignetteOverlay,
  LogoOverlay,
  Tile,
  FolderTitle,
  ContentInfo,
  ModalInput,
} from "./styles";
import {
  FaBars,
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaFilm,
  FaHeart,
  FaInfoCircle,
  FaPlus,
  FaPlay,
  FaPause,
  FaSearch,
  FaStar,
  FaTimes,
  FaTv,
  FaUserCircle,
  FaVideo,
  FaChromecast,
  FaVolumeUp,
  FaVolumeMute,
} from "react-icons/fa";
import { MdSkipNext, MdSkipPrevious, MdReplay10, MdForward10 } from "react-icons/md";

const { ipcRenderer } = window.require("electron");

const NAV_ITEMS = [
  { key: "home", label: "Início" },
  { key: "live", label: "TV ao Vivo" },
  { key: "movies", label: "Filmes" },
  { key: "series", label: "Séries" },
  { key: "playlists", label: "Playlists" },
];

function getLimitForKind(kind) {
  if (kind === "movie") return 5000;
  if (kind === "series") return 5000;
  if (kind === "live") return 5000;
  if (kind === "all") return 10000;
  return 3000;
}

function toPlayableUrl(rawUrl) {
  return String(rawUrl || "").trim();
}

function appendExtensionToUrl(rawUrl, extension) {
  const value = String(rawUrl || "").trim();
  if (!value) return "";
  const match = value.match(/^([^?#]+)([?#].*)?$/);
  const path = match?.[1] || value;
  const suffix = match?.[2] || "";
  if (new RegExp(`\\.${extension}$`, "i").test(path)) return value;
  return `${path}.${extension}${suffix}`;
}

function hasKnownMediaExtension(rawUrl) {
  return /\.(m3u8|mp4|mkv|webm|ts)(\?|#|$)/i.test(String(rawUrl || ""));
}

function isLikelyXtreamLiveUrlWithoutExtension(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!/^https?:\/\//i.test(value)) return false;
  if (hasKnownMediaExtension(value)) return false;

  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 3) return false;
    const lastSegment = segments[segments.length - 1];
    const numericSegments = segments.filter((segment) => /^\d+$/.test(segment)).length;
    return /^\d+$/.test(lastSegment) && numericSegments >= 2;
  } catch {
    return false;
  }
}

function buildXtreamLiveUrl(rawUrl, extension) {
  const value = String(rawUrl || "").trim();
  if (!isLikelyXtreamLiveUrlWithoutExtension(value)) return "";

  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const streamId = segments[segments.length - 1];
    const password = segments[segments.length - 2];
    const username = segments[segments.length - 3];
    return `${parsed.protocol}//${parsed.host}/live/${username}/${password}/${streamId}.${extension}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function isLikelyLiveStreamChannel(channel) {
  if (!channel) return false;
  if (String(channel.kind || "").toLowerCase() === "live") return true;
  return isLikelyXtreamLiveUrlWithoutExtension(channel.url);
}

function buildPlayableSources(rawUrl, altUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) return [];
  const sources = [];
  const pushUnique = (candidate) => {
    const normalized = String(candidate || "").trim();
    if (!normalized || sources.includes(normalized)) return;
    sources.push(normalized);
  };

  if (/\.ts(\?|#|$)/i.test(value)) {
    pushUnique(value);
    pushUnique(appendExtensionToUrl(value.replace(/\.ts(\?|#|$)/i, "$1"), "m3u8"));
  } else if (isLikelyXtreamLiveUrlWithoutExtension(value)) {
    pushUnique(buildXtreamLiveUrl(value, "m3u8"));
    pushUnique(buildXtreamLiveUrl(value, "ts"));
    pushUnique(value);
    pushUnique(appendExtensionToUrl(value, "ts"));
    pushUnique(appendExtensionToUrl(value, "m3u8"));
  } else {
    pushUnique(value);
  }

  const alt = String(altUrl || "").trim();
  if (alt) {
    if (/\.ts(\?|#|$)/i.test(alt)) {
      pushUnique(alt);
      pushUnique(appendExtensionToUrl(alt.replace(/\.ts(\?|#|$)/i, "$1"), "m3u8"));
    } else if (isLikelyXtreamLiveUrlWithoutExtension(alt)) {
      pushUnique(buildXtreamLiveUrl(alt, "m3u8"));
      pushUnique(buildXtreamLiveUrl(alt, "ts"));
      pushUnique(alt);
    } else {
      pushUnique(alt);
    }
  }

  return sources;
}

function mediaTypeFromUrl(url) {
  if (/\.m3u8(\?|$)/i.test(url)) return "application/x-mpegURL";
  if (/\.mp4(\?|$)/i.test(url)) return "video/mp4";
  if (/\.mkv(\?|$)/i.test(url)) return "video/mp4"; // Treat as mp4 for browser playback if supported
  if (/\.webm(\?|$)/i.test(url)) return "video/webm";
  if (/\.ts(\?|$)/i.test(url)) return "video/mp2t";
  return ""; // Let Video.js/browser infer
}

function formatMegabytes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0.00 MB";
  const mb = numeric / (1024 * 1024);
  if (mb >= 100) return `${mb.toFixed(0)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

function formatSpeed(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "--";
  return `${formatMegabytes(numeric)}/s`;
}

function normalizeCategoryLabel(groupRaw) {
  const cleaned = String(groupRaw || "Sem grupo")
    .replace(/^[^A-Za-z0-9À-ÿ]+/u, "")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned.split("|").map((part) => part.trim()).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0].toUpperCase()} | ${parts[1].toUpperCase()}`;
  }

  if (parts.length === 1) {
    return parts[0].toUpperCase();
  }

  return "SEM GRUPO";
}

function isAdultCategoryLabel(labelRaw) {
  const normalized = String(labelRaw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return /\badulto?s?\b|\badult\b|18\+|\bxxx\b|\bporn\b|\bsexo\b|\bsex\b/.test(normalized);
}

function normalizeSearchText(text) {
  return String(text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function matchNav(item, activeNav) {
  if (activeNav === "home") return true;
  
  // Now we rely on 'kind' which is already filtered by the backend/loadChannels
  // But for client-side filtering if needed:
  if (activeNav === "series") return item.kind === 'series';
  if (activeNav === "movies") return item.kind === 'movie';
  if (activeNav === "live") return item.kind === 'live';

  return true;
}

function parseEpisodeInfo(name) {
  // Try common patterns
  // "Series Name S01 E01"
  // "Series Name S01E01"
  // "Series Name 1x01"
  const patterns = [
    /^(.*?) S(\d+) ?E(\d+)/i,
    /^(.*?) S(\d+)E(\d+)/i,
    /^(.*?) (\d+)x(\d+)/i
  ];

  for (const p of patterns) {
    const match = name.match(p);
    if (match) {
      return {
        seriesName: match[1].trim()
          .replace(/[-_]/g, ' ')
          .replace(/\s+/g, ' '),
        season: parseInt(match[2], 10),
        episode: parseInt(match[3], 10),
        title: name
      };
    }
  }
  return {
    seriesName: name.trim(),
    season: 1,
    episode: 1,
    title: name
  };
}

function makeChannelFavoriteId(channelId) {
  return `channel::${String(channelId)}`;
}

function makeSeriesFavoriteId(categoryLabel, seriesName) {
  return `series::${normalizeCategoryLabel(categoryLabel)}::${String(seriesName || "").trim().toLowerCase()}`;
}

function normalizeStorageIds(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((id) => String(id || "").trim())
    .filter(Boolean);
}

function makeSeriesProgressKey(categoryLabel, seriesName) {
  return `${normalizeCategoryLabel(categoryLabel)}::${String(seriesName || "").trim().toLowerCase()}`;
}

const baseButtonStyle = {
  background: "#1a0000",
  color: "#fff",
  border: "1px solid #ff0000",
  borderRadius: 8,
  padding: "8px 12px",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "0 0 8px #ff000044",
};
const CARD_BASE_TRANSITION = "transform 0.16s ease, box-shadow 0.2s ease, border-color 0.2s ease, filter 0.2s ease";
const CARD_ACTIVE_TRANSFORM = "translateY(-3px) scale(1.02)";

const cachedLogoByUrl = new Map();
const inFlightLogoRequests = new Map();
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const PLAYER_VOLUME_STORAGE_KEY = "iptv_player_volume_session";
const HOME_PINNED_PLAYLISTS_STORAGE_KEY = "iptv_home_pinned_playlists";
const APP_HEADER_HEIGHT = 96;

function isKeyboardActivationKey(event) {
  return event.key === "Enter" || event.key === " ";
}

function activateOnKeyboard(event, action) {
  if (!isKeyboardActivationKey(event)) return;
  event.preventDefault();
  action();
}

function getKeyboardButtonProps(label, action) {
  return {
    role: "button",
    tabIndex: 0,
    "aria-label": label,
    onKeyDown: (event) => activateOnKeyboard(event, action),
  };
}

function normalizePlayerVolume(value, fallback = 0.8) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function arePlayerPropsEqual(prevProps, nextProps) {
  return prevProps.src === nextProps.src
    && prevProps.altSrc === nextProps.altSrc
    && prevProps.type === nextProps.type
    && normalizePlayerVolume(prevProps.volume) === normalizePlayerVolume(nextProps.volume)
    && normalizePlayerVolume(prevProps.fallbackUserVolume, -1) === normalizePlayerVolume(nextProps.fallbackUserVolume, -1)
    && prevProps.userHasSetVolume === nextProps.userHasSetVolume
    && prevProps.globalCastActive === nextProps.globalCastActive
    && prevProps.globalCastDevice === nextProps.globalCastDevice;
}

const ReactUrlPlayer = React.memo(({
  src,
  altSrc,
  type,
  onBufferingChange,
  onError,
  onEnded,
  volume = 0.8,
  onVolumeStateChange,
  userHasSetVolume = false,
  fallbackUserVolume = null,
  onCastStart,
  onCastStop,
  globalCastActive: externalCastActive,
  globalCastDevice: externalCastDevice,
}) => {
  const playableSources = useMemo(() => buildPlayableSources(src, altSrc), [src, altSrc]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [loadingState, setLoadingState] = useState("connecting"); // connecting, metadata, buffering, playing, error
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [downloadSpeed, setDownloadSpeed] = useState(0); // bytes/s
  const loadStartRef = useRef(Date.now());
  const lastBufferedRef = useRef({ time: 0, bytes: 0 });
  const playerSource = playableSources[sourceIndex] || "";
  const isHlsSource = useMemo(() => /\.m3u8(\?|#|$)/i.test(playerSource || ""), [playerSource]);
  const playerRef = useRef(null);
  const applyingVolumeRef = useRef(false);

  useEffect(() => {
    setSourceIndex(0);
    setLoadingState("connecting");
    setElapsedSeconds(0);
    setIsBuffering(true);
    setDownloadSpeed(0);
    loadStartRef.current = Date.now();
    lastBufferedRef.current = { time: 0, bytes: 0 };
  }, [src]);

  useEffect(() => {
    setLoadingState("connecting");
    setElapsedSeconds(0);
    setDownloadSpeed(0);
    loadStartRef.current = Date.now();
    lastBufferedRef.current = { time: 0, bytes: 0 };
  }, [sourceIndex]);

  useEffect(() => {
    if (!isBuffering) return;
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - loadStartRef.current) / 1000));

      // Tentar pegar velocidade do HLS.js
      try {
        const hls = playerRef.current?.getInternalPlayer?.('hls');
        if (hls && hls.bandwidthEstimate) {
          setDownloadSpeed(Math.round(hls.bandwidthEstimate / 8)); // bits/s -> bytes/s
          return;
        }
      } catch {}

      // Fallback: estimar via buffered do video element
      try {
        const video = playerRef.current?.getInternalPlayer?.();
        if (video && video.buffered && video.buffered.length > 0) {
          const bufferedEnd = video.buffered.end(video.buffered.length - 1);
          const now = Date.now();
          const prev = lastBufferedRef.current;
          if (prev.time > 0 && bufferedEnd > prev.bytes) {
            const deltaTime = (now - prev.time) / 1000;
            const deltaBuffered = bufferedEnd - prev.bytes;
            // Estimativa: ~500kbps por segundo de vídeo buffered (bitrate médio)
            const estimatedBytesPerSec = (deltaBuffered / deltaTime) * 500000;
            setDownloadSpeed(Math.round(estimatedBytesPerSec));
          }
          lastBufferedRef.current = { time: now, bytes: bufferedEnd };
        }
      } catch {}
    }, 1000);
    return () => clearInterval(interval);
  }, [isBuffering]);

  const getSourceLabel = useCallback((source) => {
    try {
      const url = new URL(source);
      const ext = source.match(/\.(m3u8|ts|mp4|mkv)(\?|#|$)/i)?.[1]?.toUpperCase() || "STREAM";
      const isAlt = altSrc && source.includes(new URL(altSrc).hostname);
      return `${ext}${isAlt ? " (alt)" : ""} — ${url.hostname}`;
    } catch { return source.substring(0, 40); }
  }, [altSrc]);

  // Chromecast state
  const [castDevices, setCastDevices] = useState([]);
  const [castDiscovering, setCastDiscovering] = useState(false);
  const [castShowMenu, setCastShowMenu] = useState(false);
  const castActive = Boolean(externalCastActive);
  const [castError, setCastError] = useState("");

  const handleCastDiscover = useCallback(async () => {
    setCastDiscovering(true);
    setCastError("");
    setCastShowMenu(true);
    try {
      const result = await ipcRenderer.invoke("chromecast-discover");
      if (result.ok) {
        setCastDevices(result.devices || []);
        if ((result.devices || []).length === 0) setCastError("Nenhum Chromecast encontrado na rede.");
      } else {
        setCastError(result.error || "Erro ao descobrir dispositivos.");
      }
    } catch (e) {
      setCastError(e.message || "Erro ao descobrir dispositivos.");
    }
    setCastDiscovering(false);
  }, []);

  const handleCastTo = useCallback(async (device) => {
    setCastShowMenu(false);
    setCastError("");
    try {
      const result = await ipcRenderer.invoke("chromecast-cast", {
        host: device.host,
        port: device.port,
        url: playerSource,
        title: "MindFlix",
        contentType: isHlsSource ? "application/x-mpegURL" : "video/mp4",
      });
      if (result.ok) {
        if (typeof onCastStart === "function") onCastStart(device, playerSource);
      } else {
        setCastError(result.error || "Falha ao enviar para Chromecast.");
      }
    } catch (e) {
      setCastError(e.message || "Falha ao enviar para Chromecast.");
    }
  }, [playerSource, isHlsSource, onCastStart]);

  const handleCastStop = useCallback(async () => {
    await ipcRenderer.invoke("chromecast-stop");
    setCastError("");
    setCastPaused(false);
    setCastCurrentTime(0);
    setCastDuration(0);
    if (typeof onCastStop === "function") onCastStop();
  }, [onCastStop]);

  // Auto-send to Chromecast when source changes and cast is active
  const prevSourceRef = useRef(null);
  useEffect(() => {
    if (!castActive || !externalCastDevice || !playerSource) return;
    if (playerSource === prevSourceRef.current) return;
    prevSourceRef.current = playerSource;

    // Send new source to Chromecast
    ipcRenderer.invoke("chromecast-cast", {
      host: externalCastDevice.host,
      port: externalCastDevice.port,
      url: playerSource,
      title: "MindFlix",
      contentType: /\.m3u8/i.test(playerSource) ? "application/x-mpegURL" : "video/mp4",
    }).then((result) => {
      if (result.ok) {
        setCastPaused(false);
        setCastCurrentTime(0);
        setCastDuration(0);
      }
    });
  }); // run on every render to catch new mount + source change

  // Cast remote controls state
  const [castPaused, setCastPaused] = useState(false);
  const [castCurrentTime, setCastCurrentTime] = useState(0);
  const [castDuration, setCastDuration] = useState(0);
  const [castVolume, setCastVolume] = useState(1);
  const castEndedFiredRef = useRef(false);

  // Poll cast status for controls + detect end of content
  useEffect(() => {
    if (!castActive) {
      castEndedFiredRef.current = false;
      return;
    }
    castEndedFiredRef.current = false;
    const poll = setInterval(async () => {
      try {
        const status = await ipcRenderer.invoke("chromecast-status-request");
        if (status.ok) {
          setCastPaused(status.playerState === "PAUSED");
          if (status.currentTime != null) setCastCurrentTime(status.currentTime);
          if (status.duration != null && status.duration > 0) setCastDuration(status.duration);

          // Detect end: IDLE+FINISHED or currentTime near duration
          const isFinished = status.playerState === "IDLE" && status.idleReason === "FINISHED";
          const isNearEnd = status.duration > 0 && status.currentTime >= status.duration - 3;
          if ((isFinished || isNearEnd) && !castEndedFiredRef.current) {
            castEndedFiredRef.current = true;
            if (typeof onEnded === "function") onEnded();
          }
        }
      } catch {}
    }, 2000);
    return () => clearInterval(poll);
  }, [castActive, onEnded]);

  const handleCastPauseResume = useCallback(async () => {
    if (castPaused) {
      await ipcRenderer.invoke("chromecast-resume");
      setCastPaused(false);
    } else {
      await ipcRenderer.invoke("chromecast-pause");
      setCastPaused(true);
    }
  }, [castPaused]);

  const handleCastSeek = useCallback(async (delta) => {
    const newTime = Math.max(0, castCurrentTime + delta);
    await ipcRenderer.invoke("chromecast-seek", { time: newTime });
    setCastCurrentTime(newTime);
  }, [castCurrentTime]);

  const handleCastSeekBar = useCallback(async (e) => {
    const newTime = Number(e.target.value);
    await ipcRenderer.invoke("chromecast-seek", { time: newTime });
    setCastCurrentTime(newTime);
  }, []);

  const handleCastVolume = useCallback(async (e) => {
    const level = Number(e.target.value);
    setCastVolume(level);
    await ipcRenderer.invoke("chromecast-volume", { level });
  }, []);

  const formatCastTime = (secs) => {
    if (!secs || isNaN(secs)) return "0:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const getMediaElement = useCallback(() => {
    const internalPlayer = playerRef.current?.getInternalPlayer?.();
    if (!internalPlayer) return null;
    if (typeof internalPlayer.volume === "number") return internalPlayer;
    if (internalPlayer?.player && typeof internalPlayer.player.volume === "number") return internalPlayer.player;
    return null;
  }, []);

  const syncVolumeToMediaElement = useCallback(() => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return false;

    // Usar volume do usuário se disponível e válido
    const userVolume = typeof fallbackUserVolume === "number" ? fallbackUserVolume : null;
    const baseVolume = normalizePlayerVolume(volume);
    
    // Se o usuário definiu um volume válido anteriormente, usar esse volume
    const nextVolume = (userHasSetVolume && (userVolume ?? 0) > 0.001) ? (userVolume ?? baseVolume) : baseVolume;
    const shouldBeMuted = nextVolume <= 0.001;

    applyingVolumeRef.current = true;
    if (Math.abs((mediaElement.volume ?? 1) - nextVolume) > 0.001) {
      mediaElement.volume = nextVolume;
    }
    if (mediaElement.muted !== shouldBeMuted) {
      mediaElement.muted = shouldBeMuted;
    }
    Promise.resolve().then(() => {
      applyingVolumeRef.current = false;
    });
    return true;
  }, [fallbackUserVolume, getMediaElement, userHasSetVolume, volume]);

  useEffect(() => {
    if (!playerSource) return;
    const p = playerRef.current?.play?.();
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  }, [playerSource]);

  useEffect(() => {
    return () => {
      try {
        const hls = playerRef.current?.getInternalPlayer?.('hls');
        if (hls && typeof hls.destroy === 'function') {
          hls.destroy();
        }
      } catch {}
    };
  }, [playerSource]);

  // Proteger volume quando o player for inicializado
  useEffect(() => {
    if (!playerSource) return;
    syncVolumeToMediaElement();
  }, [playerSource, syncVolumeToMediaElement]);

  useEffect(() => {
    if (!playerSource) return;

    let cancelled = false;
    let timeoutId = null;
    let attempts = 0;

    const volSetByUser = !!userHasSetVolume;
    const userVol = typeof fallbackUserVolume === "number" ? fallbackUserVolume : null;

    const scheduleSync = () => {
      if (cancelled) return;
      if (volSetByUser && userVol > 0.001) {
        const mediaElement = getMediaElement();
        if (mediaElement && mediaElement.volume <= 0.001) {
          mediaElement.volume = userVol;
          mediaElement.muted = false;
          return;
        }
      }
      syncVolumeToMediaElement();
      attempts += 1;
      if (attempts < 5) {
        timeoutId = window.setTimeout(scheduleSync, 150);
      }
    };

    scheduleSync();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [playerSource, syncVolumeToMediaElement, userHasSetVolume, fallbackUserVolume]);

  useEffect(() => {
    const mediaElement = getMediaElement();
    if (!mediaElement) return undefined;

    const handleVolumeChange = () => {
      if (applyingVolumeRef.current) return;
      const nextVolume = Number.isFinite(mediaElement.volume) ? Math.max(0, Math.min(1, mediaElement.volume)) : 0.8;
      if (mediaElement.muted && nextVolume > 0.001) {
        syncVolumeToMediaElement();
        return;
      }
      onVolumeStateChange?.({ volume: nextVolume });
    };

    mediaElement.addEventListener("volumechange", handleVolumeChange);
    mediaElement.addEventListener("loadedmetadata", syncVolumeToMediaElement);
    return () => {
      mediaElement.removeEventListener("volumechange", handleVolumeChange);
      mediaElement.removeEventListener("loadedmetadata", syncVolumeToMediaElement);
    };
  }, [getMediaElement, onVolumeStateChange, playerSource, syncVolumeToMediaElement]);

  return (
    <div 
      style={{ 
        width: "100%", 
        height: "100%", 
        position: "relative",
        border: "2px solid #ff0000",
        boxShadow: "0 0 20px #ff0000, inset 0 0 20px rgba(255, 0, 0, 0.3)",
        borderRadius: "8px",
        overflow: "hidden"
      }}
    >
      {(() => {
        const effectiveVolume = (userHasSetVolume && typeof fallbackUserVolume === "number") ? fallbackUserVolume : volume;
        return (
      <div style={{ width: "100%", height: "100%", opacity: isBuffering ? 0 : 1, transition: "opacity 0.3s" }}>
      <ReactPlayer
        ref={playerRef}
        key={playerSource || "empty-player"}
        src={playerSource}
        playing={Boolean(playerSource) && !castActive}
        controls
        playsInline
        width="100%"
        height="100%"
        style={{ background: "#000" }}
        volume={effectiveVolume}
        muted={effectiveVolume <= 0.001 || castActive}
        onReady={() => {
          setLoadingState("metadata");
          syncVolumeToMediaElement();
        }}
        onStart={() => {
          setLoadingState("playing");
          setIsBuffering(false);
          syncVolumeToMediaElement();
        }}
        onPlaying={() => {
          setLoadingState("playing");
          setIsBuffering(false);
          onBufferingChange && onBufferingChange(false);
          syncVolumeToMediaElement();
        }}
        config={{
          file: {
            forceHLS: isHlsSource,
            forceVideo: true,
            hlsOptions: {
              enableWorker: true,
              lowLatencyMode: true,
              liveSyncDurationCount: 3,
              liveMaxLatencyDurationCount: 10,
              xhrSetup: (xhr) => {
                xhr.setRequestHeader('Accept', '*/*');
              },
            },
            attributes: {
              crossOrigin: "anonymous",
            },
          },
        }}
        onCanPlay={() => {
          setLoadingState("playing");
          setIsBuffering(false);
          onBufferingChange && onBufferingChange(false);
        }}
        onWaiting={() => {
          setLoadingState("buffering");
          setIsBuffering(true);
          onBufferingChange && onBufferingChange(true);
        }}
        onPause={() => onBufferingChange && onBufferingChange(false)}
        onEnded={() => onEnded && onEnded()}
        onError={(error) => {
          if (sourceIndex < playableSources.length - 1) {
            setSourceIndex((current) => Math.min(current + 1, playableSources.length - 1));
            setLoadingState("connecting");
            setIsBuffering(true);
            onBufferingChange && onBufferingChange(true);
            return;
          }
          setLoadingState("error");
          setIsBuffering(false);
          onBufferingChange && onBufferingChange(false);
          onError && onError(error);
        }}
      /></div>);
      })()}

      {isBuffering && playerSource && (
        <div style={{
          position: "absolute",
          inset: 0,
          zIndex: 20,
          background: "rgba(0,0,0,0.75)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          pointerEvents: "none",
        }}>
          <div style={{ width: 36, height: 36, border: "3px solid #ff000033", borderTop: "3px solid #ff0000", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
            {loadingState === "connecting" && "Conectando ao servidor..."}
            {loadingState === "metadata" && "Recebendo metadados..."}
            {loadingState === "buffering" && "Buffering..."}
          </div>
          <div style={{ color: "#aaa", fontSize: 11, textAlign: "center", maxWidth: 280 }}>
            <div>Fonte {sourceIndex + 1} de {playableSources.length}: {getSourceLabel(playerSource)}</div>
            <div style={{ marginTop: 4 }}>
              {elapsedSeconds}s decorridos
              {downloadSpeed > 0 && ` • ${downloadSpeed >= 1048576 ? `${(downloadSpeed / 1048576).toFixed(1)} MB/s` : downloadSpeed >= 1024 ? `${Math.round(downloadSpeed / 1024)} KB/s` : `${downloadSpeed} B/s`}`}
            </div>
          </div>
          {playableSources.length > 1 && (
            <div style={{ marginTop: 4, width: 120, height: 3, background: "#333", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", background: "#ff0000", borderRadius: 2, width: `${((sourceIndex + 1) / playableSources.length) * 100}%`, transition: "width 0.3s" }} />
            </div>
          )}
        </div>
      )}

      {/* Chromecast button */}
      <button
        type="button"
        onClick={castActive ? handleCastStop : handleCastDiscover}
        title={castActive ? "Parar Chromecast" : "Enviar para Chromecast"}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 30,
          width: 34,
          height: 34,
          borderRadius: "50%",
          border: castActive ? "2px solid #22d3ee" : "1px solid #ff000066",
          background: castActive ? "rgba(34,211,238,0.15)" : "rgba(0,0,0,0.7)",
          color: castActive ? "#22d3ee" : "#fff",
          display: "grid",
          placeItems: "center",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
      >
        <FaChromecast size={16} />
      </button>

      {/* Chromecast device menu */}
      {castShowMenu && (
        <div style={{
          position: "absolute",
          top: 50,
          right: 10,
          zIndex: 35,
          background: "#1a1a1a",
          border: "1px solid #ff000066",
          borderRadius: 10,
          padding: 12,
          minWidth: 200,
          boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>Chromecast</span>
            <button type="button" onClick={() => setCastShowMenu(false)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
          {castDiscovering && (
            <div style={{ color: "#aaa", fontSize: 11, textAlign: "center", padding: 10 }}>
              Buscando dispositivos...
            </div>
          )}
          {!castDiscovering && castDevices.length === 0 && (
            <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: 10 }}>
              {castError || "Nenhum dispositivo encontrado."}
            </div>
          )}
          {castDevices.map((device, i) => (
            <button
              key={`${device.host}-${i}`}
              type="button"
              onClick={() => handleCastTo(device)}
              style={{
                width: "100%",
                padding: "8px 10px",
                marginBottom: 4,
                background: "#222",
                border: "1px solid #333",
                borderRadius: 6,
                color: "#fff",
                fontSize: 12,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              {device.name || device.host}
            </button>
          ))}
          {castError && castDevices.length > 0 && (
            <div style={{ color: "#ff6666", fontSize: 10, marginTop: 6 }}>{castError}</div>
          )}
        </div>
      )}

      {/* Cast active indicator */}
      {castActive && (
        <div style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          zIndex: 30,
          background: "rgba(34,211,238,0.15)",
          border: "1px solid #22d3ee",
          borderRadius: 6,
          padding: "4px 10px",
          color: "#22d3ee",
          fontSize: 10,
          fontWeight: 700,
          pointerEvents: "none",
        }}>
          Transmitindo via Chromecast
        </div>
      )}

      {/* Cast remote controls */}
      {castActive && (
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 32,
          background: "rgba(0,0,0,0.92)",
          borderTop: "1px solid #22d3ee44",
          padding: "10px 14px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}>
          {/* Seek bar */}
          {castDuration > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10, color: "#aaa" }}>
              <span>{formatCastTime(castCurrentTime)}</span>
              <input
                type="range"
                min={0}
                max={castDuration}
                value={castCurrentTime}
                onChange={handleCastSeekBar}
                style={{ flex: 1, height: 4, accentColor: "#22d3ee", cursor: "pointer" }}
              />
              <span>{formatCastTime(castDuration)}</span>
            </div>
          )}
          {/* Controls row */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
            <button type="button" onClick={() => handleCastSeek(-10)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }} title="-10s">
              <MdReplay10 size={20} />
            </button>
            <button type="button" onClick={handleCastPauseResume} style={{ background: "rgba(34,211,238,0.2)", border: "1px solid #22d3ee", borderRadius: "50%", width: 36, height: 36, display: "grid", placeItems: "center", color: "#22d3ee", cursor: "pointer" }} title={castPaused ? "Reproduzir" : "Pausar"}>
              {castPaused ? <FaPlay size={14} /> : <FaPause size={14} />}
            </button>
            <button type="button" onClick={() => handleCastSeek(10)} style={{ background: "none", border: "none", color: "#fff", cursor: "pointer", padding: 4 }} title="+10s">
              <MdForward10 size={20} />
            </button>
            {/* Volume */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 12 }}>
              {castVolume > 0 ? <FaVolumeUp size={13} style={{ color: "#aaa" }} /> : <FaVolumeMute size={13} style={{ color: "#aaa" }} />}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={castVolume}
                onChange={handleCastVolume}
                style={{ width: 60, height: 3, accentColor: "#22d3ee", cursor: "pointer" }}
              />
            </div>
            {/* Stop cast */}
            <button type="button" onClick={castActive ? handleCastStop : undefined} style={{ background: "none", border: "none", color: "#ff6666", cursor: "pointer", padding: 4, marginLeft: 8 }} title="Parar Chromecast">
              <FaTimes size={14} />
            </button>
          </div>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: "-2px",
          left: "-2px",
          right: "-2px",
          bottom: "-2px",
          borderRadius: "8px",
          animation: "neonGlow 2s ease-in-out infinite alternate",
          zIndex: -1
        }}
      />
    </div>
  );
}, arePlayerPropsEqual);

const CachedLogoImage = ({ src, alt, style }) => {
  const imageRef = useRef(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState(() => {
    const source = String(src || "").trim();
    if (!source) return "";
    if (!/^https?:\/\//i.test(source)) return source;
    const existing = cachedLogoByUrl.get(source);
    return existing || TRANSPARENT_PIXEL;
  });

  useEffect(() => {
    const source = String(src || "").trim();
    if (!source) {
      setShouldLoad(false);
      return;
    }
    if (!/^https?:\/\//i.test(source)) {
      setShouldLoad(true);
      return;
    }

    const element = imageRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { root: null, rootMargin: "260px", threshold: 0.01 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [src]);

  useEffect(() => {
    let cancelled = false;
    const source = String(src || "").trim();

    if (!source) {
      setResolvedSrc("");
      return () => {
        cancelled = true;
      };
    }

    const applyResolved = (value) => {
      if (!cancelled && value) {
        setResolvedSrc(value);
      }
    };

    if (!/^https?:\/\//i.test(source)) {
      applyResolved(source);
      return () => {
        cancelled = true;
      };
    }

    if (!shouldLoad) {
      setResolvedSrc(TRANSPARENT_PIXEL);
      return () => {
        cancelled = true;
      };
    }

    const existing = cachedLogoByUrl.get(source);
    if (existing) {
      applyResolved(existing);
      return () => {
        cancelled = true;
      };
    }

    setResolvedSrc(TRANSPARENT_PIXEL);

    const running = inFlightLogoRequests.get(source) || ipcRenderer.invoke("iptv-cache-logo", source);
    inFlightLogoRequests.set(source, running);

    running
      .then((response) => {
        const logoPath = response?.logoPath || source;
        cachedLogoByUrl.set(source, logoPath);
        applyResolved(logoPath);
      })
      .catch(() => applyResolved(source))
      .finally(() => {
        if (inFlightLogoRequests.get(source) === running) {
          inFlightLogoRequests.delete(source);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [src, shouldLoad]);

  if (!resolvedSrc) return null;
  return <img ref={imageRef} src={resolvedSrc} alt={alt} style={style} loading="lazy" />;
};

const FadeTransition = ({ transitionKey, duration = 400, children, style: extraStyle }) => {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    setOpacity(0);
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(() => setOpacity(1));
    });
    return () => cancelAnimationFrame(frame);
  }, [transitionKey]);

  return (
    <div style={{ opacity, transition: `opacity ${duration}ms ease`, minHeight: 0, ...extraStyle }}>
      {children}
    </div>
  );
};

const StaggeredItem = ({ index, delay = 60, children }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), index * delay);
    return () => clearTimeout(timer);
  }, [index, delay]);

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? "translateY(0)" : "translateY(12px)",
      transition: "opacity 0.4s ease, transform 0.4s ease",
    }}>
      {children}
    </div>
  );
};

const CARDS_PER_ROW = 5;
function getCardStaggerStyle(index) {
  const row = Math.floor(index / CARDS_PER_ROW);
  const delayMs = Math.min(row * 50, 400);
  return {
    opacity: 0,
    animation: `fadeSlideIn 0.4s ease ${delayMs}ms forwards`,
  };
}

const HorizontalRow = ({ children }) => {
  const scrollRef = useRef(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeft(el.scrollLeft > 20);
    setShowRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 20);
  }, []);

  useEffect(() => {
    updateArrows();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateArrows);
      ro.disconnect();
    };
  }, [updateArrows, children]);

  const scroll = (direction) => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === "right" ? amount : -amount, behavior: "smooth" });
  };

  const arrowStyle = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 44,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    zIndex: 10,
    border: "none",
    color: "#fff",
    fontSize: 20,
    opacity: 0.8,
    transition: "opacity 0.2s",
  };

  return (
    <div style={{ position: "relative" }}>
      {showLeft && (
        <button
          type="button"
          onClick={() => scroll("left")}
          aria-label="Rolar para esquerda"
          style={{ ...arrowStyle, left: 0, background: "linear-gradient(to right, rgba(0,0,0,0.85) 60%, transparent)" }}
        >
          <FaChevronLeft />
        </button>
      )}
      <div
        ref={scrollRef}
        className="hide-scrollbar"
        style={{
          display: "flex",
          gap: 12,
          overflowX: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          paddingBottom: 4,
        }}
      >
        {children}
      </div>
      {showRight && (
        <button
          type="button"
          onClick={() => scroll("right")}
          aria-label="Rolar para direita"
          style={{ ...arrowStyle, right: 0, background: "linear-gradient(to left, rgba(0,0,0,0.85) 60%, transparent)" }}
        >
          <FaChevronRight />
        </button>
      )}
    </div>
  );
};

export default function IptvModule({ onBack }) {
  const [form, setForm] = useState({
    url: "",
  });

  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("Informe a URL da lista M3U.");
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // 'home', 'live', 'movies', 'series', 'playlists'
  const [activeNav, setActiveNav] = useState("home");
  
  // Used for data fetching
  const kind = "all";

  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("");

  const [channels, setChannels] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showPlayer, setShowPlayer] = useState(false);
  const [buffering, setBuffering] = useState(false);

  // Chromecast global state
  const [globalCastActive, setGlobalCastActive] = useState(false);
  const [globalCastDevice, setGlobalCastDevice] = useState(null);
  const [globalCastTitle, setGlobalCastTitle] = useState("");
  const [headerCastMenu, setHeaderCastMenu] = useState(false);
  const [headerCastDevices, setHeaderCastDevices] = useState([]);
  const [headerCastDiscovering, setHeaderCastDiscovering] = useState(false);

  // Refs for cast state so callbacks always read fresh values
  const globalCastActiveRef = useRef(false);
  const globalCastDeviceRef = useRef(null);
  useEffect(() => { globalCastActiveRef.current = globalCastActive; }, [globalCastActive]);
  useEffect(() => { globalCastDeviceRef.current = globalCastDevice; }, [globalCastDevice]);

  // For Series Navigation
  const [viewState, setViewState] = useState("categories"); // categories, series_list, seasons, episodes
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);

  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [focusedCardId, setFocusedCardId] = useState(null);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [infoChannel, setInfoChannel] = useState(null);
  const [userInteracting, setUserInteracting] = useState(false);
  const [newM3uModalOpen, setNewM3uModalOpen] = useState(false);
  const [newM3uUrlInput, setNewM3uUrlInput] = useState("");
  const [newM3uProgress, setNewM3uProgress] = useState(0);
  const [newM3uStage, setNewM3uStage] = useState("");
  const [newM3uError, setNewM3uError] = useState("");
  const [newM3uDone, setNewM3uDone] = useState(false);
  const [createPlaylistModalOpen, setCreatePlaylistModalOpen] = useState(false);
  const [createPlaylistNameInput, setCreatePlaylistNameInput] = useState("");
  const [contentLoadProgress, setContentLoadProgress] = useState(0);
  const [contentLoadStage, setContentLoadStage] = useState("");
  const [downloadMetrics, setDownloadMetrics] = useState({
    receivedBytes: 0,
    totalBytes: 0,
    speedBps: 0,
  });
  const [tmdbModalOpen, setTmdbModalOpen] = useState(false);
  const [tmdbApiKeyInput, setTmdbApiKeyInput] = useState("");
  const [savingTmdbApiKey, setSavingTmdbApiKey] = useState(false);
  const [favoriteIds, setFavoriteIds] = useState([]);
  const [likedIds, setLikedIds] = useState([]);
  const [recentlyPlayedIds, setRecentlyPlayedIds] = useState([]);
  const [customPlaylists, setCustomPlaylists] = useState([]);
  const [hasLoadedCustomPlaylists, setHasLoadedCustomPlaylists] = useState(false);
  const [pinnedPlaylistIds, setPinnedPlaylistIds] = useState([]);
  const [playlistDeleteModalState, setPlaylistDeleteModalState] = useState(null);
  const [lastEpisodesBySeries, setLastEpisodesBySeries] = useState({});
  const [homeTab, setHomeTab] = useState("inicio");
  const [contextMenuState, setContextMenuState] = useState(null);
  const [adultMoviesUnlocked, setAdultMoviesUnlocked] = useState(false);
  const [selectedSynopsis, setSelectedSynopsis] = useState("");
  const [selectedSynopsisMeta, setSelectedSynopsisMeta] = useState({ year: "", rating: null, posterUrl: "" });
  const [synopsisHint, setSynopsisHint] = useState("");
  const [loadingSynopsis, setLoadingSynopsis] = useState(false);
  const [synopsisRefreshTick, setSynopsisRefreshTick] = useState(0);
  const [playerVolume, setPlayerVolume] = useState(() => {
    const parsed = Number(sessionStorage.getItem(PLAYER_VOLUME_STORAGE_KEY));
    if (!Number.isFinite(parsed)) return 0.8;
    const volume = Math.max(0, Math.min(1, parsed));
    // Garantir que não comece mutado (volume muito baixo)
    return volume < 0.1 ? 0.8 : volume;
  });

  const rowRefs = useRef({});
  const contentRef = useRef(null);
  const menuRef = useRef(null);
  const menuBtnRef = useRef(null);
  const scrollDebounceRef = useRef(null);
  const skipNextSessionLoadRef = useRef(false);
  const nativeFallbackKeyRef = useRef("");
  const contextMenuRef = useRef(null);
  
  // Refs para proteção do volume
  const userVolumeRef = useRef(playerVolume);
  const volumeSetByUserRef = useRef(false);

  const handleScrollInteract = useCallback(() => {
    setUserInteracting(true);
    if (scrollDebounceRef.current) {
      window.clearTimeout(scrollDebounceRef.current);
    }
    scrollDebounceRef.current = window.setTimeout(() => {
      setUserInteracting(false);
    }, 300);
  }, []);

  useEffect(() => {
    const onDownloadProgress = (_event, payload) => {
      setDownloadMetrics({
        receivedBytes: Math.max(0, Number(payload?.receivedBytes || 0)),
        totalBytes: Math.max(0, Number(payload?.totalBytes || 0)),
        speedBps: Math.max(0, Number(payload?.speedBps || 0)),
      });
    };

    ipcRenderer.on("iptv-download-progress", onDownloadProgress);
    return () => {
      ipcRenderer.removeListener("iptv-download-progress", onDownloadProgress);
    };
  }, []);

  // Chromecast status listener — usado para próximo episódio automático
  const castEndedCallbackRef = useRef(null);
  const castEndedHandledRef = useRef(false);
  useEffect(() => {
    const onCastStatus = (_event, status) => {
      if (status.playerState === 'ENDED') {
        if (castEndedHandledRef.current) return; // already handled
        castEndedHandledRef.current = true;
        if (typeof castEndedCallbackRef.current === 'function') {
          // Callback (next episode) will re-cast, so keep device active
          castEndedCallbackRef.current();
        } else {
          // No next episode — clean up cast state
          setGlobalCastActive(false);
          setGlobalCastDevice(null);
          setGlobalCastTitle("");
        }
      } else if (status.playerState === 'PLAYING' || status.playerState === 'BUFFERING') {
        // Reset the handled flag when new content starts playing
        castEndedHandledRef.current = false;
      }
    };
    ipcRenderer.on("chromecast-status", onCastStatus);
    return () => {
      ipcRenderer.removeListener("chromecast-status", onCastStatus);
    };
  }, []);

  // Auto-send to Chromecast when selected content changes with cast connected
  const prevCastUrlRef = useRef(null);
  useEffect(() => {
    if (!globalCastActive || !globalCastDevice || !selected?.url) return;
    const url = toPlayableUrl(selected.url);
    if (url === prevCastUrlRef.current) return;
    prevCastUrlRef.current = url;

    ipcRenderer.invoke("chromecast-cast", {
      host: globalCastDevice.host,
      port: globalCastDevice.port,
      url: url,
      title: selected.name || "MindFlix",
      contentType: /\.m3u8/i.test(url) ? "application/x-mpegURL" : "video/mp4",
    }).then((result) => {
      if (result.ok) {
        setGlobalCastTitle(selected.name || "");
      }
    });
  }, [selected, globalCastActive, globalCastDevice]);

  useEffect(() => {
    let cancelled = false;

    const syncFullscreenState = async () => {
      try {
        const response = await ipcRenderer.invoke("iptv-get-fullscreen-state");
        if (cancelled) return;
        if (response?.ok) {
          setIsFullscreen(Boolean(response.isFullScreen));
        }
      } catch {
      }
    };

    syncFullscreenState();
    window.addEventListener("resize", syncFullscreenState);
    window.addEventListener("focus", syncFullscreenState);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", syncFullscreenState);
      window.removeEventListener("focus", syncFullscreenState);
    };
  }, []);

  useEffect(() => {
    const saved = {
      url: localStorage.getItem("iptv_url") || "",
    };

    setForm((prev) => ({ ...prev, ...saved }));
    let cancelled = false;

    const bootstrapFromLocalCache = async () => {
      const savedUrl = String(saved.url || "").trim();
      if (!savedUrl) return;

      try {
        const result = await ipcRenderer.invoke("iptv-has-local-playlist");
        if (cancelled || !result?.ok || !result?.hasPlaylist) return;

        setSession({
          sourceUrl: savedUrl,
          sourceMasked: savedUrl,
          userInfo: { status: "cache-local" },
        });
        setStatus("Playlist local encontrada. Carregando conteúdo...");
      } catch {
        if (!cancelled) {
          setStatus("Informe a URL da lista M3U.");
        }
      }
    };

    bootstrapFromLocalCache();

    try {
      const parsedFavorites = JSON.parse(localStorage.getItem("iptv_favorites") || "[]");
      const normalizedFavorites = Array.isArray(parsedFavorites)
        ? parsedFavorites.map((id) => {
            const value = String(id);
            if (value.startsWith("channel::") || value.startsWith("series::")) return value;
            return makeChannelFavoriteId(value);
          })
        : [];
      setFavoriteIds(normalizedFavorites);
      setLikedIds(normalizeStorageIds(JSON.parse(localStorage.getItem("iptv_likes") || "[]")));
      setRecentlyPlayedIds(normalizeStorageIds(JSON.parse(localStorage.getItem("iptv_recent") || "[]")));
      setPinnedPlaylistIds(normalizeStorageIds(JSON.parse(localStorage.getItem(HOME_PINNED_PLAYLISTS_STORAGE_KEY) || "[]")));
    } catch {
      setFavoriteIds([]);
      setLikedIds([]);
      setRecentlyPlayedIds([]);
      setPinnedPlaylistIds([]);
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadPersistentIptvState = async () => {
      try {
        const [playlistsResponse, lastEpisodesResponse] = await Promise.all([
          ipcRenderer.invoke("iptv-get-custom-playlists"),
          ipcRenderer.invoke("iptv-get-last-episodes"),
        ]);
        if (cancelled) return;
        if (playlistsResponse?.ok) {
          setCustomPlaylists(Array.isArray(playlistsResponse.playlists) ? playlistsResponse.playlists : []);
          setHasLoadedCustomPlaylists(true);
        }
        if (lastEpisodesResponse?.ok) {
          setLastEpisodesBySeries(lastEpisodesResponse.data && typeof lastEpisodesResponse.data === "object" ? lastEpisodesResponse.data : {});
        }
      } catch {
      }
    };

    loadPersistentIptvState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("iptv_favorites", JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    localStorage.setItem("iptv_likes", JSON.stringify(likedIds));
  }, [likedIds]);

  useEffect(() => {
    localStorage.setItem("iptv_recent", JSON.stringify(recentlyPlayedIds));
  }, [recentlyPlayedIds]);

  useEffect(() => {
    localStorage.setItem(HOME_PINNED_PLAYLISTS_STORAGE_KEY, JSON.stringify(pinnedPlaylistIds));
  }, [pinnedPlaylistIds]);

  useEffect(() => {
    if (!hasLoadedCustomPlaylists) {
      return;
    }
    const validIds = new Set(customPlaylists.map((playlist) => String(playlist.id || "")));
    setPinnedPlaylistIds((prev) => {
      const next = prev.filter((id) => validIds.has(String(id)));
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [customPlaylists, hasLoadedCustomPlaylists]);

  useEffect(() => {
    sessionStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, String(playerVolume));
  }, [playerVolume]);

  // Atualizar referência do volume do usuário quando ele muda
  useEffect(() => {
    if (playerVolume > 0.001) {
      userVolumeRef.current = playerVolume;
      volumeSetByUserRef.current = true;
    }
  }, [playerVolume]);

  // Proteger contra redefinição de volume para 0
  useEffect(() => {
    if (volumeSetByUserRef.current && playerVolume <= 0.001 && userVolumeRef.current > 0.001) {
      // Volume foi redefinido para 0/mudo mas usuário tinha volume maior - restaurar
      setTimeout(() => {
        setPlayerVolume(userVolumeRef.current);
      }, 100);
    }
  }, [playerVolume]);

  const handlePlayerVolumeStateChange = useCallback(({ volume }) => {
    const nextVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    if (nextVolume > 0.001) {
      volumeSetByUserRef.current = true;
      userVolumeRef.current = nextVolume;
    }
    setPlayerVolume((prev) => (Math.abs(prev - nextVolume) > 0.001 ? nextVolume : prev));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const selectedKind = String(selected?.kind || "").toLowerCase();
    const isMovieOrSeries = selectedKind === "movie" || selectedKind === "series";
    const isSeriesEpisodesView = activeNav === "series" && viewState === "episodes" && selectedKind === "series";
    const shouldLoadSynopsis = Boolean(selected) && ((showPlayer && isMovieOrSeries) || isSeriesEpisodesView);

    if (!shouldLoadSynopsis) {
      setSelectedSynopsis("");
      setSelectedSynopsisMeta({ year: "", rating: null, posterUrl: "" });
      setSynopsisHint("");
      setLoadingSynopsis(false);
      return () => {
        cancelled = true;
      };
    }

    setLoadingSynopsis(true);
    setSelectedSynopsis("");
    setSelectedSynopsisMeta({ year: "", rating: null, posterUrl: "" });
    setSynopsisHint("");

    ipcRenderer
      .invoke("iptv-get-synopsis", {
        channel: {
          id: selected.id,
          name: selected.name,
          tvgId: selected.tvgId,
          kind: selected.kind,
          group: selected.group,
        },
      })
      .then((response) => {
        if (cancelled) return;
        if (!response?.ok) {
          setSelectedSynopsis("");
          setSelectedSynopsisMeta({ year: "", rating: null, posterUrl: "" });
          setSynopsisHint("Falha ao consultar TMDB no momento.");
          return;
        }
        const synopsisText = String(response?.synopsis || "").trim();
        const yearText = String(response?.year || "").trim();
        const ratingValue = Number(response?.rating);
        const posterUrl = String(response?.posterUrl || "").trim();
        const hasMeta = Boolean(yearText || Number.isFinite(ratingValue) || posterUrl);
        if (synopsisText || hasMeta) {
          setSelectedSynopsis(synopsisText);
          setSelectedSynopsisMeta({
            year: yearText,
            rating: Number.isFinite(ratingValue) ? ratingValue : null,
            posterUrl,
          });
          setSynopsisHint(synopsisText ? "" : "Sinopse não encontrada no TMDB.");
          return;
        }

        const reason = String(response?.reason || "").trim();
        if (reason === "missing_api_key") {
          setSynopsisHint("Chave TMDB não configurada no app.");
          return;
        }
        if (reason === "unsupported_kind") {
          setSynopsisHint("Sinopse disponível apenas para filmes e séries.");
          return;
        }
        if (reason === "missing_title") {
          setSynopsisHint("Título inválido para busca no TMDB.");
          return;
        }
        if (reason === "request_error") {
          setSynopsisHint("Falha ao consultar TMDB no momento.");
          return;
        }
        if (reason === "not_found") {
          setSynopsisHint("Sinopse não encontrada no TMDB.");
          return;
        }
        setSynopsisHint("Sinopse indisponível para este conteúdo.");
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedSynopsis("");
          setSelectedSynopsisMeta({ year: "", rating: null, posterUrl: "" });
          setSynopsisHint("Falha ao consultar TMDB no momento.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingSynopsis(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showPlayer, selected?.id, selected?.name, selected?.kind, selected?.tvgId, selected?.group, activeNav, viewState, synopsisRefreshTick]);

  useEffect(() => {
    const resolvedUrl = String(session?.sourceUrl || form.url || "").trim();
    if (!resolvedUrl) return;
    localStorage.setItem("iptv_url", resolvedUrl);
  }, [session?.sourceUrl, form.url]);

  useEffect(() => {
    const closeMenuByOutsideClick = (event) => {
      if (!menuOpen) return;

      if (
        menuRef.current &&
        !menuRef.current.contains(event.target) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", closeMenuByOutsideClick);
    return () => document.removeEventListener("mousedown", closeMenuByOutsideClick);
  }, [menuOpen]);

  useEffect(() => {
    if (!contextMenuState) return undefined;
    const closeContextMenu = (event) => {
      if (contextMenuRef.current && contextMenuRef.current.contains(event.target)) return;
      setContextMenuState(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setContextMenuState(null);
      }
    };
    document.addEventListener("mousedown", closeContextMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeContextMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenuState]);

  const channelById = useMemo(() => {
    const map = new Map();
    channels.forEach((item) => {
      map.set(item.id, item);
      map.set(String(item.id), item);
    });
    return map;
  }, [channels]);

  const seriesCatalog = useMemo(() => {
    const catalog = new Map();

    channels.forEach((channel) => {
      if (channel.kind !== "series") return;
      const info = parseEpisodeInfo(channel.name);
      const groupName = normalizeCategoryLabel(channel.group);
      const favoriteId = makeSeriesFavoriteId(groupName, info.seriesName);

      if (!catalog.has(favoriteId)) {
        catalog.set(favoriteId, {
          id: favoriteId,
          name: info.seriesName,
          group: groupName,
          logo: channel.logo,
          kind: "series",
          favoriteType: "series",
        });
      }
    });

    return catalog;
  }, [channels]);

  const favorites = useMemo(() => {
    return favoriteIds
      .map((favoriteId) => {
        const id = String(favoriteId);

        if (id.startsWith("series::")) {
          return seriesCatalog.get(id) || null;
        }

        const rawId = id.replace(/^channel::/, "");
        return channelById.get(rawId) || channelById.get(Number(rawId)) || null;
      })
      .filter(Boolean);
  }, [favoriteIds, channelById, seriesCatalog]);

  const recentItems = useMemo(() => {
    return recentlyPlayedIds
      .map((id) => channelById.get(id) || channelById.get(Number(id)))
      .filter(Boolean);
  }, [recentlyPlayedIds, channelById]);

  const filteredChannels = useMemo(() => {
    const searchNorm = normalizeSearchText(search);
    const source = activeNav === "minha-lista" ? favorites : channels;

    return source.filter((item) => {
      if (!matchNav(item, activeNav)) return false;

      const groupMatch = !group || item.group === group;
      if (!groupMatch) return false;

      if (!searchNorm) return true;

      if (
        normalizeSearchText(item.name).includes(searchNorm) ||
        normalizeSearchText(item.group).includes(searchNorm)
      ) return true;

      // Para séries, buscar também pelo nome da série extraído
      if (item.kind === "series") {
        const info = parseEpisodeInfo(item.name);
        if (normalizeSearchText(info.seriesName).includes(searchNorm)) return true;
      }

      return false;
    });
  }, [channels, favorites, activeNav, group, search]);

  const recommendedItems = useMemo(() => {
    const pool = channels.filter((c) => c.kind === "movie" || c.kind === "series");
    if (pool.length === 0) return [];
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 20);
  }, [channels]);

  const rows = useMemo(() => {
    const base = filteredChannels;
    const list = [];

    if (activeNav !== "minha-lista") {
      if (favorites.length > 0) {
        list.push({ key: "favoritos", title: "Favoritos", items: favorites.slice(0, 30) });
      }
      if (recentItems.length > 0) {
        list.push({ key: "continuar", title: "Continuar assistindo", items: recentItems.slice(0, 30) });
      }
      if (base.length > 0) {
        list.push({ key: "em-alta", title: "Em alta", items: base.slice(0, 30) });
      }
      if (base.length > 0) {
        list.push({ key: "top10", title: "Top 10", items: base.slice(0, 10) });
      }
    } else {
      list.push({ key: "minha-lista-only", title: "Minha Lista", items: base.slice(0, 50) });
    }

    const byCategory = new Map();

    base.forEach((item) => {
      const category = normalizeCategoryLabel(item.group);
      if (!byCategory.has(category)) byCategory.set(category, []);
      const arr = byCategory.get(category);
      if (arr.length < 30) arr.push(item);
    });

    const orderedCategories = [...byCategory.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10);

    orderedCategories.forEach(([category, items], idx) => {
      list.push({ key: `cat-${idx}-${category}`, title: category, items });
    });

    return list.filter((row) => row.items.length > 0);
  }, [filteredChannels, favorites, recentItems, activeNav]);

  const seriesData = useMemo(() => {
    if (activeNav !== "series") return {};

    const data = {};
    const source = filteredChannels;

    source.forEach((channel) => {
      const groupName = normalizeCategoryLabel(channel.group);
      const info = parseEpisodeInfo(channel.name);

      if (!data[groupName]) {
        data[groupName] = {};
      }

      if (!data[groupName][info.seriesName]) {
        data[groupName][info.seriesName] = {
          name: info.seriesName,
          logo: channel.logo,
          seasons: {},
        };
      }

      const series = data[groupName][info.seriesName];
      const seasonKey = String(info.season);

      if (!series.seasons[seasonKey]) {
        series.seasons[seasonKey] = [];
      }

      series.seasons[seasonKey].push({
        ...channel,
        episodeNum: info.episode,
      });
    });

    return data;
  }, [filteredChannels, activeNav]);

  const movieCategories = useMemo(() => {
    if (activeNav !== "movies") return [];

    const searchNorm = normalizeSearchText(search);
    const byCategory = new Map();

    channels.forEach((item) => {
      if (item.kind !== "movie") return;
      if (
        searchNorm &&
        !normalizeSearchText(item.name).includes(searchNorm) &&
        !normalizeSearchText(item.group).includes(searchNorm)
      ) {
        return;
      }

      const key = normalizeCategoryLabel(item.group);
      if (!byCategory.has(key)) {
        byCategory.set(key, { raw: item.group, label: key, count: 0 });
      }
      byCategory.get(key).count += 1;
    });

    return [...byCategory.values()].sort((a, b) => {
      const aAdult = isAdultCategoryLabel(a.label);
      const bAdult = isAdultCategoryLabel(b.label);

      if (aAdult !== bAdult) {
        return aAdult ? 1 : -1;
      }

      return b.count - a.count;
    });
  }, [channels, activeNav, search]);

  const liveCategories = useMemo(() => {
    if (activeNav !== "live") return [];

    const searchNorm = normalizeSearchText(search);
    const byCategory = new Map();

    channels.forEach((item) => {
      if (item.kind !== "live") return;
      if (
        searchNorm &&
        !normalizeSearchText(item.name).includes(searchNorm) &&
        !normalizeSearchText(item.group).includes(searchNorm)
      ) {
        return;
      }

      const key = normalizeCategoryLabel(item.group);
      if (!byCategory.has(key)) {
        byCategory.set(key, { raw: item.group, label: key, count: 0 });
      }
      byCategory.get(key).count += 1;
    });

    return [...byCategory.values()].sort((a, b) => {
      const aAdult = isAdultCategoryLabel(a.label);
      const bAdult = isAdultCategoryLabel(b.label);

      if (aAdult !== bAdult) {
        return aAdult ? 1 : -1;
      }

      return b.count - a.count;
    });
  }, [channels, activeNav, search]);

  useEffect(() => {
    if (activeNav === "series") {
      return;
    }

    if (!selected && filteredChannels.length > 0 && !userInteracting) {
      setSelected(filteredChannels[0]);
    }
  }, [filteredChannels, selected, activeNav, userInteracting]);

  useEffect(() => {
    if (activeNav !== "movies") return;

    if (movieCategories.length === 0) {
      if (group) setGroup("");
      return;
    }

    const fallbackCategory = movieCategories.find((category) => !isAdultCategoryLabel(category.label));
    const selectedCategory = movieCategories.find((category) => category.raw === group);

    if (selectedCategory && isAdultCategoryLabel(selectedCategory.label) && !adultMoviesUnlocked) {
      setGroup(fallbackCategory?.raw || "");
      setShowPlayer(false);
      return;
    }

    if (!group || !movieCategories.some((category) => category.raw === group)) {
      if (fallbackCategory) {
        setGroup(fallbackCategory.raw);
      } else if (adultMoviesUnlocked) {
        setGroup(movieCategories[0].raw);
      } else {
        setGroup("");
      }
    }
  }, [activeNav, movieCategories, group, adultMoviesUnlocked]);

  useEffect(() => {
    if (activeNav !== "live") return;

    if (liveCategories.length === 0) {
      if (group) setGroup("");
      return;
    }

    if (!group || !liveCategories.some((category) => category.raw === group)) {
      setGroup(liveCategories[0].raw);
    }
  }, [activeNav, liveCategories, group]);

  useEffect(() => {
    if (activeNav !== "series" || viewState !== "categories") return;

    const categories = Object.keys(seriesData).sort();
    if (!categories.length) {
      if (selectedCategory) setSelectedCategory(null);
      return;
    }

    if (!selectedCategory || !categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0]);
    }
  }, [activeNav, viewState, seriesData, selectedCategory]);

  const loadChannels = async (force = false, sourceOverride = null, onProgress = null, options = {}) => {
    const sourceUrl = sourceOverride || session?.sourceUrl;
    if (!sourceUrl) return;
    const reportProgress = typeof onProgress === "function" ? onProgress : null;
    const updateStatus = options?.updateStatus !== false;

    setLoadingChannels(true);
    if (updateStatus) {
      setStatus("Carregando canais...");
    }
    setChannels([]);
    setSelected(null);
    setGroups([]);
    setGroup("");

    const pageSize = getLimitForKind(kind);
    let nextOffset = 0;
    let hasMore = true;
    let totalFiltered = 0;
    let totalAll = 0;
    let mergedChannels = [];
    let resolvedGroups = [];
    reportProgress?.({ stage: "Baixando e processando M3U...", percent: 35, loaded: 0, total: 0 });

    while (hasMore) {
      const response = await ipcRenderer.invoke("iptv-load-channels", {
        sourceUrl,
        kind,
        limit: pageSize,
        offset: nextOffset,
        force: force && nextOffset === 0,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "Falha ao carregar playlist IPTV.");
      }

      const incoming = response.channels || [];
      mergedChannels = mergedChannels.concat(incoming);
      totalFiltered = response.totalFiltered || 0;
      totalAll = response.totalAll || 0;
      nextOffset = Number(response.nextOffset || mergedChannels.length);
      hasMore = Boolean(response.hasMore);
      resolvedGroups = response.groups || resolvedGroups;
      const normalizedTotal = Math.max(1, Number(totalFiltered || mergedChannels.length || 1));
      const ratio = Math.max(0, Math.min(1, mergedChannels.length / normalizedTotal));
      const percent = Math.max(35, Math.min(98, 35 + Math.round(ratio * 63)));

      setChannels(mergedChannels);
      if (updateStatus) {
        setStatus(`Carregando ${mergedChannels.length} de ${totalFiltered} itens...`);
      }
      reportProgress?.({
        stage: "Processando itens da playlist...",
        percent,
        loaded: mergedChannels.length,
        total: totalFiltered,
      });
    }

    setGroups(resolvedGroups);

    if (updateStatus) {
      setStatus(
        `Mostrando ${mergedChannels.length} de ${totalFiltered} itens (${totalAll} no total).`
      );
    }
    reportProgress?.({
      stage: "Finalizando carregamento...",
      percent: 100,
      loaded: mergedChannels.length,
      total: totalFiltered,
    });

    if (mergedChannels.length > 0) {
      setSelected(mergedChannels[0]);
    }
  };

  useEffect(() => {
    if (!session) return;
    if (skipNextSessionLoadRef.current) {
      skipNextSessionLoadRef.current = false;
      return;
    }
    const fromLocalCache = String(session?.userInfo?.status || "").toLowerCase() === "cache-local";
    setDownloadMetrics({ receivedBytes: 0, totalBytes: 0, speedBps: 0 });
    setContentLoadProgress(8);
    setContentLoadStage(fromLocalCache ? "Processando Conteúdo..." : "Carregando conteúdo...");

    loadChannels(false, null, ({ stage, percent }) => {
      if (Number.isFinite(percent)) {
        setContentLoadProgress(percent);
      }
      if (fromLocalCache) {
        setContentLoadStage("Processando Conteúdo...");
        return;
      }
      if (stage) {
        setContentLoadStage(stage);
      }
    })
      .catch((error) => {
        setContentLoadStage("Falha ao processar conteúdo.");
        setStatus(error.message);
      })
      .finally(() => {
        setContentLoadProgress(100);
        setContentLoadStage("Finalizado.");
        setLoadingChannels(false);
      });
  }, [session]);

  const handleLogin = async (event) => {
    event.preventDefault();
    const normalizedUrl = String(form.url || "").trim();

    if (!normalizedUrl) {
      setNewM3uError("Preencha a URL da lista.");
      setStatus("Preencha a URL da lista.");
      return;
    }

    setLoadingLogin(true);
    setDownloadMetrics({ receivedBytes: 0, totalBytes: 0, speedBps: 0 });
    setNewM3uError("");
    setNewM3uDone(false);
    setNewM3uProgress(8);
    setNewM3uStage("Validando URL...");
    setStatus("Validando URL...");

    try {
      setNewM3uProgress(18);
      setNewM3uStage("Conectando à fonte da playlist...");
      const response = await ipcRenderer.invoke("iptv-validate-login", { url: normalizedUrl });

      if (!response?.ok) {
        throw new Error(response?.error || "Falha ao carregar a lista.");
      }
      setNewM3uProgress(28);
      setNewM3uStage("Baixando e processando M3U...");

      const nextSession = {
        sourceUrl: response.sourceUrl,
        sourceMasked: response.sourceMasked,
        userInfo: response.userInfo,
      };

      await loadChannels(
        true,
        normalizedUrl,
        ({ stage, percent }) => {
          if (stage) setNewM3uStage(stage);
          if (Number.isFinite(percent)) setNewM3uProgress(percent);
        },
        { updateStatus: false }
      );

      setForm((prev) => ({ ...prev, url: normalizedUrl }));
      skipNextSessionLoadRef.current = true;
      setSession(nextSession);
      localStorage.setItem("iptv_url", normalizedUrl);
      setNewM3uProgress(100);
      setNewM3uStage("Finalizado.");
      setNewM3uDone(true);
      setStatus("Lista validada e carregada com sucesso.");
    } catch (error) {
      const rawMessage = String(error?.message || "").trim();
      let friendly = rawMessage || "Erro inesperado.";
      if (/HTTP\s+\d+/i.test(rawMessage)) {
        friendly = `Falha no download da playlist (${rawMessage}).`;
      } else if (rawMessage.includes("nenhum cache local")) {
        friendly = "Não foi possível baixar a playlist e não existe cache local disponível.";
      } else if (rawMessage.includes("nenhum canal foi identificado")) {
        friendly = "A URL respondeu, mas o conteúdo não parece ser uma playlist M3U válida.";
      }
      setNewM3uError(friendly);
      setNewM3uStage("Falha no processamento.");
      setStatus(friendly);
    } finally {
      setLoadingLogin(false);
      setLoadingChannels(false);
    }
  };

  const handleLogout = () => {
    setSession(null);
    setChannels([]);
    setGroups([]);
    setSelected(null);
    setSearch("");
    setGroup("");
    setStatus("Sessão encerrada.");
    setShowPlayer(false);
  };

  const handleClearCache = async () => {
    setMenuOpen(false);
    setStatus("Limpando cache...");

    const response = await ipcRenderer.invoke("iptv-clear-cache");
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao limpar cache.");
      return;
    }

    setStatus("Cache limpo com sucesso.");
  };

  const handleToggleFullscreen = async () => {
    const target = !isFullscreen;
    const response = await ipcRenderer.invoke("iptv-toggle-fullscreen", { enabled: target });
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao alternar tela cheia.");
      return;
    }
    setIsFullscreen(Boolean(response.isFullScreen));
    setMenuOpen(false);
    setStatus(response.isFullScreen ? "Tela cheia ativada." : "Tela cheia desativada.");
  };

  const handleSetNewM3uUrl = async () => {
    const currentUrl = String(form.url || session?.sourceUrl || "").trim();
    setMenuOpen(false);
    setNewM3uUrlInput(currentUrl);
    setNewM3uProgress(0);
    setNewM3uStage("");
    setNewM3uError("");
    setNewM3uDone(false);
    setDownloadMetrics({ receivedBytes: 0, totalBytes: 0, speedBps: 0 });
    setNewM3uModalOpen(true);
  };

  const handleConfigureTmdbKey = async () => {
    setMenuOpen(false);
    setTmdbApiKeyInput("");
    setTmdbModalOpen(true);
  };

  const handleConfirmTmdbKey = async () => {
    const apiKey = String(tmdbApiKeyInput || "").trim();
    if (!apiKey) {
      setStatus("Informe uma chave TMDB válida.");
      return;
    }

    setSavingTmdbApiKey(true);
    try {
      const saveResponse = await ipcRenderer.invoke("iptv-set-tmdb-key", { apiKey });
      if (!saveResponse?.ok) {
        setStatus(saveResponse?.error || "Falha ao salvar chave TMDB.");
        return;
      }
      setTmdbModalOpen(false);
      setTmdbApiKeyInput("");
      setStatus("Chave TMDB salva com sucesso.");
      setSynopsisRefreshTick((prev) => prev + 1);
    } catch (error) {
      const detail = String(error?.message || "").trim();
      if (detail.includes("No handler registered")) {
        setStatus("Reinicie o app para aplicar a atualização da chave TMDB.");
        return;
      }
      setStatus("Falha ao configurar chave TMDB.");
    } finally {
      setSavingTmdbApiKey(false);
    }
  };

  const handleConfirmNewM3uUrl = async () => {
    const normalizedUrl = String(newM3uUrlInput || "").trim();
    if (!normalizedUrl) {
      setNewM3uError("Informe uma URL M3U válida.");
      setStatus("Informe uma URL M3U válida.");
      return;
    }

    setLoadingLogin(true);
    setDownloadMetrics({ receivedBytes: 0, totalBytes: 0, speedBps: 0 });
    setNewM3uError("");
    setNewM3uDone(false);
    setNewM3uProgress(8);
    setNewM3uStage("Validando URL...");
    setStatus("Validando nova URL M3U...");

    try {
      const deleteResponse = await ipcRenderer.invoke("iptv-delete-local-playlist");
      if (!deleteResponse?.ok) {
        throw new Error(deleteResponse?.error || "Falha ao preparar cache para nova URL.");
      }

      setNewM3uProgress(18);
      setNewM3uStage("Conectando à fonte da playlist...");
      const response = await ipcRenderer.invoke("iptv-validate-login", { url: normalizedUrl });
      if (!response?.ok) {
        throw new Error(response?.error || "Falha ao validar nova URL.");
      }
      setNewM3uProgress(28);
      setNewM3uStage("Baixando e processando M3U...");

      const nextSession = {
        sourceUrl: response.sourceUrl,
        sourceMasked: response.sourceMasked,
        userInfo: response.userInfo,
      };

      await loadChannels(
        true,
        normalizedUrl,
        ({ stage, percent }) => {
          if (stage) setNewM3uStage(stage);
          if (Number.isFinite(percent)) setNewM3uProgress(percent);
        },
        { updateStatus: false }
      );

      setForm((prev) => ({ ...prev, url: normalizedUrl }));
      localStorage.setItem("iptv_url", normalizedUrl);
      skipNextSessionLoadRef.current = true;
      setSession(nextSession);
      setNewM3uProgress(100);
      setNewM3uStage("Finalizado.");
      setNewM3uDone(true);
      setStatus("Nova URL salva e carregada com sucesso.");
      setNewM3uModalOpen(false);
    } catch (error) {
      const rawMessage = String(error?.message || "").trim();
      let friendly = rawMessage || "Falha ao trocar URL M3U.";
      if (/HTTP\s+\d+/i.test(rawMessage)) {
        friendly = `Falha no download da playlist (${rawMessage}).`;
      } else if (rawMessage.includes("nenhum cache local")) {
        friendly = "Não foi possível baixar a playlist e não existe cache local disponível.";
      } else if (rawMessage.includes("nenhum canal foi identificado")) {
        friendly = "A URL respondeu, mas o conteúdo não parece ser uma playlist M3U válida.";
      }
      setNewM3uError(friendly);
      setNewM3uStage("Falha no processamento.");
      setStatus(friendly);
    } finally {
      setLoadingLogin(false);
      setLoadingChannels(false);
    }
  };

  const handleRefresh = async () => {
    if (!session?.sourceUrl) return;

    setLoadingChannels(true);
    setDownloadMetrics({ receivedBytes: 0, totalBytes: 0, speedBps: 0 });
    setContentLoadProgress(8);
    setContentLoadStage("Reprocessando playlist...");
    try {
      await loadChannels(true, null, ({ stage, percent }) => {
        if (Number.isFinite(percent)) {
          setContentLoadProgress(percent);
        }
        if (stage) {
          setContentLoadStage(stage);
        }
      });
    } catch (error) {
      setContentLoadStage("Falha ao processar conteúdo.");
      setStatus(error.message || "Falha ao atualizar.");
    } finally {
      setContentLoadProgress(100);
      setContentLoadStage("Finalizado.");
      setLoadingChannels(false);
    }
  };

  const handleClearAllApp = async () => {
    setMenuOpen(false);
    setStatus("Limpando dados do aplicativo...");

    const response = await ipcRenderer.invoke("iptv-clear-all");
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao limpar dados do aplicativo.");
      return;
    }

    localStorage.removeItem("iptv_url");
    localStorage.removeItem("iptv_favorites");
    localStorage.removeItem("iptv_likes");
    localStorage.removeItem("iptv_recent");

    setForm({ url: "" });
    setFavoriteIds([]);
    setLikedIds([]);
    setRecentlyPlayedIds([]);
    setCustomPlaylists([]);
    setLastEpisodesBySeries({});
    setHomeTab("inicio");
    setAdultMoviesUnlocked(false);
    handleLogout();
    setStatus("Dados do aplicativo removidos com sucesso.");
  };

  const handleExitApp = async () => {
    setMenuOpen(false);
    await ipcRenderer.invoke("iptv-exit-app");
  };

  const handleNavClick = (navKey) => {
    const nextNav = navKey === "playlists" ? "home" : navKey;
    setActiveNav(nextNav);
    setShowPlayer(false);
    setSearch("");
    setGroup("");
    setViewState("categories"); // Reset series view
    setSelectedCategory(null);
    setSelectedSeries(null);
    setSelectedSeason(null);
    if (navKey === "series") {
      setSelected(null);
      setBuffering(false);
    }
    if (navKey === "playlists") {
      setHomeTab("playlists");
    } else if (navKey !== "home") {
      setHomeTab("inicio");
    }

  };

  const persistLastEpisode = useCallback(async (payload) => {
    try {
      const response = await ipcRenderer.invoke("iptv-set-last-episode", payload);
      return Boolean(response?.ok);
    } catch {
      return false;
    }
  }, []);

  const buildPlaylistItemFromChannel = useCallback((channel) => {
    if (!channel) return null;
    const normalizedKind = String(channel.kind || "").toLowerCase();
    const info = parseEpisodeInfo(String(channel.name || ""));
    const entryType = normalizedKind === "series" ? "episode" : normalizedKind;
    const itemId = String(channel.id || `${entryType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    return {
      id: itemId,
      entryType,
      kind: normalizedKind || entryType,
      channelId: String(channel.id || ""),
      name: String(channel.name || ""),
      group: String(channel.group || ""),
      logo: String(channel.logo || ""),
      url: String(channel.url || ""),
      seriesName: normalizedKind === "series" ? info.seriesName : "",
      season: normalizedKind === "series" ? info.season : null,
      episode: normalizedKind === "series" ? info.episode : null,
      addedAt: new Date().toISOString(),
    };
  }, []);

  const buildPlaylistItemFromSeriesCard = useCallback((seriesItem, categoryLabel) => {
    if (!seriesItem) return null;
    return {
      id: `series-${String(seriesItem.name || "").trim().toLowerCase()}-${Date.now().toString(36)}`,
      entryType: "series",
      kind: "series",
      channelId: "",
      name: String(seriesItem.name || ""),
      group: String(categoryLabel || seriesItem.group || ""),
      logo: String(seriesItem.logo || ""),
      url: "",
      seriesName: String(seriesItem.name || ""),
      season: null,
      episode: null,
      addedAt: new Date().toISOString(),
    };
  }, []);

  const handleOpenCardContextMenu = useCallback((event, item) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item) return;
    setContextMenuState({
      x: event.clientX,
      y: event.clientY,
      item,
    });
  }, []);

  const handleOpenCreatePlaylistModal = useCallback(() => {
    setMenuOpen(false);
    setContextMenuState(null);
    setCreatePlaylistNameInput("");
    setCreatePlaylistModalOpen(true);
  }, []);

  const handleCreatePlaylist = useCallback(async (rawName) => {
    const name = String(rawName || "").trim();
    if (!name) {
      setStatus("Informe um nome para a playlist.");
      return;
    }
    const response = await ipcRenderer.invoke("iptv-create-custom-playlist", { name });
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao criar playlist.");
      return;
    }
    setCustomPlaylists(Array.isArray(response.playlists) ? response.playlists : []);
    setStatus(`Playlist criada: ${name}`);
    setHomeTab("playlists");
    setActiveNav("home");
    setCreatePlaylistModalOpen(false);
    setCreatePlaylistNameInput("");
  }, []);

  const handleAddItemToPlaylist = useCallback(async (playlistId, item) => {
    if (!playlistId || !item) return;
    const response = await ipcRenderer.invoke("iptv-add-item-to-custom-playlist", { playlistId, item });
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao adicionar item à playlist.");
      return;
    }
    setCustomPlaylists(Array.isArray(response.playlists) ? response.playlists : []);
    setStatus(`"${item.name}" foi adicionado à playlist.`);
    setContextMenuState(null);
  }, []);

  const handleRequestRemovePlaylist = useCallback((playlist) => {
    if (!playlist?.id) return;
    setPlaylistDeleteModalState({
      id: String(playlist.id),
      name: String(playlist.name || "Playlist"),
    });
  }, []);

  const handleCancelRemovePlaylist = useCallback(() => {
    setPlaylistDeleteModalState(null);
  }, []);

  const handleConfirmRemovePlaylist = useCallback(async () => {
    const playlistId = String(playlistDeleteModalState?.id || "").trim();
    const playlistName = String(playlistDeleteModalState?.name || "Playlist");
    if (!playlistId) return;
    const response = await ipcRenderer.invoke("iptv-remove-custom-playlist", { playlistId });
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao remover playlist.");
      return;
    }
    setCustomPlaylists(Array.isArray(response.playlists) ? response.playlists : []);
    setPinnedPlaylistIds((prev) => prev.filter((id) => String(id) !== playlistId));
    setPlaylistDeleteModalState(null);
    setStatus(`Playlist "${playlistName}" removida.`);
  }, [playlistDeleteModalState]);

  const handleRemovePlaylistItem = useCallback(async (playlistId, item) => {
    const itemId = String(item?.id || "").trim();
    if (!playlistId || !itemId) {
      setStatus("Item inválido para remoção.");
      return;
    }
    const response = await ipcRenderer.invoke("iptv-remove-item-from-custom-playlist", { playlistId, itemId });
    if (!response?.ok) {
      setStatus(response?.error || "Falha ao remover item da playlist.");
      return;
    }
    setCustomPlaylists(Array.isArray(response.playlists) ? response.playlists : []);
    setStatus(`"${item.name}" removido da playlist.`);
  }, []);

  const togglePinnedPlaylist = useCallback((playlistId) => {
    const normalizedId = String(playlistId || "").trim();
    if (!normalizedId) return;
    setPinnedPlaylistIds((prev) => {
      if (prev.includes(normalizedId)) {
        return prev.filter((id) => id !== normalizedId);
      }
      return [normalizedId, ...prev];
    });
  }, []);

  const pinnedHomePlaylists = useMemo(() => {
    if (pinnedPlaylistIds.length === 0 || customPlaylists.length === 0) return [];
    const byId = new Map(customPlaylists.map((playlist) => [String(playlist.id || ""), playlist]));
    return pinnedPlaylistIds
      .map((playlistId) => byId.get(String(playlistId)))
      .filter(Boolean);
  }, [pinnedPlaylistIds, customPlaylists]);

  const isEpisodeWatched = useCallback((episodeChannel) => {
    if (!episodeChannel) return false;
    const info = parseEpisodeInfo(String(episodeChannel.name || ""));
    const seriesKey = makeSeriesProgressKey(episodeChannel.group, info.seriesName);
    const progress = lastEpisodesBySeries[seriesKey];
    if (!progress) return false;
    const progressSeason = Number(progress.season || 1);
    const progressEpisode = Number(progress.episode || 1);
    if (info.season < progressSeason) return true;
    if (info.season > progressSeason) return false;
    return info.episode <= progressEpisode;
  }, [lastEpisodesBySeries]);

  const getLastEpisodeForSeries = useCallback((channelLike) => {
    if (!channelLike) return null;
    const info = parseEpisodeInfo(String(channelLike.name || ""));
    const seriesKey = makeSeriesProgressKey(channelLike.group, info.seriesName);
    return lastEpisodesBySeries[seriesKey] || null;
  }, [lastEpisodesBySeries]);

  const tryResumeFromLastEpisode = (channelLike) => {
    const progress = getLastEpisodeForSeries(channelLike);
    if (!progress) return false;
    const normalizedSeries = String(progress.seriesName || "").trim().toLowerCase();
    const target = channels.find((item) => {
      if (String(item.kind || "").toLowerCase() !== "series") return false;
      const info = parseEpisodeInfo(String(item.name || ""));
      if (String(info.seriesName || "").trim().toLowerCase() !== normalizedSeries) return false;
      const sameSeason = Number(info.season || 0) === Number(progress.season || 0);
      const sameEpisode = Number(info.episode || 0) === Number(progress.episode || 0);
      return sameSeason && sameEpisode;
    });
    if (!target) return false;
    handleNavClick("series");
    setSelectedCategory(normalizeCategoryLabel(target.group));
    setSelectedSeries(parseEpisodeInfo(target.name).seriesName);
    setSelectedSeason(String(parseEpisodeInfo(target.name).season));
    setViewState("episodes");
    setBuffering(true);
    setSelected(target);
    setStatus(`Retomando ${target.name}`);
    return true;
  };

  const playChannel = (channel, forceOpenPlayer = true) => {
    nativeFallbackKeyRef.current = "";
    setSelected(channel);

    if (forceOpenPlayer) {
      setShowPlayer(true);
    }

    setRecentlyPlayedIds((prev) => {
      const currentId = String(channel.id);
      const next = [currentId, ...prev.filter((id) => id !== currentId)];
      return next.slice(0, 10);
    });

    if (String(channel?.kind || "").toLowerCase() === "series") {
      const info = parseEpisodeInfo(String(channel.name || ""));
      const payload = {
        seriesKey: makeSeriesProgressKey(channel.group, info.seriesName),
        seriesName: info.seriesName,
        group: String(channel.group || ""),
        channelId: String(channel.id || ""),
        episodeName: String(channel.name || ""),
        season: info.season,
        episode: info.episode,
        kind: "series",
      };
      setLastEpisodesBySeries((prev) => ({
        ...prev,
        [payload.seriesKey]: {
          ...payload,
          updatedAt: new Date().toISOString(),
        },
      }));
      persistLastEpisode(payload);
    }

    setStatus(`Reprodução selecionada: ${channel.name}`);
  };

  const handlePlayerError = async (channel) => {
    setBuffering(false);

    const playableChannel = channel || selected;
    if (!playableChannel) return;

    const fallbackKey = `${String(playableChannel.id || "")}::${String(playableChannel.url || "")}`;
    if (!fallbackKey || nativeFallbackKeyRef.current === fallbackKey) return;
    nativeFallbackKeyRef.current = fallbackKey;

    setStatus(`Abrindo player nativo: ${playableChannel.name}`);
    const externalPlayableSources = buildPlayableSources(playableChannel.url, playableChannel.altUrl);
    let externalUrl =
      externalPlayableSources.find((candidate) => /\.(ts|m3u8|mp4|mkv)(\?|#|$)/i.test(candidate)) ||
      externalPlayableSources[0] ||
      playableChannel.url;

    if (isLikelyXtreamLiveUrlWithoutExtension(externalUrl)) {
      const forced = buildXtreamLiveUrl(externalUrl, "ts");
      if (forced) externalUrl = forced;
    }

    const response = await ipcRenderer.invoke("iptv-open-external-player", {
      url: externalUrl,
      name: playableChannel.name,
    });

    if (response?.ok) {
      setStatus(`Reprodução aberta no player nativo: ${playableChannel.name}`);
      return;
    }

    setStatus(response?.error || "Falha ao abrir stream no player nativo.");
  };

  const toggleFavorite = (channelId) => {
    const favoriteKey = makeChannelFavoriteId(channelId);
    setFavoriteIds((prev) => {
      if (prev.includes(favoriteKey)) return prev.filter((id) => id !== favoriteKey);
      return [favoriteKey, ...prev];
    });
  };

  const toggleSeriesFavorite = (categoryLabel, seriesName) => {
    const favoriteKey = makeSeriesFavoriteId(categoryLabel, seriesName);
    setFavoriteIds((prev) => {
      if (prev.includes(favoriteKey)) return prev.filter((id) => id !== favoriteKey);
      return [favoriteKey, ...prev];
    });
  };

  const isSeriesFavorited = (categoryLabel, seriesName) => {
    return favoriteIds.includes(makeSeriesFavoriteId(categoryLabel, seriesName));
  };

  const isChannelFavorited = (channelId) => {
    return favoriteIds.includes(makeChannelFavoriteId(channelId));
  };

  const toggleLike = (channelId) => {
    const normalizedChannelId = String(channelId);
    setLikedIds((prev) => {
      if (prev.includes(normalizedChannelId)) return prev.filter((id) => id !== normalizedChannelId);
      return [normalizedChannelId, ...prev];
    });
  };

  const scrollRow = (rowKey, direction) => {
    const row = rowRefs.current[rowKey];
    if (!row) return;

    row.scrollBy({ left: direction * 720, behavior: "smooth" });
  };

  const openFavoriteSeries = (seriesItem) => {
    handleNavClick("series");
    setSelected(null);
    setBuffering(false);
    setSelectedCategory(seriesItem.group);
    setSelectedSeries(seriesItem.name);
    setSelectedSeason(null);
    setViewState("seasons");
  };

  const getCardInteractiveState = (cardKey) => hoveredCardId === cardKey || focusedCardId === cardKey;

  const getCardInteractiveStyle = (cardKey) => {
    const active = getCardInteractiveState(cardKey);
    return {
      transform: active ? CARD_ACTIVE_TRANSFORM : "translateY(0) scale(1)",
      transition: CARD_BASE_TRANSITION,
      boxShadow: active ? "0 12px 24px rgba(0,0,0,0.45)" : "0 0 0 rgba(0,0,0,0)",
      borderColor: active ? "#ff0000" : "#ff000044",
      filter: active ? "brightness(1.05)" : "brightness(1)",
      outline: "none",
    };
  };

  const getSkeletonCards = (count = 12) =>
    Array.from({ length: count }).map((_, index) => (
      <div
        key={`skeleton-${index}`}
        aria-hidden="true"
        style={{
          width: "100%",
          height: 126,
          borderRadius: 12,
          position: "relative",
          overflow: "hidden",
          border: "1px solid #ff000033",
          background: "linear-gradient(90deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.05) 100%)",
          backgroundSize: "220% 100%",
          animation: "skeletonShimmer 1.2s ease-in-out infinite",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 10,
            right: 10,
            bottom: 10,
            height: 12,
            borderRadius: 999,
            background: "rgba(0,0,0,0.28)",
          }}
        />
      </div>
    ));

  const playHomeItem = (item, sourceRowKey = "") => {
    if (item.favoriteType === "series") {
      openFavoriteSeries(item);
      return;
    }

    if (item.kind === "series") {
      if (sourceRowKey === "continuar" && tryResumeFromLastEpisode(item)) {
        return;
      }
      const info = parseEpisodeInfo(item.name);
      handleNavClick("series");
      setSelectedCategory(normalizeCategoryLabel(item.group));
      setSelectedSeries(info.seriesName);
      setSelectedSeason(String(info.season));
      setViewState("episodes");
      setBuffering(true);
      playChannel(item, false);
      return;
    }

    if (item.kind === "movie") {
      handleNavClick("movies");
      setGroup(item.group || "");
      playChannel(item, true);
      return;
    }

    if (item.kind === "live") {
      handleNavClick("live");
      setGroup(item.group || "");
      playChannel(item, true);
      return;
    }

    playChannel(item, true);
  };

  const playCustomPlaylistItem = (item) => {
    if (!item) return;
    const channelId = String(item.channelId || "");
    const channel = channelById.get(channelId) || channelById.get(Number(channelId));
    if (channel) {
      playHomeItem(channel, "playlists");
      return;
    }

    if (item.entryType === "series") {
      openFavoriteSeries({
        group: normalizeCategoryLabel(item.group),
        name: item.seriesName || item.name,
      });
      return;
    }

    if (item.entryType === "episode" || item.kind === "series") {
      const normalizedSeries = String(item.seriesName || item.name || "").trim().toLowerCase();
      const fallbackEpisode = channels.find((episode) => {
        if (String(episode.kind || "").toLowerCase() !== "series") return false;
        const info = parseEpisodeInfo(String(episode.name || ""));
        return (
          String(info.seriesName || "").trim().toLowerCase() === normalizedSeries &&
          Number(info.season || 0) === Number(item.season || 0) &&
          Number(info.episode || 0) === Number(item.episode || 0)
        );
      });
      if (fallbackEpisode) {
        playHomeItem(fallbackEpisode, "playlists");
        return;
      }
    }

    if (item.url) {
      playChannel({
        id: item.id || `playlist-item-${Date.now().toString(36)}`,
        name: item.name || "Conteúdo da playlist",
        kind: item.kind || "movie",
        group: item.group || "",
        url: item.url,
        logo: item.logo || "",
      }, true);
      return;
    }

    setStatus("Item da playlist não encontrado na lista atual.");
  };

  const renderHome = () => {
    const featuredRows = [rows.find((row) => row.key === "continuar"), rows.find((row) => row.key === "favoritos")].filter(Boolean);

    return (
      <div style={{ padding: "0 20px" }}>
        <div style={{ display: "flex", gap: 20, marginBottom: 28, flexWrap: "wrap", justifyContent: "center" }}>
          <Tile
            style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
            onClick={() => handleNavClick("live")}
            {...getKeyboardButtonProps("Abrir TV ao vivo", () => handleNavClick("live"))}
          >
            <FolderTitle style={{ fontSize: "1.8em" }}>TV ao Vivo</FolderTitle>
            <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
              <FaTv size={75} />
            </div>
          </Tile>
          <Tile
            style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
            onClick={() => handleNavClick("movies")}
            {...getKeyboardButtonProps("Abrir filmes", () => handleNavClick("movies"))}
          >
            <FolderTitle style={{ fontSize: "1.8em" }}>Filmes</FolderTitle>
            <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
              <FaFilm size={75} />
            </div>
          </Tile>
          <Tile
            style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
            onClick={() => handleNavClick("series")}
            {...getKeyboardButtonProps("Abrir séries", () => handleNavClick("series"))}
          >
            <FolderTitle style={{ fontSize: "1.8em" }}>Séries</FolderTitle>
            <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
              <FaVideo size={75} />
            </div>
          </Tile>
        </div>

        <div style={{ marginBottom: 18, display: "flex", justifyContent: "flex-end" }}>
          {homeTab === "playlists" && (
            <button type="button" style={baseButtonStyle} onClick={handleOpenCreatePlaylistModal}>
              <FaPlus style={{ marginRight: 8 }} />
              Criar Playlist
            </button>
          )}
        </div>

        {homeTab === "inicio" && (
          <>
            {featuredRows.map((row, rowIdx) => (
            <StaggeredItem key={row.key} index={rowIdx} delay={80}>
            <div style={{ marginBottom: 20 }}>
              <FolderTitle style={{ textAlign: "left", fontSize: "1.2em", marginBottom: 12 }}>{row.title}</FolderTitle>
              <HorizontalRow>
                {row.items.map((channel) => {
                  const homeCardKey = `home-${channel.id}-${row.key}`;
                  const hasProgress = row.key === "continuar" && String(channel.kind || "").toLowerCase() === "series";
                  const progress = hasProgress ? getLastEpisodeForSeries(channel) : null;
                  const playlistItem =
                    channel.favoriteType === "series"
                      ? buildPlaylistItemFromSeriesCard(channel, channel.group)
                      : buildPlaylistItemFromChannel(channel);

                  return (
                    <div
                      key={`${row.key}-${channel.id}`}
                      onMouseEnter={() => {
                        setHoveredCardId(homeCardKey);
                        setUserInteracting(true);
                      }}
                      onMouseLeave={() => {
                        setHoveredCardId(null);
                        setUserInteracting(false);
                      }}
                      onFocus={() => setFocusedCardId(homeCardKey)}
                      onBlur={() => setFocusedCardId(null)}
                      onClick={() => playHomeItem(channel, row.key)}
                      onContextMenu={(event) => handleOpenCardContextMenu(event, {
                        displayName: channel.name,
                        playlistItem,
                      })}
                      {...getKeyboardButtonProps(`Assistir ${channel.name}`, () => playHomeItem(channel, row.key))}
                      style={{
                        minWidth: 220,
                        width: 220,
                        height: 126,
                        borderRadius: 12,
                        border: "1px solid #ff000044",
                        background: "#110000",
                        position: "relative",
                        overflow: "hidden",
                        cursor: "pointer",
                        ...getCardInteractiveStyle(homeCardKey),
                      }}
                    >
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (channel.favoriteType === "series") {
                            toggleSeriesFavorite(channel.group, channel.name);
                          } else {
                            toggleFavorite(channel.id);
                          }
                        }}
                        style={{
                          position: "absolute",
                          top: 8,
                          right: 8,
                          zIndex: 5,
                          width: 28,
                          height: 28,
                          borderRadius: "50%",
                          border: "1px solid #ff0000",
                          background: "rgba(0,0,0,0.72)",
                          color:
                            channel.favoriteType === "series"
                              ? (isSeriesFavorited(channel.group, channel.name) ? "#ffd700" : "#fff")
                              : (isChannelFavorited(channel.id) ? "#ffd700" : "#fff"),
                          display: "grid",
                          placeItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <FaStar size={14} />
                      </button>
                      {channel.logo ? (
                        <CachedLogoImage src={channel.logo} alt={channel.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                      ) : (
                        <div style={{ padding: 10, color: "#ddd" }}>{channel.name}</div>
                      )}
                      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: getCardInteractiveState(homeCardKey) ? "rgba(0,0,0,0.86)" : "rgba(0,0,0,0.7)", padding: 4, fontSize: 11 }}>
                        {channel.name}
                      </div>
                      {progress && (
                        <div style={{ position: "absolute", top: 8, left: 8, borderRadius: 999, border: "1px solid #16a34a", background: "rgba(0,0,0,0.76)", color: "#86efac", padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                          S{progress.season}E{progress.episode}
                        </div>
                      )}
                    </div>
                  );
                })}
              </HorizontalRow>
            </div>
            </StaggeredItem>
            ))}
            {recommendedItems.length > 0 && (
              <StaggeredItem index={featuredRows.length} delay={80}>
              <div style={{ marginBottom: 20 }}>
                <FolderTitle style={{ textAlign: "left", fontSize: "1.2em", marginBottom: 12 }}>Recomendados para você</FolderTitle>
                <HorizontalRow>
                  {recommendedItems.map((channel) => {
                    const recCardKey = `home-rec-${channel.id}`;
                    const kindLabel = channel.kind === "movie" ? "Filme" : "Série";
                    return (
                      <div
                        key={channel.id}
                        onMouseEnter={() => setHoveredCardId(recCardKey)}
                        onMouseLeave={() => setHoveredCardId(null)}
                        onClick={() => {
                          if (channel.kind === "movie") {
                            handleNavClick("movies");
                            setTimeout(() => playChannel(channel, true), 100);
                          } else {
                            const info = parseEpisodeInfo(channel.name);
                            handleNavClick("series");
                            setTimeout(() => {
                              setSelectedCategory(normalizeCategoryLabel(channel.group));
                              setSelectedSeries(info.seriesName);
                              setViewState("seasons");
                            }, 100);
                          }
                        }}
                        {...getKeyboardButtonProps(`Abrir ${channel.name}`, () => {})}
                        style={{
                          width: 160,
                          minWidth: 160,
                          height: 220,
                          borderRadius: 12,
                          border: "1px solid #ff000044",
                          background: "#110000",
                          position: "relative",
                          overflow: "hidden",
                          cursor: "pointer",
                          flexShrink: 0,
                          ...getCardInteractiveStyle(recCardKey),
                        }}
                      >
                        {channel.logo ? (
                          <CachedLogoImage src={channel.logo} alt={channel.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#ddd", fontWeight: 700, padding: 8, textAlign: "center", fontSize: 12 }}>
                            {channel.name}
                          </div>
                        )}
                        <div style={{ position: "absolute", top: 8, right: 8, background: channel.kind === "movie" ? "#f97316" : "#a78bfa", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4 }}>
                          {kindLabel}
                        </div>
                        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", padding: "6px 8px", fontSize: 11, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {channel.kind === "series" ? parseEpisodeInfo(channel.name).seriesName : channel.name}
                        </div>
                      </div>
                    );
                  })}
                </HorizontalRow>
              </div>
              </StaggeredItem>
            )}
            {pinnedHomePlaylists.map((playlist, pIdx) => (
              Array.isArray(playlist.items) && playlist.items.length > 0 ? (
                <StaggeredItem key={`home-pinned-${playlist.id}`} index={featuredRows.length + 1 + pIdx} delay={80}>
                <div style={{ marginBottom: 20 }}>
                  <FolderTitle style={{ textAlign: "left", fontSize: "1.2em", marginBottom: 12 }}>{playlist.name}</FolderTitle>
                  <HorizontalRow>
                    {playlist.items.slice(0, 30).map((item, index) => {
                      const homePlaylistCardKey = `home-pinned-${playlist.id}-${item.id || index}`;
                      return (
                        <div
                          key={`home-pinned-item-${playlist.id}-${item.id || index}`}
                          onMouseEnter={() => {
                            setHoveredCardId(homePlaylistCardKey);
                            setUserInteracting(true);
                          }}
                          onMouseLeave={() => {
                            setHoveredCardId(null);
                            setUserInteracting(false);
                          }}
                          onFocus={() => setFocusedCardId(homePlaylistCardKey)}
                          onBlur={() => setFocusedCardId(null)}
                          onClick={() => playCustomPlaylistItem(item)}
                          {...getKeyboardButtonProps(`Reproduzir ${item.name}`, () => playCustomPlaylistItem(item))}
                          style={{
                            minWidth: 220,
                            width: 220,
                            height: 126,
                            borderRadius: 12,
                            border: "1px solid #ff000044",
                            background: "#110000",
                            position: "relative",
                            overflow: "hidden",
                            cursor: "pointer",
                            ...getCardInteractiveStyle(homePlaylistCardKey),
                          }}
                        >
                          {item.logo ? (
                            <CachedLogoImage src={item.logo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                          ) : (
                            <div style={{ padding: 10, color: "#ddd" }}>{item.name}</div>
                          )}
                          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: getCardInteractiveState(homePlaylistCardKey) ? "rgba(0,0,0,0.86)" : "rgba(0,0,0,0.7)", padding: 4, fontSize: 11 }}>
                            {item.name}
                          </div>
                        </div>
                      );
                    })}
                  </HorizontalRow>
                </div>
                </StaggeredItem>
              ) : null
            ))}
          </>
        )}

        {homeTab === "playlists" && (
          <div style={{ display: "grid", gap: 14 }}>
            {customPlaylists.length === 0 && (
              <div style={{ border: "1px solid #ff000044", borderRadius: 12, background: "rgba(0,0,0,0.45)", padding: 16, color: "#ddd" }}>
                Nenhuma playlist criada ainda.
              </div>
            )}
            {customPlaylists.map((playlist) => (
              <div key={playlist.id} style={{ border: "1px solid #ff000044", borderRadius: 12, background: "rgba(0,0,0,0.52)", padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8 }}>
                  <FolderTitle style={{ textAlign: "left", margin: 0, fontSize: "1.05em" }}>{playlist.name}</FolderTitle>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#ddd", fontSize: 12 }}>{Array.isArray(playlist.items) ? playlist.items.length : 0} itens</span>
                    <button
                      type="button"
                      onClick={() => togglePinnedPlaylist(playlist.id)}
                      style={{ ...baseButtonStyle, padding: "6px 10px", borderColor: pinnedPlaylistIds.includes(String(playlist.id)) ? "#16a34a" : "#ff0000", color: pinnedPlaylistIds.includes(String(playlist.id)) ? "#86efac" : "#fff" }}
                    >
                      {pinnedPlaylistIds.includes(String(playlist.id)) ? "Na tela inicial" : "Adicionar na tela inicial"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRequestRemovePlaylist(playlist)}
                      style={{ ...baseButtonStyle, padding: "6px 10px", borderColor: "#ff6666", color: "#ff9f9f" }}
                    >
                      Excluir Playlist
                    </button>
                  </div>
                </div>
                {Array.isArray(playlist.items) && playlist.items.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
                    {playlist.items.map((item, index) => {
                      const playlistCardKey = `playlist-card-${playlist.id}-${item.id || index}`;
                      const typeLabel = (item.entryType || item.kind || "item").toString().toUpperCase();
                      const typeColor = typeLabel === "LIVE" ? "#22d3ee" : typeLabel === "MOVIE" ? "#f97316" : "#a78bfa";
                      return (
                        <div
                          key={`${playlist.id}-${item.id || index}`}
                          onMouseEnter={() => setHoveredCardId(playlistCardKey)}
                          onMouseLeave={() => setHoveredCardId(null)}
                          onFocus={() => setFocusedCardId(playlistCardKey)}
                          onBlur={() => setFocusedCardId(null)}
                          onClick={() => playCustomPlaylistItem(item)}
                          {...getKeyboardButtonProps(`Reproduzir ${item.name}`, () => playCustomPlaylistItem(item))}
                          style={{
                            width: "100%",
                            minHeight: 146,
                            textAlign: "left",
                            border: "1px solid #ff000044",
                            borderRadius: 12,
                            background: "#120000",
                            color: "#fff",
                            padding: 0,
                            cursor: "pointer",
                            display: "grid",
                            overflow: "hidden",
                            ...getCardInteractiveStyle(playlistCardKey),
                          }}
                        >
                          <div style={{ height: 92, background: "linear-gradient(180deg, #3a0000 0%, #140000 100%)", position: "relative" }}>
                            {item.logo ? (
                              <CachedLogoImage src={item.logo} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.9 }} />
                            ) : (
                              <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#ffd2d2", fontSize: 12, letterSpacing: 0.7 }}>
                                SEM CAPA
                              </div>
                            )}
                            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.7), rgba(0,0,0,0.05))" }} />
                            <div style={{ position: "absolute", top: 8, left: 8, borderRadius: 999, border: `1px solid ${typeColor}`, background: "rgba(0,0,0,0.72)", color: typeColor, padding: "2px 8px", fontSize: 10, fontWeight: 700 }}>
                              {typeLabel}
                            </div>
                            <div style={{ position: "absolute", right: 8, bottom: 8, width: 24, height: 24, borderRadius: "50%", border: "1px solid #ffffff66", background: "rgba(0,0,0,0.58)", color: "#fff", display: "grid", placeItems: "center" }}>
                              <FaPlay size={10} />
                            </div>
                            <button
                              type="button"
                              title="Remover da playlist"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemovePlaylistItem(playlist.id, item);
                              }}
                              style={{ position: "absolute", right: 8, top: 8, width: 24, height: 24, borderRadius: "50%", border: "1px solid #ff9f9f", background: "rgba(0,0,0,0.72)", color: "#ff9f9f", display: "grid", placeItems: "center", cursor: "pointer" }}
                            >
                              <FaTimes size={10} />
                            </button>
                          </div>
                          <div style={{ display: "grid", gap: 4, padding: "10px 12px" }}>
                            <span style={{ fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.name}</span>
                            <span style={{ color: "#d4d4d4", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {item.group || "Sem categoria"}
                              {item.season && item.episode ? ` • S${item.season}E${item.episode}` : ""}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ color: "#bbb", fontSize: 13 }}>Sem itens nesta playlist.</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderSeriesView = () => {
    if (viewState === 'categories') {
      const cats = Object.keys(seriesData).sort();
      const activeCategory = selectedCategory && cats.includes(selectedCategory) ? selectedCategory : (cats[0] || null);
      const seriesList = activeCategory && seriesData[activeCategory] ? Object.values(seriesData[activeCategory]) : [];
      
      if (cats.length === 0) {
        return (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#ddd" }}>
            {search.trim() ? (
              <>
                <FolderTitle style={{ marginBottom: 10 }}>Nenhum resultado</FolderTitle>
                <div>Nenhuma série encontrada para "<span style={{ color: "#ff6666" }}>{search}</span>"</div>
              </>
            ) : (
              <>
                <FolderTitle style={{ marginBottom: 10 }}>Nenhuma série encontrada</FolderTitle>
                <div>Verifique se sua lista possui grupos identificados como "Series", "Séries", "Novelas", etc.</div>
              </>
            )}
            <div style={{ marginTop: 20, fontSize: "0.9em", color: "#aaa" }}>
               Debug: Total de itens carregados: {channels.length} <br/>
               Filtro atual: {kind}
            </div>
          </div>
        );
      }

      return (
        <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, height: "calc(100vh - 160px)", overflow: "hidden", alignItems: "stretch" }}>
          <aside style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #ff000033", borderRadius: 12, padding: 12, height: "100%", overflowY: "auto" }} onScroll={handleScrollInteract}>
            <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 10 }}>Categorias</FolderTitle>
            {cats.map((cat) => {
              const active = activeCategory === cat;
              const count = seriesData[cat] ? Object.keys(seriesData[cat]).length : 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setSelected(null);
                    setBuffering(false);
                    setSelectedCategory(cat);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    marginBottom: 8,
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: active ? "1px solid #ff0000" : "1px solid #ff000033",
                    background: active ? "#2c0000" : "#110000",
                    color: "#fff",
                    cursor: "pointer",
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </aside>
          <div style={{ height: "100%", minHeight: 0, overflowY: "auto", paddingRight: 4 }} onScroll={handleScrollInteract}>
            <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 12 }}>
              {activeCategory || "Selecione uma categoria"}
            </FolderTitle>
            <div key={`series-grid-${activeCategory}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
              {seriesList.map((s, sIdx) => {
                const seriesCardKey = `series-${activeCategory}-${s.name}`;
                return (
                <div
                  key={s.name}
                  onMouseEnter={() => setHoveredCardId(seriesCardKey)}
                  onMouseLeave={() => setHoveredCardId(null)}
                  onFocus={() => setFocusedCardId(seriesCardKey)}
                  onBlur={() => setFocusedCardId(null)}
                  onContextMenu={(event) => handleOpenCardContextMenu(event, {
                    displayName: s.name,
                    playlistItem: buildPlaylistItemFromSeriesCard(s, activeCategory),
                  })}
                  onClick={() => {
                    setSelected(null);
                    setBuffering(false);
                    setSelectedCategory(activeCategory);
                    setSelectedSeries(s.name);
                    setViewState('seasons');
                  }}
                  {...getKeyboardButtonProps(`Abrir série ${s.name}`, () => {
                    setSelected(null);
                    setBuffering(false);
                    setSelectedCategory(activeCategory);
                    setSelectedSeries(s.name);
                    setViewState("seasons");
                  })}
                  style={{ aspectRatio: "2/3", background: "#000", border: "1px solid #ff000044", borderRadius: 12, cursor: "pointer", overflow: "hidden", position: "relative", ...getCardStaggerStyle(sIdx), ...getCardInteractiveStyle(seriesCardKey) }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleSeriesFavorite(activeCategory, s.name);
                    }}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      zIndex: 6,
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      border: "1px solid #ff0000",
                      background: "rgba(0,0,0,0.72)",
                      color: isSeriesFavorited(activeCategory, s.name) ? "#ffd700" : "#fff",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <FaStar size={14} />
                  </button>
                  {s.logo ? <CachedLogoImage src={s.logo} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ padding: 10 }}>{s.name}</div>}
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", padding: 6, fontSize: 12, textAlign: "center" }}>{s.name}</div>
                </div>
              );
              })}
            </div>
          </div>
        </div>
      );
    }

    if (viewState === 'series_list') {
      const seriesList = seriesData[selectedCategory] ? Object.values(seriesData[selectedCategory]) : [];
      return (
        <div style={{ padding: "0 20px" }}>
          <button style={{ ...baseButtonStyle, marginBottom: 20 }} onClick={() => setViewState('categories')}>Voltar</button>
          <FolderTitle style={{ marginBottom: 20 }}>{selectedCategory}</FolderTitle>
          <div key={`series-list-grid-${selectedCategory}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
            {seriesList.map((s, sIdx) => {
              const seriesListCardKey = `series-list-${selectedCategory}-${s.name}`;
              return (
              <div
                key={s.name}
                onMouseEnter={() => setHoveredCardId(seriesListCardKey)}
                onMouseLeave={() => setHoveredCardId(null)}
                onFocus={() => setFocusedCardId(seriesListCardKey)}
                onBlur={() => setFocusedCardId(null)}
                onContextMenu={(event) => handleOpenCardContextMenu(event, {
                  displayName: s.name,
                  playlistItem: buildPlaylistItemFromSeriesCard(s, selectedCategory),
                })}
                onClick={() => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeries(s.name);
                  setViewState('seasons');
                }}
                {...getKeyboardButtonProps(`Abrir série ${s.name}`, () => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeries(s.name);
                  setViewState("seasons");
                })}
                style={{ aspectRatio: "2/3", background: "#000", border: "1px solid #ff000044", borderRadius: 12, cursor: "pointer", overflow: "hidden", position: "relative", ...getCardStaggerStyle(sIdx), ...getCardInteractiveStyle(seriesListCardKey) }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleSeriesFavorite(selectedCategory, s.name);
                  }}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    zIndex: 6,
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: "1px solid #ff0000",
                    background: "rgba(0,0,0,0.72)",
                    color: isSeriesFavorited(selectedCategory, s.name) ? "#ffd700" : "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <FaStar size={14} />
                </button>
                {s.logo ? <CachedLogoImage src={s.logo} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <div style={{ padding: 10 }}>{s.name}</div>}
                <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.8)", padding: 6, fontSize: 12, textAlign: "center" }}>{s.name}</div>
              </div>
            );
            })}
          </div>
        </div>
      );
    }

    if (viewState === 'seasons') {
      const categoryData = seriesData[selectedCategory];
      const series = categoryData ? categoryData[selectedSeries] : null;

      if (!series) {
         return (
           <div
             onClick={() => setViewState("categories")}
             {...getKeyboardButtonProps("Voltar para categorias", () => setViewState("categories"))}
             style={{ padding: "20px", color: "#ddd", cursor: "pointer" }}
           >
             Dados não encontrados. Voltar.
           </div>
         );
      }

      const seasons = Object.keys(series.seasons).sort((a,b) => parseInt(a) - parseInt(b));
      
      return (
        <div style={{ padding: "0 20px" }}>
          <button style={{ ...baseButtonStyle, marginBottom: 20 }} onClick={() => setViewState('categories')}>Voltar</button>
          <FolderTitle style={{ marginBottom: 20 }}>{series.name}</FolderTitle>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {seasons.map((sea) => {
              const seasonCardKey = `season-${selectedSeries}-${sea}`;
              return (
              <div 
                key={sea}
                onMouseEnter={() => setHoveredCardId(seasonCardKey)}
                onMouseLeave={() => setHoveredCardId(null)}
                onFocus={() => setFocusedCardId(seasonCardKey)}
                onBlur={() => setFocusedCardId(null)}
                onClick={() => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeason(sea);
                  setViewState('episodes');
                }}
                {...getKeyboardButtonProps(`Abrir temporada ${sea}`, () => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeason(sea);
                  setViewState("episodes");
                })}
                style={{ padding: "20px 40px", background: "#1a0000", border: "1px solid #ff0000", borderRadius: 12, cursor: "pointer", fontSize: "1.2em", fontWeight: "bold", ...getCardInteractiveStyle(seasonCardKey) }}
              >
                Temporada {sea}
              </div>
            );
            })}
          </div>
        </div>
      );
    }

    if (viewState === 'episodes') {
      const categoryData = seriesData[selectedCategory];
      const series = categoryData ? categoryData[selectedSeries] : null;

      if (!series || !series.seasons[selectedSeason]) {
         return (
           <div
             onClick={() => setViewState("categories")}
             {...getKeyboardButtonProps("Voltar para categorias", () => setViewState("categories"))}
             style={{ padding: "20px", color: "#ddd", cursor: "pointer" }}
           >
             Dados não encontrados. Voltar.
           </div>
         );
      }

      const episodes = series.seasons[selectedSeason].sort((a,b) => a.episodeNum - b.episodeNum);
      const currentEpisode = episodes.find((ep) => ep.id === selected?.id) || null;
      const currentEpisodeIndex = currentEpisode ? episodes.findIndex((ep) => ep.id === currentEpisode.id) : -1;

      const handleEpisodeEnded = () => {
        const currentIdx = episodes.findIndex((ep) => ep.id === selected?.id);
        const nextEpisode = currentIdx >= 0 ? episodes[currentIdx + 1] : null;
        if (!nextEpisode) {
          setBuffering(false);
          castEndedCallbackRef.current = null;
          return;
        }
        setBuffering(true);
        playChannel(nextEpisode, false);

        // Se Chromecast ativo, enviar próximo episódio automaticamente
        if (globalCastActiveRef.current && globalCastDeviceRef.current) {
          const nextUrl = nextEpisode.url;
          ipcRenderer.invoke("chromecast-cast", {
            host: globalCastDeviceRef.current.host,
            port: globalCastDeviceRef.current.port,
            url: nextUrl,
            title: nextEpisode.name || "MindFlix",
            contentType: /\.m3u8/i.test(nextUrl) ? "application/x-mpegURL" : "video/mp4",
          }).then((result) => {
            if (result.ok) {
              setGlobalCastTitle(nextEpisode.name || "");
              castEndedHandledRef.current = false; // allow next ENDED detection
            }
          });
        }
      };

      // Registrar callback para quando Chromecast terminar
      castEndedCallbackRef.current = handleEpisodeEnded;

      return (
        <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "1fr 350px", gap: 20, minHeight: "calc(100vh - 140px)", alignItems: "start" }}>
           <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
             <button style={{ ...baseButtonStyle, width: "fit-content", marginBottom: 10 }} onClick={() => setViewState('seasons')}>Voltar</button>
             <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", border: "1px solid #ff000044", aspectRatio: "16 / 9", width: "100%", maxHeight: "68vh", minHeight: 320, position: "relative", flex: "0 0 auto" }}>
                <ReactUrlPlayer
                  src={toPlayableUrl(currentEpisode?.url)}
                  altSrc={currentEpisode?.altUrl || ""}
                  type={mediaTypeFromUrl(toPlayableUrl(currentEpisode?.url))}
                  onBufferingChange={setBuffering}
                  onError={() => handlePlayerError(currentEpisode)}
                  onEnded={handleEpisodeEnded}
                  volume={playerVolume}
                  onVolumeStateChange={handlePlayerVolumeStateChange}
                  userHasSetVolume={volumeSetByUserRef.current}
                  fallbackUserVolume={userVolumeRef.current}
                  onCastStart={(device, url) => {
                    setGlobalCastActive(true);
                    setGlobalCastDevice(device);
                    setGlobalCastTitle(currentEpisode?.name || "");
                  }}
                  onCastStop={() => {
                    setGlobalCastActive(false);
                    setGlobalCastDevice(null);
                    setGlobalCastTitle("");
                    castEndedCallbackRef.current = null;
                  }}
                  globalCastActive={globalCastActive}
                  globalCastDevice={globalCastDevice}
                />
             </div>
             <div style={{ marginTop: "auto", paddingTop: 10, display: "grid", gap: 10 }}>
                <div style={{ fontSize: "1.05em", fontWeight: "bold", border: "1px solid #ff000055", borderRadius: 10, background: "rgba(0,0,0,0.58)", padding: "10px 12px", lineHeight: 1.35, wordBreak: "break-word" }}>
                   {currentEpisode?.name || "Selecione um episódio"}
                </div>
                {renderSelectedSynopsis()}
             </div>
           </div>
           
           <div style={{ background: "rgba(0,0,0,0.5)", borderRadius: 12, border: "1px solid #ff000022", overflowY: "auto", maxHeight: "calc(100vh - 220px)", padding: 10 }} onScroll={handleScrollInteract}>
              <FolderTitle style={{ fontSize: "1.1em", marginBottom: 10 }}>Temporada {selectedSeason}</FolderTitle>
              {episodes.map((ep, epIdx) => {
                const episodeItemKey = `episode-${ep.id}`;
                return (
                <div
                  key={ep.id}
                  onMouseEnter={() => setHoveredCardId(episodeItemKey)}
                  onMouseLeave={() => setHoveredCardId(null)}
                  onFocus={() => setFocusedCardId(episodeItemKey)}
                  onBlur={() => setFocusedCardId(null)}
                  onContextMenu={(event) => handleOpenCardContextMenu(event, {
                    displayName: ep.name,
                    playlistItem: buildPlaylistItemFromChannel(ep),
                  })}
                  onClick={() => playChannel(ep, false)}
                  {...getKeyboardButtonProps(`Reproduzir episódio ${ep.episodeNum}`, () => playChannel(ep, false))}
                  style={{
                    padding: 10,
                    marginBottom: 8,
                    background: selected?.id === ep.id ? "#ff000044" : "#1a1a1a",
                    borderRadius: 6,
                    cursor: "pointer",
                    border: selected?.id === ep.id ? "1px solid #ff0000" : "1px solid transparent",
                    ...getCardStaggerStyle(epIdx),
                    ...getCardInteractiveStyle(episodeItemKey),
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontWeight: "bold", fontSize: 13 }}>{ep.episodeNum}. {ep.name}</div>
                    {isEpisodeWatched(ep) && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4, borderRadius: 999, border: "1px solid #16a34a", color: "#86efac", padding: "2px 8px", fontSize: 11, fontWeight: 700 }}>
                        <FaCheck size={10} />
                        Assistido
                      </span>
                    )}
                  </div>
                </div>
              );
              })}
           </div>
        </div>
      );
    }
  };

  const handleMovieCategoryClick = (category) => {
    if (!isAdultCategoryLabel(category.label)) {
      setShowPlayer(false);
      setGroup(category.raw);
      return;
    }

    if (!adultMoviesUnlocked) {
      const confirmed = window.confirm("Conteúdo adulto: confirme para acessar esta categoria.");
      if (!confirmed) return;
      setAdultMoviesUnlocked(true);
    }

    setShowPlayer(false);
    setGroup(category.raw);
  };

  const renderSelectedSynopsis = () => (
    <div
      style={{
        border: "1px solid #ff000044",
        borderRadius: 12,
        background: "rgba(12,12,12,0.72)",
        padding: "12px 14px",
        flex: "0 0 auto",
      }}
    >
      <FolderTitle style={{ textAlign: "left", fontSize: "0.98em", marginBottom: 8 }}>Sinopse</FolderTitle>
      {(selectedSynopsisMeta.posterUrl || selectedSynopsisMeta.year || Number.isFinite(selectedSynopsisMeta.rating)) && (
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
          {selectedSynopsisMeta.posterUrl && (
            <img
              src={selectedSynopsisMeta.posterUrl}
              alt="Poster TMDB"
              style={{ width: 84, height: 126, objectFit: "cover", borderRadius: 8, border: "1px solid #ff000044", flex: "0 0 auto" }}
            />
          )}
          <div style={{ display: "grid", gap: 6 }}>
            {selectedSynopsisMeta.year && (
              <span style={{ fontSize: 12, color: "#fff", border: "1px solid #ff000055", borderRadius: 999, padding: "4px 10px", width: "fit-content", background: "rgba(0,0,0,0.38)" }}>
                Ano: {selectedSynopsisMeta.year}
              </span>
            )}
            {Number.isFinite(selectedSynopsisMeta.rating) && (
              <span style={{ fontSize: 12, color: "#fff", border: "1px solid #ff000055", borderRadius: 999, padding: "4px 10px", width: "fit-content", background: "rgba(0,0,0,0.38)" }}>
                Nota TMDB: {selectedSynopsisMeta.rating.toFixed(1)}
              </span>
            )}
          </div>
        </div>
      )}
      <ContentInfo style={{ textAlign: "left", lineHeight: 1.55, margin: 0 }}>
        {loadingSynopsis
          ? "Carregando sinopse..."
          : selectedSynopsis || synopsisHint || "Sinopse indisponível para este conteúdo."}
      </ContentInfo>
    </div>
  );

  const renderMoviesView = () => {
    const selectedMovieCategory = movieCategories.find((category) => category.raw === group) || null;
    const selectedIsAdult = selectedMovieCategory ? isAdultCategoryLabel(selectedMovieCategory.label) : false;
    const canShowCategoryContent = Boolean(selectedMovieCategory) && (!selectedIsAdult || adultMoviesUnlocked);
    const movieItems = canShowCategoryContent ? filteredChannels : [];

    if (showPlayer && selected && canShowCategoryContent) {
      return (
        <FadeTransition transitionKey={`movie-player-${selected?.id || ''}`}>
        <div style={{ padding: "0 20px", height: "calc(100vh - 140px)", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          <button
            type="button"
            onClick={() => {
              setShowPlayer(false);
              setBuffering(false);
            }}
            style={{ ...baseButtonStyle, width: "fit-content" }}
          >
            <FaChevronLeft style={{ marginRight: 8 }} />
            Voltar para filmes
          </button>
          <div style={{ flex: "0 0 auto", border: "1px solid #ff000055", borderRadius: 14, background: "rgba(0,0,0,0.8)", padding: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ marginBottom: 8 }}>
              <FolderTitle style={{ textAlign: "left", fontSize: "1.08em" }}>
                {selected?.name || "Selecione um filme"}
              </FolderTitle>
            </div>
            <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", aspectRatio: "16 / 9", width: "100%", maxWidth: 1220, maxHeight: "68vh", minHeight: 320, margin: "0 auto", flex: "0 0 auto", position: "relative" }}>
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                altSrc={selected?.altUrl || ""}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => handlePlayerError(selected)}
                onEnded={() => {
                  setShowPlayer(false);
                  setBuffering(false);
                  setStatus("Filme finalizado.");
                }}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                onCastStart={(device) => {
                  setGlobalCastActive(true);
                  setGlobalCastDevice(device);
                  setGlobalCastTitle(selected?.name || "Filme");
                }}
                onCastStop={() => {
                  setGlobalCastActive(false);
                  setGlobalCastDevice(null);
                  setGlobalCastTitle("");
                }}
                globalCastActive={globalCastActive}
                globalCastDevice={globalCastDevice}
              />
            </div>
          </div>
          {renderSelectedSynopsis()}
        </div>
        </FadeTransition>
      );
    }

    return (
    <FadeTransition transitionKey={`movie-list-${group}`}>
    <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, height: "calc(100vh - 160px)", overflow: "hidden", alignItems: "stretch" }}>
      <aside style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #ff000033", borderRadius: 12, padding: 12, height: "100%", overflowY: "auto" }}>
        <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 10 }}>Categorias</FolderTitle>
        {movieCategories.map((category) => {
          const active = group === category.raw;
          return (
            <button
              key={category.raw}
              type="button"
              onClick={() => handleMovieCategoryClick(category)}
              style={{
                width: "100%",
                textAlign: "left",
                marginBottom: 8,
                padding: "10px 12px",
                borderRadius: 8,
                border: active ? "1px solid #ff0000" : "1px solid #ff000033",
                background: active ? "#2c0000" : "#110000",
                color: "#fff",
                cursor: "pointer",
                fontWeight: active ? 700 : 500,
              }}
            >
              {category.label} ({category.count})
            </button>
          );
        })}
      </aside>

      <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {showPlayer && selected && canShowCategoryContent && (
          <section style={{ marginBottom: 20, border: "1px solid #ff000055", borderRadius: 14, background: "rgba(0,0,0,0.8)", padding: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <FolderTitle style={{ textAlign: "left", fontSize: "1.08em" }}>
                {selected?.name || "Selecione um filme"}
              </FolderTitle>
            </div>
            <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", aspectRatio: "16 / 9", width: "100%", maxWidth: 1060, minHeight: 280, margin: "0 auto", position: "relative" }}>
              <button
                type="button"
                onClick={() => {
                  setShowPlayer(false);
                  setBuffering(false);
                }}
                style={{
                  position: "absolute",
                  top: 10,
                  right: 10,
                  zIndex: 30,
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  border: "1px solid #ff0000",
                  background: "rgba(0,0,0,0.78)",
                  color: "#fff",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                }}
                aria-label="Fechar reprodução"
              >
                <FaTimes size={14} />
              </button>
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                altSrc={selected?.altUrl || ""}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => handlePlayerError(selected)}
                onEnded={() => {
                  setShowPlayer(false);
                  setBuffering(false);
                  setStatus("Filme finalizado.");
                }}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                onCastStart={(device) => {
                  setGlobalCastActive(true);
                  setGlobalCastDevice(device);
                  setGlobalCastTitle(selected?.name || "Filme");
                }}
                onCastStop={() => {
                  setGlobalCastActive(false);
                  setGlobalCastDevice(null);
                  setGlobalCastTitle("");
                }}
                globalCastActive={globalCastActive}
                globalCastDevice={globalCastDevice}
              />
            </div>
          </section>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
          <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 12 }}>
            {selectedMovieCategory?.label || "Selecione uma categoria"}
          </FolderTitle>

            {movieItems.length === 0 && search.trim() && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#aaa" }}>
                Nenhum resultado para "<span style={{ color: "#ff6666" }}>{search}</span>"
              </div>
            )}
            <div key={`movie-grid-${selectedMovieCategory?.value}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }} onScroll={handleScrollInteract}>
            {movieItems.map((channel, mIdx) => {
              const movieCardKey = `movie-${channel.id}`;
              return (
              <div
                key={channel.id}
                onMouseEnter={() => {
                  setHoveredCardId(movieCardKey);
                  setUserInteracting(true);
                }}
                onMouseLeave={() => {
                  setHoveredCardId(null);
                  setUserInteracting(false);
                }}
                onFocus={() => setFocusedCardId(movieCardKey)}
                onBlur={() => setFocusedCardId(null)}
                onContextMenu={(event) => handleOpenCardContextMenu(event, {
                  displayName: channel.name,
                  playlistItem: buildPlaylistItemFromChannel(channel),
                })}
                onClick={() => playChannel(channel, true)}
                {...getKeyboardButtonProps(`Reproduzir ${channel.name}`, () => playChannel(channel, true))}
                style={{
                  width: "100%",
                  height: 126,
                  borderRadius: 12,
                  border: "1px solid #ff000044",
                  background: "#110000",
                  position: "relative",
                  overflow: "hidden",
                  cursor: "pointer",
                  ...getCardStaggerStyle(mIdx),
                  ...getCardInteractiveStyle(movieCardKey),
                }}
              >
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleFavorite(channel.id);
                  }}
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    zIndex: 6,
                    width: 30,
                    height: 30,
                    borderRadius: "50%",
                    border: "1px solid #ff0000",
                    background: "rgba(0,0,0,0.72)",
                    color: isChannelFavorited(channel.id) ? "#ffd700" : "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <FaStar size={14} />
                </button>
                {channel.logo ? (
                  <CachedLogoImage src={channel.logo} alt={channel.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#ddd", fontWeight: 700, padding: 8, textAlign: "center" }}>
                    {channel.name}
                  </div>
                )}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: getCardInteractiveState(movieCardKey) ? "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.18))" : "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))",
                    display: "grid",
                    alignContent: "end",
                    padding: 8,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {channel.name}
                  </div>
                </div>
              </div>
            );
            })}
          </div>

          {!canShowCategoryContent && (
            <div style={{ marginTop: 16, color: "#ddd" }}>
              {selectedIsAdult
                ? "Confirme o acesso para exibir conteúdos da categoria Adultos."
                : "Selecione uma categoria para ver os filmes."}
            </div>
          )}
        </div>
      </div>
    </div>
    </FadeTransition>
  );
  };

  const renderLiveView = () => {
    const selectedLiveCategory = liveCategories.find((category) => category.raw === group) || null;
    const liveItems = selectedLiveCategory ? filteredChannels : [];

    if (showPlayer && selected && selectedLiveCategory) {
      return (
        <FadeTransition transitionKey={`live-player-${selected?.id || ''}`}>
        <div style={{ padding: "0 20px", height: "calc(100vh - 140px)", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          <button
            type="button"
            onClick={() => {
              setShowPlayer(false);
              setBuffering(false);
            }}
            style={{ ...baseButtonStyle, width: "fit-content" }}
          >
            <FaChevronLeft style={{ marginRight: 8 }} />
            Voltar para TV ao vivo
          </button>
          <div style={{ flex: "0 0 auto", border: "1px solid #ff000055", borderRadius: 14, background: "rgba(0,0,0,0.8)", padding: 12, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ marginBottom: 8 }}>
              <FolderTitle style={{ textAlign: "left", fontSize: "1.08em" }}>
                {selected?.name || "Selecione um canal"}
              </FolderTitle>
            </div>
            <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", aspectRatio: "16 / 9", width: "100%", maxWidth: 1220, maxHeight: "68vh", minHeight: 320, margin: "0 auto", flex: "0 0 auto", position: "relative" }}>
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                altSrc={selected?.altUrl || ""}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => handlePlayerError(selected)}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                onCastStart={(device) => {
                  setGlobalCastActive(true);
                  setGlobalCastDevice(device);
                  setGlobalCastTitle(selected?.name || "TV ao Vivo");
                }}
                onCastStop={() => {
                  setGlobalCastActive(false);
                  setGlobalCastDevice(null);
                  setGlobalCastTitle("");
                }}
                globalCastActive={globalCastActive}
                globalCastDevice={globalCastDevice}
              />
            </div>
          </div>
          {renderSelectedSynopsis()}
        </div>
        </FadeTransition>
      );
    }

    return (
      <FadeTransition transitionKey={`live-list-${group}`}>
      <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, height: "calc(100vh - 160px)", overflow: "hidden", alignItems: "stretch" }}>
        <aside style={{ background: "rgba(0,0,0,0.5)", border: "1px solid #ff000033", borderRadius: 12, padding: 12, height: "100%", overflowY: "auto" }}>
          <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 10 }}>Categorias</FolderTitle>
          {liveCategories.map((category) => {
            const active = group === category.raw;
            return (
              <button
                key={category.raw}
                type="button"
                onClick={() => {
                  setShowPlayer(false);
                  setGroup(category.raw);
                }}
                style={{
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 8,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: active ? "1px solid #ff0000" : "1px solid #ff000033",
                  background: active ? "#2c0000" : "#110000",
                  color: "#fff",
                  cursor: "pointer",
                  fontWeight: active ? 700 : 500,
                }}
              >
                {category.label} ({category.count})
              </button>
            );
          })}
        </aside>

        <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {showPlayer && selected && selectedLiveCategory && (
            <section style={{ marginBottom: 20, border: "1px solid #ff000055", borderRadius: 14, background: "rgba(0,0,0,0.8)", padding: 12 }}>
              <div style={{ marginBottom: 8 }}>
                <FolderTitle style={{ textAlign: "left", fontSize: "1.08em" }}>
                  {selected?.name || "Selecione um canal"}
                </FolderTitle>
              </div>
              <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", aspectRatio: "16 / 9", width: "100%", maxWidth: 1060, minHeight: 280, margin: "0 auto", position: "relative" }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowPlayer(false);
                    setBuffering(false);
                  }}
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    zIndex: 30,
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    border: "1px solid #ff0000",
                    background: "rgba(0,0,0,0.78)",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    cursor: "pointer",
                  }}
                  aria-label="Fechar reprodução"
                >
                  <FaTimes size={14} />
                </button>
                <ReactUrlPlayer
                  src={toPlayableUrl(selected?.url)}
                  type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                  onBufferingChange={setBuffering}
                  onError={() => handlePlayerError(selected)}
                  volume={playerVolume}
                  onVolumeStateChange={handlePlayerVolumeStateChange}
                  userHasSetVolume={volumeSetByUserRef.current}
                  fallbackUserVolume={userVolumeRef.current}
                  onCastStart={(device) => {
                    setGlobalCastActive(true);
                    setGlobalCastDevice(device);
                    setGlobalCastTitle(selected?.name || "TV ao Vivo");
                  }}
                  onCastStop={() => {
                    setGlobalCastActive(false);
                    setGlobalCastDevice(null);
                    setGlobalCastTitle("");
                  }}
                  globalCastActive={globalCastActive}
                  globalCastDevice={globalCastDevice}
                />
              </div>
            </section>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }} onScroll={handleScrollInteract}>
            <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 12 }}>
              {selectedLiveCategory?.label || "Selecione uma categoria"}
            </FolderTitle>

            {liveItems.length === 0 && search.trim() && (
              <div style={{ padding: "40px 20px", textAlign: "center", color: "#aaa" }}>
                Nenhum resultado para "<span style={{ color: "#ff6666" }}>{search}</span>"
              </div>
            )}
            <div key={`live-grid-${selectedLiveCategory?.value}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }} onScroll={handleScrollInteract}>
              {liveItems.map((channel, lIdx) => {
                const liveCardKey = `live-${channel.id}`;
                return (
                <div
                  key={channel.id}
                  onMouseEnter={() => {
                    setHoveredCardId(liveCardKey);
                    setUserInteracting(true);
                  }}
                  onMouseLeave={() => {
                    setHoveredCardId(null);
                    setUserInteracting(false);
                  }}
                  onFocus={() => setFocusedCardId(liveCardKey)}
                  onBlur={() => setFocusedCardId(null)}
                  onContextMenu={(event) => handleOpenCardContextMenu(event, {
                    displayName: channel.name,
                    playlistItem: buildPlaylistItemFromChannel(channel),
                  })}
                  onClick={() => playChannel(channel, true)}
                  {...getKeyboardButtonProps(`Reproduzir ${channel.name}`, () => playChannel(channel, true))}
                  style={{
                    width: "100%",
                    height: 126,
                    borderRadius: 12,
                    border: "1px solid #ff000044",
                    background: "#110000",
                    position: "relative",
                    overflow: "hidden",
                    cursor: "pointer",
                    ...getCardStaggerStyle(lIdx),
                    ...getCardInteractiveStyle(liveCardKey),
                  }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(channel.id);
                    }}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      zIndex: 6,
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      border: "1px solid #ff0000",
                      background: "rgba(0,0,0,0.72)",
                      color: isChannelFavorited(channel.id) ? "#ffd700" : "#fff",
                      display: "grid",
                      placeItems: "center",
                      cursor: "pointer",
                    }}
                  >
                    <FaStar size={14} />
                  </button>
                  {channel.logo ? (
                    <CachedLogoImage src={channel.logo} alt={channel.name} style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#ddd", fontWeight: 700, padding: 8, textAlign: "center" }}>
                      {channel.name}
                    </div>
                  )}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: getCardInteractiveState(liveCardKey) ? "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.18))" : "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))",
                      display: "grid",
                      alignContent: "end",
                      padding: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {channel.name}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>

            {!selectedLiveCategory && (
              <div style={{ marginTop: 16, color: "#ddd" }}>
                Selecione uma categoria para ver os canais ao vivo.
              </div>
            )}
          </div>
        </div>
      </div>
      </FadeTransition>
    );
  };

  const downloadText = downloadMetrics.totalBytes > 0
    ? `${formatMegabytes(downloadMetrics.receivedBytes)} / ${formatMegabytes(downloadMetrics.totalBytes)}`
    : `${formatMegabytes(downloadMetrics.receivedBytes)}`;

  const renderContent = () => {
    if (loadingChannels) {
      return null;
    }

    let content = null;
    if (activeNav === 'home') content = renderHome();
    else if (activeNav === 'series') content = renderSeriesView();
    else if (activeNav === 'movies') content = renderMoviesView();
    else if (activeNav === 'live') content = renderLiveView();
    else content = renderHome();

    const transitionKey = activeNav === 'series'
      ? `series-${viewState}-${selectedCategory || ''}-${selectedSeries || ''}-${selectedSeason || ''}`
      : activeNav;

    return (
        <>
            <FadeTransition transitionKey={transitionKey}>
              {content}
            </FadeTransition>
        </>
    );
  };

  const handleContentScroll = (event) => {
    setHeaderSolid(event.currentTarget.scrollTop > 16);
  };

  if (!session) {
    return (
      <>
        <BackgroundLayer />
        <VignetteOverlay />
        <LogoOverlay src={"topo.png"} alt="Logo" />

        <AppContainer>
          <button
            type="button"
            style={{ ...baseButtonStyle, position: "fixed", top: 20, right: 20, zIndex: 99 }}
            onClick={onBack}
          >
            Menu Inicial
          </button>

          <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 80 }}>
            <Tile style={{ width: 520, minHeight: 280, cursor: "default" }} onClick={(e) => e.stopPropagation()}>
              <FolderTitle style={{ fontSize: "1.5em", marginBottom: 8 }}>Entrar com M3U</FolderTitle>
              <ContentInfo style={{ marginBottom: 20, textAlign: "center" }}>
                Cole a URL da sua lista M3U para carregar o conteúdo.
              </ContentInfo>

              <form onSubmit={handleLogin} style={{ width: "100%", display: "grid", gap: 8 }}>
                <label>URL da Lista (.m3u)</label>
                <ModalInput 
                  value={form.url} 
                  onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))} 
                  placeholder="http://exemplo.com/lista.m3u" 
                  disabled={loadingLogin}
                  required 
                />

                <button type="submit" style={{ ...baseButtonStyle, marginTop: 14 }} disabled={loadingLogin}>
                  {loadingLogin ? `Processando ${Math.round(newM3uProgress)}%` : "Carregar Lista"}
                </button>
              </form>

              {(loadingLogin || newM3uError || newM3uDone || newM3uProgress > 0) && (
                <div style={{ marginTop: 12, display: "grid", gap: 8, width: "100%" }}>
                  <div style={{ width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden", border: "1px solid #ff000044" }}>
                    <div
                      style={{
                        width: `${Math.max(0, Math.min(100, newM3uProgress))}%`,
                        height: "100%",
                        background: newM3uError ? "#ff4d4f" : "linear-gradient(90deg, #ff0000, #ff6b6b)",
                        transition: "width 0.25s ease",
                      }}
                    />
                  </div>
                  <div style={{ color: newM3uError ? "#ff8a8a" : "#ddd", fontSize: 13, textAlign: "left" }}>
                    {newM3uError || newM3uStage || "Pronto para iniciar."}
                  </div>
                  {(downloadMetrics.receivedBytes > 0 || downloadMetrics.totalBytes > 0) && (
                    <div style={{ color: "#cfcfcf", fontSize: 12, textAlign: "left" }}>
                      {`Baixado: ${downloadText} • Velocidade: ${formatSpeed(downloadMetrics.speedBps)}`}
                    </div>
                  )}
                </div>
              )}

              <ContentInfo style={{ marginTop: 14, textAlign: "center", width: "100%" }}>{status}</ContentInfo>
            </Tile>
          </div>
        </AppContainer>
      </>
    );
  }

  return (
    <>
      <BackgroundLayer />
      <VignetteOverlay />
      <LogoOverlay src={"topo.png"} alt="Logo" />

      {loadingChannels && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          background: "rgba(0,0,0,0.85)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
        }}>
          <div style={{ width: 48, height: 48, border: "3px solid #ff000033", borderTop: "3px solid #ff0000", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <div style={{ color: "#fff", fontSize: 18, fontWeight: 600 }}>Carregando conteúdo...</div>
          <div style={{ color: "#aaa", fontSize: 13 }}>{contentLoadStage || "Preparando a lista de canais..."}</div>
          <div style={{ width: "min(400px, 70vw)", marginTop: 8 }}>
            <div style={{ width: "100%", height: 8, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{ width: `${Math.max(0, Math.min(100, contentLoadProgress))}%`, height: "100%", background: "linear-gradient(90deg, #ff0000, #ff6b6b)", transition: "width 0.3s ease", borderRadius: 999 }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "#ccc" }}>
              <span>{Math.round(contentLoadProgress)}%</span>
              {downloadMetrics.receivedBytes > 0 && (
                <span>{downloadText} • {formatSpeed(downloadMetrics.speedBps)}</span>
              )}
            </div>
          </div>
        </div>
      )}

      <AppContainer style={{ padding: 0 }}>
        <div style={{ height: "100vh", overflow: "hidden", position: "relative" }}>
          <header
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 80,
              minHeight: APP_HEADER_HEIGHT,
              display: "grid",
              gridTemplateColumns: "auto 1fr auto auto",
              alignItems: "center",
              gap: 16,
              padding: "14px 22px",
              background: headerSolid ? "rgba(0,0,0,0.92)" : "linear-gradient(to bottom, rgba(0,0,0,0.86), rgba(0,0,0,0))",
              borderBottom: headerSolid ? "1px solid #ff000044" : "1px solid transparent",
              transition: "all 0.22s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center" }}>
              <img src={"topo.png"} alt="Logo" style={{ width: 60, height: 60, borderRadius: 12, objectFit: "cover" }} />
            </div>

            <nav style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              {NAV_ITEMS.map((item) => {
                const active = item.key === "playlists"
                  ? activeNav === "home" && homeTab === "playlists"
                  : activeNav === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleNavClick(item.key)}
                    style={{
                      background: active ? "#2c0000" : "transparent",
                      color: "#fff",
                      border: active ? "1px solid #ff0000" : "1px solid transparent",
                      borderRadius: 8,
                      padding: "6px 10px",
                      cursor: "pointer",
                      fontWeight: active ? 700 : 500,
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ position: "relative", minWidth: 220 }}>
                <FaSearch style={{ position: "absolute", left: 10, top: 10, color: "#ff0000" }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar"
                  style={{ width: "100%", background: "rgba(10,10,10,0.85)", border: "1px solid #ff000055", color: "#fff", borderRadius: 8, padding: "8px 10px 8px 30px", outline: "none" }}
                />
              </div>

              {globalCastActive ? (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(34,211,238,0.12)",
                  border: "1px solid #22d3ee",
                  borderRadius: 8,
                  padding: "6px 10px",
                  color: "#22d3ee",
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  maxWidth: 180,
                  overflow: "hidden",
                }}>
                  <FaChromecast size={13} style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", maxWidth: 110 }}>
                    {globalCastTitle || globalCastDevice?.name || "Chromecast"}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await ipcRenderer.invoke("chromecast-stop");
                      setGlobalCastActive(false);
                      setGlobalCastDevice(null);
                      setGlobalCastTitle("");
                      castEndedCallbackRef.current = null;
                    }}
                    style={{ background: "none", border: "none", color: "#22d3ee", cursor: "pointer", padding: 0, marginLeft: 2, display: "flex", alignItems: "center", flexShrink: 0 }}
                    title="Parar transmissão"
                  >
                    <FaTimes size={10} />
                  </button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={async () => {
                      setHeaderCastMenu((prev) => !prev);
                      if (!headerCastMenu) {
                        setHeaderCastDiscovering(true);
                        setHeaderCastDevices([]);
                        try {
                          const result = await ipcRenderer.invoke("chromecast-discover");
                          if (result.ok) setHeaderCastDevices(result.devices || []);
                        } catch {}
                        setHeaderCastDiscovering(false);
                      }
                    }}
                    style={{
                      background: "none",
                      border: "1px solid #ff000055",
                      borderRadius: 8,
                      padding: "6px 10px",
                      color: "#aaa",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      transition: "all 0.2s",
                    }}
                    title="Conectar Chromecast"
                  >
                    <FaChromecast size={14} />
                  </button>
                  {headerCastMenu && (
                    <div style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      marginTop: 6,
                      zIndex: 95,
                      background: "#1a1a1a",
                      border: "1px solid #ff000066",
                      borderRadius: 10,
                      padding: 12,
                      minWidth: 200,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ color: "#fff", fontSize: 12, fontWeight: 700 }}>Chromecast</span>
                        <button type="button" onClick={() => setHeaderCastMenu(false)} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 14 }}>✕</button>
                      </div>
                      {headerCastDiscovering && (
                        <div style={{ color: "#aaa", fontSize: 11, textAlign: "center", padding: 10 }}>Buscando dispositivos...</div>
                      )}
                      {!headerCastDiscovering && headerCastDevices.length === 0 && (
                        <div style={{ color: "#888", fontSize: 11, textAlign: "center", padding: 10 }}>Nenhum dispositivo encontrado.</div>
                      )}
                      {headerCastDevices.map((device, i) => (
                        <button
                          key={`${device.host}-${i}`}
                          type="button"
                          onClick={() => {
                            setGlobalCastActive(true);
                            setGlobalCastDevice(device);
                            setGlobalCastTitle("");
                            setHeaderCastMenu(false);
                          }}
                          style={{
                            width: "100%",
                            padding: "8px 10px",
                            marginBottom: 4,
                            background: "#222",
                            border: "1px solid #333",
                            borderRadius: 6,
                            color: "#fff",
                            fontSize: 12,
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          {device.name || device.host}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              ref={menuBtnRef}
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              style={{ ...baseButtonStyle, display: "flex", alignItems: "center", gap: 8, padding: "8px 10px" }}
            >
              <FaUserCircle />
              <FaBars />
            </button>
          </header>
          {menuOpen && (
            <div
              ref={menuRef}
              style={{
                position: "absolute",
                top: APP_HEADER_HEIGHT - 8,
                right: 20,
                zIndex: 90,
                width: 290,
                background: "rgba(10,10,10,0.96)",
                border: "1px solid #ff000055",
                borderRadius: 12,
                padding: 12,
                boxShadow: "0 14px 30px rgba(0,0,0,0.5)",
                display: "grid",
                gap: 8,
                maxHeight: "74vh",
                overflowY: "auto",
              }}
            >
              <button type="button" style={baseButtonStyle} onClick={handleToggleFullscreen}>
                {isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleClearCache}>
                Limpar cache
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleSetNewM3uUrl}>
                Informar nova URL M3U
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleConfigureTmdbKey}>
                Configurar chave TMDB
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleOpenCreatePlaylistModal}>
                Criar Playlist
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleRefresh}>
                {loadingChannels ? "Recarregando conteúdo..." : "Recarregar Conteúdo"}
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleClearAllApp}>
                Limpar todo app
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleExitApp}>
                Sair
              </button>
            </div>
          )}

          {contextMenuState && (
            <div
              ref={contextMenuRef}
              style={{
                position: "fixed",
                top: Math.max(8, Math.min(contextMenuState.y, window.innerHeight - 340)),
                left: Math.max(8, Math.min(contextMenuState.x, window.innerWidth - 300)),
                zIndex: 120,
                width: 280,
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid #ff000066",
                borderRadius: 12,
                background: "rgba(10,10,10,0.98)",
                boxShadow: "0 14px 30px rgba(0,0,0,0.55)",
                padding: 10,
                display: "grid",
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 12, color: "#ddd", marginBottom: 2 }}>
                Adicionar: {contextMenuState.item?.displayName || "Item"}
              </div>
              <button
                type="button"
                style={{ ...baseButtonStyle, background: "#2c0000" }}
                onClick={async () => {
                  setContextMenuState(null);
                  handleOpenCreatePlaylistModal();
                }}
              >
                + Criar playlist
              </button>
              {customPlaylists.length > 0 ? (
                customPlaylists.map((playlist) => (
                  <button
                    key={playlist.id}
                    type="button"
                    style={{ ...baseButtonStyle, textAlign: "left" }}
                    onClick={() => handleAddItemToPlaylist(playlist.id, contextMenuState.item?.playlistItem)}
                  >
                    {playlist.name}
                  </button>
                ))
              ) : (
                <div style={{ color: "#bbb", fontSize: 12 }}>Crie uma playlist para adicionar itens.</div>
              )}
            </div>
          )}

          {createPlaylistModalOpen && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 121, background: "rgba(0,0,0,0.78)", display: "grid", placeItems: "center", padding: 20 }}
              onClick={() => setCreatePlaylistModalOpen(false)}
            >
              <div
                style={{ width: "min(520px, 92vw)", border: "1px solid #ff000066", borderRadius: 14, background: "#0f0f0f", padding: 16, boxShadow: "0 18px 34px rgba(0,0,0,0.5)", display: "grid", gap: 12 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <FolderTitle style={{ textAlign: "left", fontSize: "1.15em", margin: 0 }}>Criar playlist</FolderTitle>
                  <button type="button" style={{ ...baseButtonStyle, padding: "6px 10px" }} onClick={() => setCreatePlaylistModalOpen(false)}>
                    <FaTimes />
                  </button>
                </div>
                <ModalInput
                  value={createPlaylistNameInput}
                  onChange={(event) => setCreatePlaylistNameInput(event.target.value)}
                  placeholder="Nome da playlist"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleCreatePlaylist(createPlaylistNameInput);
                    }
                  }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" style={baseButtonStyle} onClick={() => setCreatePlaylistModalOpen(false)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    style={{ ...baseButtonStyle, background: "#ff0000", color: "#000" }}
                    onClick={() => handleCreatePlaylist(createPlaylistNameInput)}
                  >
                    Criar
                  </button>
                </div>
              </div>
            </div>
          )}

          {playlistDeleteModalState && (
            <div
              style={{ position: "fixed", inset: 0, zIndex: 122, background: "rgba(0,0,0,0.8)", display: "grid", placeItems: "center", padding: 20 }}
              onClick={handleCancelRemovePlaylist}
            >
              <div
                style={{ width: "min(560px, 92vw)", border: "1px solid #ff000066", borderRadius: 14, background: "#0f0f0f", padding: 16, boxShadow: "0 18px 34px rgba(0,0,0,0.5)", display: "grid", gap: 12 }}
                onClick={(event) => event.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <FolderTitle style={{ textAlign: "left", fontSize: "1.15em", margin: 0 }}>Excluir playlist</FolderTitle>
                  <button type="button" style={{ ...baseButtonStyle, padding: "6px 10px" }} onClick={handleCancelRemovePlaylist}>
                    <FaTimes />
                  </button>
                </div>
                <div style={{ color: "#f5d7d7", fontSize: 14, lineHeight: 1.5 }}>
                  Você está prestes a excluir <b>{playlistDeleteModalState.name}</b>.
                  <br />
                  Todos os itens dentro dela também serão apagados.
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" style={baseButtonStyle} onClick={handleCancelRemovePlaylist}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    style={{ ...baseButtonStyle, background: "#ff0000", color: "#000" }}
                    onClick={handleConfirmRemovePlaylist}
                  >
                    Excluir playlist
                  </button>
                </div>
              </div>
            </div>
          )}

          {newM3uModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 110, background: "rgba(0,0,0,0.78)", display: "grid", placeItems: "center", padding: 20 }} onClick={() => setNewM3uModalOpen(false)}>
              <div style={{ width: "min(680px, 92vw)", border: "1px solid #ff000066", borderRadius: 14, background: "#0f0f0f", padding: 16, boxShadow: "0 18px 34px rgba(0,0,0,0.5)", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <FolderTitle style={{ textAlign: "left", fontSize: "1.25em" }}>Informar nova URL M3U</FolderTitle>
                  <button type="button" style={{ ...baseButtonStyle, padding: "6px 10px" }} onClick={() => setNewM3uModalOpen(false)}>
                    <FaTimes />
                  </button>
                </div>
                <input
                  value={newM3uUrlInput}
                  onChange={(e) => setNewM3uUrlInput(e.target.value)}
                  placeholder="https://servidor.exemplo/lista.m3u"
                  autoFocus
                  disabled={loadingLogin}
                  style={{ width: "100%", background: "rgba(10,10,10,0.85)", border: "1px solid #ff000055", color: "#fff", borderRadius: 8, padding: "10px 12px", outline: "none" }}
                />
                {(loadingLogin || newM3uError || newM3uDone || newM3uProgress > 0) && (
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ width: "100%", height: 10, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden", border: "1px solid #ff000044" }}>
                      <div
                        style={{
                          width: `${Math.max(0, Math.min(100, newM3uProgress))}%`,
                          height: "100%",
                          background: newM3uError ? "#ff4d4f" : "linear-gradient(90deg, #ff0000, #ff6b6b)",
                          transition: "width 0.25s ease",
                        }}
                      />
                    </div>
                    <div style={{ color: newM3uError ? "#ff8a8a" : "#ddd", fontSize: 13 }}>
                      {newM3uError || newM3uStage || "Pronto para iniciar."}
                    </div>
                    {(downloadMetrics.receivedBytes > 0 || downloadMetrics.totalBytes > 0) && (
                      <div style={{ color: "#cfcfcf", fontSize: 12 }}>
                        {`Baixado: ${downloadText} • Velocidade: ${formatSpeed(downloadMetrics.speedBps)}`}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" style={baseButtonStyle} onClick={() => setNewM3uModalOpen(false)} disabled={loadingLogin}>
                    Cancelar
                  </button>
                  <button type="button" style={{ ...baseButtonStyle, background: "#ff0000", color: "#000" }} onClick={handleConfirmNewM3uUrl} disabled={loadingLogin}>
                    {loadingLogin ? `Processando ${Math.round(newM3uProgress)}%` : "Salvar e atualizar"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tmdbModalOpen && (
            <div style={{ position: "fixed", inset: 0, zIndex: 111, background: "rgba(0,0,0,0.78)", display: "grid", placeItems: "center", padding: 20 }} onClick={() => !savingTmdbApiKey && setTmdbModalOpen(false)}>
              <div style={{ width: "min(680px, 92vw)", border: "1px solid #ff000066", borderRadius: 14, background: "#0f0f0f", padding: 16, boxShadow: "0 18px 34px rgba(0,0,0,0.5)", display: "grid", gap: 12 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <FolderTitle style={{ textAlign: "left", fontSize: "1.25em" }}>Configurar chave TMDB</FolderTitle>
                  <button type="button" style={{ ...baseButtonStyle, padding: "6px 10px" }} onClick={() => !savingTmdbApiKey && setTmdbModalOpen(false)}>
                    <FaTimes />
                  </button>
                </div>
                <input
                  value={tmdbApiKeyInput}
                  onChange={(e) => setTmdbApiKeyInput(e.target.value)}
                  placeholder="Cole sua TMDB API Key"
                  autoFocus
                  style={{ width: "100%", background: "rgba(10,10,10,0.85)", border: "1px solid #ff000055", color: "#fff", borderRadius: 8, padding: "10px 12px", outline: "none" }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button type="button" style={baseButtonStyle} onClick={() => setTmdbModalOpen(false)} disabled={savingTmdbApiKey}>
                    Cancelar
                  </button>
                  <button type="button" style={{ ...baseButtonStyle, background: "#ff0000", color: "#000" }} onClick={handleConfirmTmdbKey} disabled={savingTmdbApiKey}>
                    {savingTmdbApiKey ? "Salvando..." : "Salvar chave"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div
            ref={contentRef}
            onScroll={handleContentScroll}
            style={{ height: "100%", overflowY: "auto", paddingTop: APP_HEADER_HEIGHT + 12, paddingBottom: 56 }}
          >
            {renderContent()}
          </div>
        </div>

        <footer style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "linear-gradient(to top, rgba(0,0,0,0.95) 60%, transparent)",
          padding: "18px 20px 12px",
          color: "#d1d1d1",
          fontSize: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          pointerEvents: "none",
        }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, pointerEvents: "auto" }}>
            <a href="#" style={{ color: "#ff0000" }}>Termos</a>
            <a href="#" style={{ color: "#ff0000" }}>Privacidade</a>
            <a href="#" style={{ color: "#ff0000" }}>Suporte</a>
            <a href="#" style={{ color: "#ff0000" }}>Redes</a>
          </div>
          <div style={{ color: "#888" }}>{status}</div>
        </footer>

        {infoChannel && (
          <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.78)", display: "grid", placeItems: "center", padding: 20 }} onClick={() => setInfoChannel(null)}>
            <div style={{ width: "min(680px, 92vw)", border: "1px solid #ff000066", borderRadius: 14, background: "#0f0f0f", padding: 16, boxShadow: "0 18px 34px rgba(0,0,0,0.5)" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <FolderTitle style={{ textAlign: "left", fontSize: "1.25em" }}>{infoChannel.name}</FolderTitle>
                <button type="button" style={{ ...baseButtonStyle, padding: "6px 10px" }} onClick={() => setInfoChannel(null)}>
                  <FaTimes />
                </button>
              </div>

              <ContentInfo style={{ textAlign: "left", lineHeight: 1.6 }}>
                <div><b>Grupo:</b> {infoChannel.group}</div>
                <div><b>Categoria:</b> {normalizeCategoryLabel(infoChannel.group)}</div>
                <div><b>Tvg ID:</b> {infoChannel.tvgId || "N/A"}</div>
                <div><b>URL:</b> {infoChannel.url}</div>
              </ContentInfo>

              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                <button type="button" style={{ ...baseButtonStyle, background: "#ff0000", color: "#000" }} onClick={() => { playChannel(infoChannel, true); setInfoChannel(null); }}>
                  <FaPlay style={{ marginRight: 6 }} /> Assistir
                </button>

                <button type="button" style={baseButtonStyle} onClick={() => toggleFavorite(infoChannel.id)}>
                  <FaPlus style={{ marginRight: 6 }} />
                  {favoriteIds.includes(infoChannel.id) ? "Na lista" : "Adicionar"}
                </button>
              </div>
            </div>
          </div>
        )}
      </AppContainer>
    </>
  );
}
