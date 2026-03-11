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
  FaSearch,
  FaStar,
  FaTimes,
  FaTv,
  FaUserCircle,
  FaVideo,
} from "react-icons/fa";

const { ipcRenderer } = window.require("electron");

const NAV_ITEMS = [
  { key: "home", label: "Início" },
  { key: "live", label: "TV ao Vivo" },
  { key: "movies", label: "Filmes" },
  { key: "series", label: "Séries" },
];

function getLimitForKind(kind) {
  if (kind === "movie") return 5000;
  if (kind === "series") return 5000;
  if (kind === "live") return 5000;
  if (kind === "all") return 10000;
  return 3000;
}

function toPlayableUrl(rawUrl) {
  if (!rawUrl) return "";
  if (/\.ts(\?|$)/i.test(rawUrl)) {
    return rawUrl.replace(/\.ts(\?|$)/i, ".m3u8$1");
  }
  return rawUrl;
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

const cachedLogoByUrl = new Map();
const inFlightLogoRequests = new Map();
const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const PLAYER_VOLUME_STORAGE_KEY = "iptv_player_volume_session";

const ReactUrlPlayer = ({
  src,
  type,
  onBufferingChange,
  onError,
  onEnded,
  volume = 0.8,
  onVolumeStateChange,
  userHasSetVolume = false,
  fallbackUserVolume = null,
  interactionTick = null,
}) => {
  const isHlsSource = useMemo(() => /\.m3u8(\?|$)/i.test(src || ""), [src]);
  const playerSource = useMemo(() => src || "", [src]);
  const playerRef = useRef(null);
  const applyingVolumeRef = useRef(false);

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
    const baseVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    
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
  }, [getMediaElement, volume]);

  useEffect(() => {
    if (!playerSource) return;
    const p = playerRef.current?.play?.();
    if (p && typeof p.catch === "function") {
      p.catch(() => {});
    }
  }, [playerSource]);

  // Proteger volume quando o player for inicializado
  useEffect(() => {
    if (!playerSource) return;
    
    // Capturar valores das refs fora da função assíncrona
    const userVol = typeof fallbackUserVolume === "number" ? fallbackUserVolume : null;
    const volSetByUser = !!userHasSetVolume;
    
    const protectVolume = () => {
      if (volSetByUser && userVol > 0.001) {
        // Se o usuário já definiu um volume, garantir que seja usado
        setTimeout(() => {
          const mediaElement = getMediaElement();
          if (mediaElement) {
            if (mediaElement.volume <= 0.001) {
              mediaElement.volume = userVol;
              mediaElement.muted = false;
            }
          }
        }, 200);
      }
    };
    
    protectVolume();
  }, [playerSource, getMediaElement, userHasSetVolume, fallbackUserVolume]);

  useEffect(() => {
    if (!playerSource) return;

    let cancelled = false;
    let timeoutId = null;
    let attempts = 0;
    
    // Capturar valores das refs fora da função assíncrona
    const volSetByUser = !!userHasSetVolume;
    const userVol = typeof fallbackUserVolume === "number" ? fallbackUserVolume : null;

    const scheduleSync = () => {
      if (cancelled) return;
      // Proteger volume do usuário ao trocar de source
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
      if (attempts < 20) {
        timeoutId = window.setTimeout(scheduleSync, 120);
      }
    };

    scheduleSync();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [playerSource, syncVolumeToMediaElement, userHasSetVolume, fallbackUserVolume]);

  useEffect(() => {
    syncVolumeToMediaElement();
  }, [interactionTick, syncVolumeToMediaElement]);

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
      <ReactPlayer
        ref={playerRef}
        key={playerSource ? "player-instance" : "empty-player"}
        src={playerSource}
        controls
        playsInline
        width="100%"
        height="100%"
        style={{ background: "#000" }}
        volume={effectiveVolume}
        muted={effectiveVolume <= 0.001}
        onPlaying={() => {
          onBufferingChange && onBufferingChange(false);
          syncVolumeToMediaElement();
          setTimeout(() => {
            syncVolumeToMediaElement();
          }, 50);
        }}
        config={{
          file: {
            forceHLS: isHlsSource,
            attributes: {
              crossOrigin: "anonymous",
            },
          },
        }}
        onCanPlay={() => onBufferingChange && onBufferingChange(false)}
        onWaiting={() => onBufferingChange && onBufferingChange(true)}
        onPause={() => onBufferingChange && onBufferingChange(false)}
        onEnded={() => onEnded && onEnded()}
        onError={(error) => {
          onBufferingChange && onBufferingChange(false);
          onError && onError(error);
        }}
      />);
      })()}
      
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
};

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

export default function IptvModule({ onBack }) {
  const [form, setForm] = useState({
    url: "",
  });

  const [session, setSession] = useState(null);
  const [status, setStatus] = useState("Informe a URL da lista M3U.");
  const [loadingLogin, setLoadingLogin] = useState(false);
  const [loadingChannels, setLoadingChannels] = useState(false);

  // 'home', 'live', 'movies', 'series'
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

  // For Series Navigation
  const [viewState, setViewState] = useState("categories"); // categories, series_list, seasons, episodes
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedSeason, setSelectedSeason] = useState(null);

  const [hoveredCardId, setHoveredCardId] = useState(null);
  const [headerSolid, setHeaderSolid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoChannel, setInfoChannel] = useState(null);
  const [userInteracting, setUserInteracting] = useState(false);
  const [newM3uModalOpen, setNewM3uModalOpen] = useState(false);
  const [newM3uUrlInput, setNewM3uUrlInput] = useState("");
  const [newM3uProgress, setNewM3uProgress] = useState(0);
  const [newM3uStage, setNewM3uStage] = useState("");
  const [newM3uError, setNewM3uError] = useState("");
  const [newM3uDone, setNewM3uDone] = useState(false);
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
  
  // Refs para proteção do volume
  const userVolumeRef = useRef(playerVolume);
  const volumeProtectionRef = useRef(false);
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
    } catch {
      setFavoriteIds([]);
      setLikedIds([]);
      setRecentlyPlayedIds([]);
    }

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
    if (userInteracting) return;
    const nextVolume = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    if (nextVolume > 0.001) {
      volumeSetByUserRef.current = true;
      userVolumeRef.current = nextVolume;
    }
    setPlayerVolume((prev) => (Math.abs(prev - nextVolume) > 0.001 ? nextVolume : prev));
  }, [userInteracting]);

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
          setSynopsisHint("TMDB_API_KEY não configurada no ambiente.");
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
    const searchNorm = search.trim().toLowerCase();
    const source = activeNav === "minha-lista" ? favorites : channels;

    return source.filter((item) => {
      if (!matchNav(item, activeNav)) return false;

      const groupMatch = !group || item.group === group;
      if (!groupMatch) return false;

      if (!searchNorm) return true;

      return (
        item.name.toLowerCase().includes(searchNorm) ||
        item.group.toLowerCase().includes(searchNorm)
      );
    });
  }, [channels, favorites, activeNav, group, search]);

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

    const searchNorm = search.trim().toLowerCase();
    const byCategory = new Map();

    channels.forEach((item) => {
      if (item.kind !== "movie") return;
      if (
        searchNorm &&
        !item.name.toLowerCase().includes(searchNorm) &&
        !item.group.toLowerCase().includes(searchNorm)
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

    const searchNorm = search.trim().toLowerCase();
    const byCategory = new Map();

    channels.forEach((item) => {
      if (item.kind !== "live") return;
      if (
        searchNorm &&
        !item.name.toLowerCase().includes(searchNorm) &&
        !item.group.toLowerCase().includes(searchNorm)
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
    setAdultMoviesUnlocked(false);
    handleLogout();
    setStatus("Dados do aplicativo removidos com sucesso.");
  };

  const handleExitApp = async () => {
    setMenuOpen(false);
    await ipcRenderer.invoke("iptv-exit-app");
  };

  const handleNavClick = (navKey) => {
    setActiveNav(navKey);
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

  };

  const playChannel = (channel, forceOpenPlayer = true) => {
    setSelected(channel);

    if (forceOpenPlayer) {
      setShowPlayer(true);
    }

    setRecentlyPlayedIds((prev) => {
      const currentId = String(channel.id);
      const next = [currentId, ...prev.filter((id) => id !== currentId)];
      return next.slice(0, 10);
    });

    setStatus(`Reprodução selecionada: ${channel.name}`);
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

  const playHomeItem = (item) => {
    if (item.favoriteType === "series") {
      openFavoriteSeries(item);
      return;
    }

    if (item.kind === "series") {
      const info = parseEpisodeInfo(item.name);
      handleNavClick("series");
      setSelectedCategory(normalizeCategoryLabel(item.group));
      setSelectedSeries(info.seriesName);
      setSelectedSeason(info.season);
      setViewState("seasons");
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

  const renderHome = () => (
    <div style={{ padding: "0 20px" }}>
      <div style={{ display: "flex", gap: 20, marginBottom: 40, flexWrap: "wrap", justifyContent: "center" }}>
        <Tile 
          style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
          onClick={() => handleNavClick('live')}
        >
          <FolderTitle style={{ fontSize: "1.8em" }}>TV ao Vivo</FolderTitle>
          <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
            <FaTv size={75} />
          </div>
        </Tile>
        <Tile 
          style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
          onClick={() => handleNavClick('movies')}
        >
          <FolderTitle style={{ fontSize: "1.8em" }}>Filmes</FolderTitle>
          <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
            <FaFilm size={75} />
          </div>
        </Tile>
        <Tile 
          style={{ width: 300, height: 180, cursor: "pointer", background: "linear-gradient(135deg, #2c0000 0%, #000 100%)", border: "1px solid #ff0000", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
          onClick={() => handleNavClick('series')}
        >
          <FolderTitle style={{ fontSize: "1.8em" }}>Séries</FolderTitle>
          <div style={{ marginTop: 14, width: "100%", display: "flex", justifyContent: "center", color: "#ff0000", filter: "drop-shadow(0 0 6px #ff0000aa)" }}>
            <FaVideo size={75} />
          </div>
        </Tile>
      </div>
      
      {[rows.find((row) => row.key === "continuar"), rows.find((row) => row.key === "favoritos")].filter(Boolean).map((row) => (
        <div key={row.key} style={{ marginBottom: 20 }}>
          <FolderTitle style={{ textAlign: "left", fontSize: "1.2em", marginBottom: 12 }}>{row.title}</FolderTitle>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
            {row.items.map((channel) => (
              <div
                key={channel.id}
                onClick={() => playHomeItem(channel)}
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
                  <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", padding: 4, fontSize: 11 }}>
                    {channel.name}
                  </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  const renderSeriesView = () => {
    if (viewState === 'categories') {
      const cats = Object.keys(seriesData).sort();
      const activeCategory = selectedCategory && cats.includes(selectedCategory) ? selectedCategory : (cats[0] || null);
      const seriesList = activeCategory && seriesData[activeCategory] ? Object.values(seriesData[activeCategory]) : [];
      
      if (cats.length === 0) {
        return (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#ddd" }}>
            <FolderTitle style={{ marginBottom: 10 }}>Nenhuma série encontrada</FolderTitle>
            <div>Verifique se sua lista possui grupos identificados como "Series", "Séries", "Novelas", etc.</div>
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
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
              {seriesList.map((s) => (
                <div
                  key={s.name}
                  onClick={() => {
                    setSelected(null);
                    setBuffering(false);
                    setSelectedCategory(activeCategory);
                    setSelectedSeries(s.name);
                    setViewState('seasons');
                  }}
                  style={{ aspectRatio: "2/3", background: "#000", border: "1px solid #ff000044", borderRadius: 12, cursor: "pointer", overflow: "hidden", position: "relative" }}
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
              ))}
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
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
            {seriesList.map(s => (
              <div 
                key={s.name}
                onClick={() => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeries(s.name);
                  setViewState('seasons');
                }}
                style={{ aspectRatio: "2/3", background: "#000", border: "1px solid #ff000044", borderRadius: 12, cursor: "pointer", overflow: "hidden", position: "relative" }}
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
            ))}
          </div>
        </div>
      );
    }

    if (viewState === 'seasons') {
      const categoryData = seriesData[selectedCategory];
      const series = categoryData ? categoryData[selectedSeries] : null;

      if (!series) {
         // Fallback if data is missing
         return <div onClick={() => setViewState('categories')}>Dados não encontrados. Voltar.</div>;
      }

      const seasons = Object.keys(series.seasons).sort((a,b) => parseInt(a) - parseInt(b));
      
      return (
        <div style={{ padding: "0 20px" }}>
          <button style={{ ...baseButtonStyle, marginBottom: 20 }} onClick={() => setViewState('categories')}>Voltar</button>
          <FolderTitle style={{ marginBottom: 20 }}>{series.name}</FolderTitle>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {seasons.map(sea => (
              <div 
                key={sea}
                onClick={() => {
                  setSelected(null);
                  setBuffering(false);
                  setSelectedSeason(sea);
                  setViewState('episodes');
                }}
                style={{ padding: "20px 40px", background: "#1a0000", border: "1px solid #ff0000", borderRadius: 12, cursor: "pointer", fontSize: "1.2em", fontWeight: "bold" }}
              >
                Temporada {sea}
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (viewState === 'episodes') {
      const categoryData = seriesData[selectedCategory];
      const series = categoryData ? categoryData[selectedSeries] : null;

      if (!series || !series.seasons[selectedSeason]) {
         return <div onClick={() => setViewState('categories')}>Dados não encontrados. Voltar.</div>;
      }

      const episodes = series.seasons[selectedSeason].sort((a,b) => a.episodeNum - b.episodeNum);
      const currentEpisode = episodes.find((ep) => ep.id === selected?.id) || null;
      const currentEpisodeIndex = currentEpisode ? episodes.findIndex((ep) => ep.id === currentEpisode.id) : -1;

      const handleEpisodeEnded = () => {
        const nextEpisode = currentEpisodeIndex >= 0 ? episodes[currentEpisodeIndex + 1] : null;
        if (!nextEpisode) {
          setBuffering(false);
          return;
        }
        setBuffering(true);
        playChannel(nextEpisode, false);
      };

      return (
        <div style={{ padding: "0 20px", display: "grid", gridTemplateColumns: "1fr 350px", gap: 20, minHeight: "calc(100vh - 140px)", alignItems: "start" }}>
           <div style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%" }}>
             <button style={{ ...baseButtonStyle, width: "fit-content", marginBottom: 10 }} onClick={() => setViewState('seasons')}>Voltar</button>
             <div style={{ background: "#000", borderRadius: 12, overflow: "hidden", border: "1px solid #ff000044", aspectRatio: "16 / 9", width: "100%", maxHeight: "68vh", minHeight: 320, position: "relative", flex: "0 0 auto" }}>
                {buffering && (
                  <div style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 20,
                    background: "rgba(0,0,0,0.6)",
                    display: "grid",
                    placeItems: "center",
                    color: "#ff0000"
                  }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "3em", animation: "spin 1s linear infinite" }}>
                        <FaSearch />
                      </div>
                      <div style={{ marginTop: 10, fontWeight: "bold" }}>Carregando...</div>
                    </div>
                  </div>
                )}
                <ReactUrlPlayer 
                  src={toPlayableUrl(currentEpisode?.url)} 
                  type={mediaTypeFromUrl(toPlayableUrl(currentEpisode?.url))}
                  onBufferingChange={setBuffering}
                  onError={() => setBuffering(false)}
                  onEnded={handleEpisodeEnded}
                  volume={playerVolume}
                  onVolumeStateChange={handlePlayerVolumeStateChange}
                  userHasSetVolume={volumeSetByUserRef.current}
                  fallbackUserVolume={userVolumeRef.current}
                  interactionTick={hoveredCardId}
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
              {episodes.map(ep => (
                <div 
                  key={ep.id}
                  onClick={() => playChannel(ep, false)} // false means don't open modal, just set selected
                  style={{ 
                    padding: 10, 
                    marginBottom: 8, 
                    background: selected?.id === ep.id ? "#ff000044" : "#1a1a1a", 
                    borderRadius: 6, 
                    cursor: "pointer",
                    border: selected?.id === ep.id ? "1px solid #ff0000" : "1px solid transparent"
                  }}
                >
                  <div style={{ fontWeight: "bold", fontSize: 13 }}>{ep.episodeNum}. {ep.name}</div>
                </div>
              ))}
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
              {buffering && selected && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 20,
                    background: "rgba(0,0,0,0.6)",
                    display: "grid",
                    placeItems: "center",
                    color: "#ff0000",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3em", animation: "spin 1s linear infinite" }}>
                      <FaSearch />
                    </div>
                    <div style={{ marginTop: 10, fontWeight: "bold" }}>Carregando...</div>
                  </div>
                </div>
              )}
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => setBuffering(false)}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                interactionTick={hoveredCardId}
              />
            </div>
          </div>
          {renderSelectedSynopsis()}
        </div>
      );
    }

    return (
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
              {buffering && selected && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 20,
                    background: "rgba(0,0,0,0.6)",
                    display: "grid",
                    placeItems: "center",
                    color: "#ff0000",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3em", animation: "spin 1s linear infinite" }}>
                      <FaSearch />
                    </div>
                    <div style={{ marginTop: 10, fontWeight: "bold" }}>Carregando...</div>
                  </div>
                </div>
              )}
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => setBuffering(false)}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                interactionTick={hoveredCardId}
              />
            </div>
          </section>
        )}

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
          <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 12 }}>
            {selectedMovieCategory?.label || "Selecione uma categoria"}
          </FolderTitle>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }} onScroll={handleScrollInteract}>
            {movieItems.map((channel) => (
              <div
                key={channel.id}
                onMouseEnter={() => {
                  setHoveredCardId(`movie-${channel.id}`);
                  setUserInteracting(true);
                }}
                onMouseLeave={() => {
                  setHoveredCardId(null);
                  setUserInteracting(false);
                }}
                onClick={() => playChannel(channel, true)}
                style={{
                  width: "100%",
                  height: 126,
                  borderRadius: 12,
                  border: hoveredCardId === `movie-${channel.id}` ? "1px solid #ff0000" : "1px solid #ff000044",
                  background: "#110000",
                  position: "relative",
                  overflow: "hidden",
                  transform: hoveredCardId === `movie-${channel.id}` ? "scale(1.03)" : "scale(1)",
                  transition: "all 0.2s ease",
                  cursor: "pointer",
                  boxShadow: hoveredCardId === `movie-${channel.id}` ? "0 10px 20px rgba(0,0,0,0.45)" : "none",
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
                    background: hoveredCardId === `movie-${channel.id}` ? "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.18))" : "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))",
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
            ))}
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
  );
  };

  const renderLiveView = () => {
    const selectedLiveCategory = liveCategories.find((category) => category.raw === group) || null;
    const liveItems = selectedLiveCategory ? filteredChannels : [];

    if (showPlayer && selected && selectedLiveCategory) {
      return (
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
              {buffering && selected && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    zIndex: 20,
                    background: "rgba(0,0,0,0.6)",
                    display: "grid",
                    placeItems: "center",
                    color: "#ff0000",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "3em", animation: "spin 1s linear infinite" }}>
                      <FaSearch />
                    </div>
                    <div style={{ marginTop: 10, fontWeight: "bold" }}>Carregando...</div>
                  </div>
                </div>
              )}
              <ReactUrlPlayer
                src={toPlayableUrl(selected?.url)}
                type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                onBufferingChange={setBuffering}
                onError={() => setBuffering(false)}
                volume={playerVolume}
                onVolumeStateChange={handlePlayerVolumeStateChange}
                userHasSetVolume={volumeSetByUserRef.current}
                fallbackUserVolume={userVolumeRef.current}
                interactionTick={hoveredCardId}
              />
            </div>
          </div>
          {renderSelectedSynopsis()}
        </div>
      );
    }

    return (
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
                {buffering && selected && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 20,
                      background: "rgba(0,0,0,0.6)",
                      display: "grid",
                      placeItems: "center",
                      color: "#ff0000",
                    }}
                  >
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "3em", animation: "spin 1s linear infinite" }}>
                        <FaSearch />
                      </div>
                      <div style={{ marginTop: 10, fontWeight: "bold" }}>Carregando...</div>
                    </div>
                  </div>
                )}
                <ReactUrlPlayer
                  src={toPlayableUrl(selected?.url)}
                  type={mediaTypeFromUrl(toPlayableUrl(selected?.url))}
                  onBufferingChange={setBuffering}
                  onError={() => setBuffering(false)}
                  volume={playerVolume}
                  onVolumeStateChange={handlePlayerVolumeStateChange}
                  userHasSetVolume={volumeSetByUserRef.current}
                  fallbackUserVolume={userVolumeRef.current}
                  interactionTick={hoveredCardId}
                />
              </div>
            </section>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }} onScroll={handleScrollInteract}>
            <FolderTitle style={{ textAlign: "left", fontSize: "1.08em", marginBottom: 12 }}>
              {selectedLiveCategory?.label || "Selecione uma categoria"}
            </FolderTitle>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }} onScroll={handleScrollInteract}>
              {liveItems.map((channel) => (
                <div
                  key={channel.id}
                  onMouseEnter={() => {
                    setHoveredCardId(`live-${channel.id}`);
                    setUserInteracting(true);
                  }}
                  onMouseLeave={() => {
                    setHoveredCardId(null);
                    setUserInteracting(false);
                  }}
                  onClick={() => playChannel(channel, true)}
                  style={{
                    width: "100%",
                    height: 126,
                    borderRadius: 12,
                    border: hoveredCardId === `live-${channel.id}` ? "1px solid #ff0000" : "1px solid #ff000044",
                    background: "#110000",
                    position: "relative",
                    overflow: "hidden",
                    transform: hoveredCardId === `live-${channel.id}` ? "scale(1.03)" : "scale(1)",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                    boxShadow: hoveredCardId === `live-${channel.id}` ? "0 10px 20px rgba(0,0,0,0.45)" : "none",
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
                      background: hoveredCardId === `live-${channel.id}` ? "linear-gradient(to top, rgba(0,0,0,0.94), rgba(0,0,0,0.18))" : "linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))",
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
              ))}
            </div>

            {!selectedLiveCategory && (
              <div style={{ marginTop: 16, color: "#ddd" }}>
                Selecione uma categoria para ver os canais ao vivo.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const downloadText = downloadMetrics.totalBytes > 0
    ? `${formatMegabytes(downloadMetrics.receivedBytes)} / ${formatMegabytes(downloadMetrics.totalBytes)}`
    : `${formatMegabytes(downloadMetrics.receivedBytes)}`;

  const renderContent = () => {
    if (loadingChannels) {
      return (
         <div style={{ display: "grid", placeItems: "center", height: "60vh", color: "#ff0000" }}>
            <div style={{ textAlign: "center" }}>
               <div style={{ fontSize: "3em", marginBottom: 20, animation: "spin 1s linear infinite", display: "inline-block" }}>
                 <FaSearch />
               </div>
               <FolderTitle style={{ fontSize: "1.5em", marginBottom: 10 }}>Carregando conteúdo...</FolderTitle>
               <div style={{ color: "#aaa", marginBottom: 12 }}>{contentLoadStage || "Isso pode levar alguns segundos."}</div>
               <div style={{ width: "min(560px, 72vw)", margin: "0 auto", display: "grid", gap: 8 }}>
                 <div style={{ width: "100%", height: 12, borderRadius: 999, background: "rgba(255,255,255,0.12)", overflow: "hidden", border: "1px solid #ff000044" }}>
                   <div
                     style={{
                       width: `${Math.max(0, Math.min(100, contentLoadProgress))}%`,
                       height: "100%",
                       background: "linear-gradient(90deg, #ff0000, #ff6b6b)",
                       transition: "width 0.25s ease",
                     }}
                   />
                 </div>
                 <div style={{ color: "#ddd", fontSize: 13 }}>
                   {Math.round(contentLoadProgress)}%
                 </div>
                 {(downloadMetrics.receivedBytes > 0 || downloadMetrics.totalBytes > 0) && (
                   <div style={{ color: "#cfcfcf", fontSize: 12 }}>
                     {`Baixado: ${downloadText} • Velocidade: ${formatSpeed(downloadMetrics.speedBps)}`}
                   </div>
                 )}
               </div>
               <style>{`
                 @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
               `}</style>
            </div>
         </div>
      );
    }

    let content = null;
    if (activeNav === 'home') content = renderHome();
    else if (activeNav === 'series') content = renderSeriesView();
    else if (activeNav === 'movies') content = renderMoviesView();
    else if (activeNav === 'live') content = renderLiveView();
    else content = renderHome();

    return (
        <>
            {content}
            <footer style={{ margin: "22px 20px 0", borderTop: "1px solid #ff000033", padding: "14px 0 24px", color: "#d1d1d1", fontSize: 12, display: "grid", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <a href="#" style={{ color: "#ff0000" }}>Termos</a>
                <a href="#" style={{ color: "#ff0000" }}>Privacidade</a>
                <a href="#" style={{ color: "#ff0000" }}>Suporte</a>
                <a href="#" style={{ color: "#ff0000" }}>Redes</a>
                </div>
                <div>{status}</div>
            </footer>
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

      <AppContainer style={{ padding: 0 }}>
        <div style={{ height: "100vh", overflow: "hidden", position: "relative" }}>
          <header
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              zIndex: 80,
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
                const active = activeNav === item.key;
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

            <div style={{ position: "relative", minWidth: 220 }}>
              <FaSearch style={{ position: "absolute", left: 10, top: 10, color: "#ff0000" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                style={{ width: "100%", background: "rgba(10,10,10,0.85)", border: "1px solid #ff000055", color: "#fff", borderRadius: 8, padding: "8px 10px 8px 30px", outline: "none" }}
              />
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
                top: 70,
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
              <button type="button" style={baseButtonStyle} onClick={handleClearCache}>
                Limpar cache
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleSetNewM3uUrl}>
                Informar nova URL M3U
              </button>
              <button type="button" style={baseButtonStyle} onClick={handleConfigureTmdbKey}>
                Configurar chave TMDB
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
            style={{ height: "100%", overflowY: "auto", paddingTop: 76, paddingBottom: 28 }}
          >
            {renderContent()}
          </div>
        </div>

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
