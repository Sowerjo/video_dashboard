# Mind Flix

Aplicativo desktop em Electron + React com dois modos de operação:
- **Modo Offline** — biblioteca local de vídeos com thumbnails automáticas.
- **Modo IPTV** — reprodução de listas M3U com organização por TV ao vivo, filmes e séries, suporte a Chromecast e reprodução automática de episódios.

---

## 1. Requisitos de Execução

### 1.1 Ambiente base
- Node.js LTS (recomendado: 18+).
- npm (instalado junto com Node.js).
- Sistema operacional: Windows (principal alvo de build e instalador).

### 1.2 Dependências da aplicação
- Runtime:
  - `electron-store` — persistência de dados
  - `react` + `react-dom` — interface
  - `react-icons` — ícones (FontAwesome, Material Design)
  - `react-player` — player de vídeo com suporte HLS/DASH
  - `styled-components` — componentes estilizados
  - `castv2-client` — protocolo Chromecast
  - `bonjour-service` — descoberta de dispositivos na rede (mDNS)
- Build:
  - `electron` + `electron-builder`
  - `webpack` + `webpack-cli` + `babel-loader`
  - `sharp` + `png-to-ico` (pipeline de ícones)

### 1.3 Dependências externas e recursos obrigatórios
- FFmpeg local em `bin/`:
  - `ffmpeg.exe`
  - `ffprobe.exe`
  - `ffplay.exe`
- Ícone principal em `icon.ico` para o executável.
- Arquivos de UI em `public/` (`index.html`, `topo.png`, `background.png`).

### 1.4 Variáveis de ambiente e integrações
- `TMDB_API_KEY` (opcional, necessária para sinopses de filmes/séries).
- A chave TMDB é buscada na seguinte ordem:
  1. `process.env.TMDB_API_KEY`
  2. valor salvo em `electron-store` (`tmdb_api_key`)
  3. variáveis de ambiente do Windows (User e Machine)
- Também é possível configurar pela interface (menu hambúrguer).

### 1.5 Permissões e conectividade
- Acesso de leitura às pastas de mídia escolhidas no modo offline.
- Acesso HTTP/HTTPS para:
  - download de playlist M3U
  - logos remotos
  - consulta de metadados no TMDB
  - comunicação com Chromecast na rede local (porta 8009)

---

## 2. Requisitos de Compilação

### 2.1 Instalação e execução local
```bash
npm install
npm run build
npm run electron
```

### 2.2 Scripts disponíveis
| Script | Descrição |
|--------|-----------|
| `npm run start` | Compila o renderer em modo watch |
| `npm run build` | Gera `public/bundle.js` |
| `npm run electron` | Inicia a aplicação desktop |
| `npm run build-ico` | Gera ícones ICO para instalador |
| `npm run dist` | Build completo + empacotamento NSIS |

### 2.3 Empacotamento do instalador
```bash
npm run build-ico
npm run dist
```

- Target: Windows NSIS
- Saída em `dist/`
- Binários de `bin/` incluídos via `extraFiles`
- Código da aplicação empacotado em `app.asar`; FFmpeg permanece externo em `bin/`

Para assinar o instalador e os executáveis, configure o certificado antes do build:
```bash
set WIN_CSC_LINK=C:\caminho\certificado.pfx
set WIN_CSC_KEY_PASSWORD=senha-do-certificado
npm run dist
```

Sem certificado o build continua funcionando, mas será distribuído sem assinatura digital e pode ter reputação inferior em antivírus e no SmartScreen.

---

## 3. Funcionalidades Implementadas

### 3.1 Menu inicial
- Dashboard com seleção entre Modo Offline e Modo IPTV.

### 3.2 Modo Offline
- Cadastro de pastas locais de vídeo
- Varredura recursiva de subpastas
- Geração automática de thumbnails via FFmpeg
- Marcação de vídeos assistidos
- Retomada de reprodução por posição salva
- Importação/exportação de playlists em JSON
- Reordenação manual de playlists, subpastas e vídeos
- Barra de progresso visual durante geração de thumbs

### 3.3 Modo IPTV

#### Navegação e Interface
- Login por URL M3U com validação
- Barra de menu nativa do sistema removida (interface limpa)
- Header com navegação por abas (Home, Live, Filmes, Séries)
- Campo de busca com normalização de acentos (ex: "acao" encontra "Ação")
- Botão Chromecast no header para conexão rápida
- Indicador global de cast no header (nome do conteúdo + botão desconectar)
- Footer fixo na parte inferior com links de Termos, Privacidade, Suporte e Redes
- Menu hambúrguer com opções de configuração
- Menu de contexto (botão direito) para adicionar conteúdo a playlists

#### Home
- Tiles de navegação rápida (TV ao Vivo, Filmes, Séries)
- Carrossel "Continuar assistindo" com último episódio
- Carrossel de Favoritos
- Carrossel "Recomendados para você" — 20 itens aleatórios entre filmes e séries com badges de tipo (Filme/Série)
- Playlists customizadas fixadas

#### TV ao Vivo
- Sidebar com categorias (ex: 43 categorias)
- Grid de canais com logos
- Feedback "Nenhum resultado" quando busca não retorna nada

#### Filmes
- Sidebar com categorias (ex: 25 categorias)
- Grid de filmes com posters
- Bloqueio de categorias adultas com confirmação
- Feedback "Nenhum resultado" para busca vazia
- Sinopse, ano, nota e poster via TMDB

#### Séries
- Sidebar com categorias (ex: 29 categorias)
- Grid de séries agrupadas por nome
- Navegação: Categorias → Lista de séries → Temporadas → Episódios
- Busca filtra por nome da série (não só episódio)
- Reprodução automática do próximo episódio
- Feedback "Nenhum resultado" para busca vazia

#### Player
- ReactPlayer com suporte HLS, DASH, MP4, MKV
- Controle de volume com persistência
- Detecção automática de formato por URL
- Fallback de fontes alternativas em caso de erro
- Overlay de buffering com informações de velocidade

#### Chromecast
- Botão de Cast no header para conexão a dispositivo
- Botão de Cast em cada player
- Descoberta automática de Chromecasts na rede via mDNS (4s scan)
- Envio de stream diretamente ao Chromecast (sem re-encoding)
- Quando Chromecast está conectado:
  - Conteúdo não reproduz localmente (muted + paused)
  - Qualquer conteúdo clicado é enviado automaticamente ao dispositivo
  - Controles remotos no player: pause/resume, seek ±10s, barra de progresso, volume
  - Próximo episódio automático quando o atual termina
  - Indicador "Transmitindo via Chromecast" no player
- Proteção contra crash por erros do `castv2-client` (uncaughtException handler)

#### Busca
- Normalização de acentos (NFD + remoção de diacríticos)
- Busca por nome do canal, grupo e nome da série (extraído via parseEpisodeInfo)
- Busca limpa automaticamente ao trocar de aba
- Feedback visual "Nenhum resultado para X" em todas as telas

#### Animações
- FadeTransition (400ms) ao trocar de aba
- Cards com stagger animation por fileira (50ms delay, fade + slide up 14px)
- Re-disparo de animações ao trocar categoria
- Carrosséis na Home com 80ms de delay entre eles

#### Favoritos e Persistência
- Favoritos, curtidos e recentes persistidos em localStorage
- Playlists customizadas (criar, adicionar itens, remover)
- Último episódio por série salvo para "Continuar assistindo"

### 3.4 Persistência de dados
- `electron-store` para: folders, watchedVideos, positions, videoAnnotations
- `user-meta.json` em `app.getPath("userData")`
- Cache em `cache/`:
  - `cache/playlist/playlist.m3u`
  - `cache/logos/`
  - `cache/synopsis/synopses.json`
  - `cache/synopsis/posters/`
  - `cache/thumbs/`
  - `cache/chromium/`

---

## 4. Arquitetura

### 4.1 Processo principal (`main.js`)
- Cria janela principal sem menu nativo (`Menu.setApplicationMenu(null)`)
- Registra IPC handlers
- Integração com sistema de arquivos e FFmpeg
- Gerenciamento de conexão Chromecast (discover, cast, pause, resume, seek, volume, stop)
- Monitor de status do Chromecast (polling a cada 2s)
- Handler de `uncaughtException` para erros do castv2-client

### 4.2 Renderer (`src/`)
- Componentes React para UI
- Chamadas `ipcRenderer.invoke(...)` para operações nativas
- Estado global de Chromecast elevado ao componente principal

### 4.3 IPCs registrados

#### Offline
- `load-config`, `save-config`
- `load-folders`, `save-folders`
- `load-watched`, `save-watched`
- `load-positions`, `save-position`, `clear-positions`
- `generate-thumbnails`

#### IPTV
- `iptv-validate-login`
- `iptv-load-channels`
- `iptv-get-synopsis`
- `iptv-get-tmdb-key-status`, `iptv-set-tmdb-key`
- `iptv-cache-logo`
- `iptv-has-local-playlist`, `iptv-delete-local-playlist`
- `iptv-clear-cache`, `iptv-clear-all`
- `iptv-toggle-fullscreen`, `iptv-get-fullscreen-state`
- `iptv-open-external-player`
- `iptv-exit-app`
- `iptv-create-custom-playlist`, `iptv-add-item-to-custom-playlist`
- `iptv-remove-custom-playlist`, `iptv-remove-item-from-custom-playlist`
- `iptv-get-custom-playlists`
- `iptv-set-last-episode`, `iptv-get-last-episodes`

#### Chromecast
- `chromecast-discover` — busca dispositivos na rede local
- `chromecast-cast` — envia URL de stream para o Chromecast
- `chromecast-stop` — para transmissão
- `chromecast-pause` — pausa reprodução remota
- `chromecast-resume` — retoma reprodução remota
- `chromecast-seek` — avança/retrocede no Chromecast
- `chromecast-volume` — controla volume remoto
- `chromecast-status-request` — consulta estado atual do player remoto
- `chromecast-status` (evento) — notifica renderer sobre mudanças de estado

### 4.4 Estratégia de cache e resiliência
- Playlist IPTV:
  - cache em memória com TTL de 2 minutos
  - cache em disco com fallback quando download falha
- Sinopses:
  - cache em memória + disco
  - busca TMDB em `pt-BR` com fallback para `en-US`
- Logos e posters:
  - download e cache local com nome baseado em hash SHA-1

### 4.5 Organização de conteúdo IPTV
- Parser M3U classifica canais por tipo (live/movie/series/other)
- Séries derivadas do nome e agrupadas por temporada/episódio
- Categorias adultas com bloqueio de confirmação

---

## 5. Estrutura do Projeto

```text
video_dashboard/
├─ main.js                    # Processo principal Electron
├─ package.json
├─ webpack.config.js
├─ icon.ico
├─ scripts/
│  └─ build-ico.js
├─ src/
│  ├─ index.jsx              # Entry point React
│  ├─ App.jsx                # Router Offline/IPTV
│  ├─ Dashboard.jsx          # Menu inicial
│  ├─ OfflineModule.jsx      # Modo offline
│  ├─ IptvModule.jsx         # Modo IPTV (principal)
│  ├─ FolderTile.jsx         # Componente tile de pasta
│  └─ styles.js              # Styled components
├─ public/
│  ├─ index.html
│  ├─ bundle.js              # Output webpack
│  ├─ topo.png
│  └─ background.png
├─ assets/
│  ├─ ico.png
│  ├─ icon.ico
│  ├─ installer.ico
│  └─ uninstaller.ico
├─ bin/
│  ├─ ffmpeg.exe
│  ├─ ffprobe.exe
│  └─ ffplay.exe
└─ dist/                     # Output electron-builder
```

---

## 6. Especificação de Playlist M3U

### 6.1 Formato mínimo por item
```m3u
#EXTINF:-1 tvg-id="canal.exemplo" tvg-name="Canal Exemplo" tvg-logo="https://cdn.exemplo/logo.png" group-title="♦️Canais | Notícias",Canal Exemplo HD
http://servidor.exemplo/live/usuario/senha/12345.m3u8
```

### 6.2 Atributos suportados
- `tvg-id`, `tvg-name`, `tvg-logo`, `group-title`

### 6.3 Classificação de conteúdo

#### Por padrão de grupo (prioridade 1)
- `Canais | ...` → TV ao Vivo (`live`)
- `Filmes | ...` → Filmes (`movie`)
- `Séries | ...` ou `Series | ...` → Séries (`series`)

#### Por URL (prioridade 2)
- `/series/` → series
- `/movie/` → movie
- `/live/` ou `.m3u8`/`.ts` → live

#### Por palavras-chave no grupo (prioridade 3)
- Séries: `séries`, `series`, `novelas`, `anime`, `desenho`
- Filmes: `filmes`, `movies`, `vod`, `cinema`, `4k`, `fhd`
- TV: `canais`

### 6.4 Nomenclatura de episódios
Para agrupamento correto de temporadas/episódios:
- `Nome S01 E01`
- `Nome S01E01`
- `Nome 1x01`

### 6.5 Exemplo completo
```m3u
#EXTM3U

#EXTINF:-1 tvg-id="sportv.br" tvg-name="SporTV" tvg-logo="https://cdn.exemplo/sportv.png" group-title="♦️Canais | Esportes",SporTV HD
http://servidor.exemplo/live/user/pass/1001.m3u8

#EXTINF:-1 tvg-id="matrix.1999" tvg-name="Matrix" tvg-logo="https://cdn.exemplo/matrix.jpg" group-title="♠️Filmes | Ficção",Matrix (1999)
http://servidor.exemplo/movie/user/pass/2001.mp4

#EXTINF:-1 tvg-id="dark.s01e01" tvg-name="Dark S01E01" tvg-logo="https://cdn.exemplo/dark.jpg" group-title="♣️Séries | Ficção",Dark S01E01
http://servidor.exemplo/series/user/pass/3001.mkv
```

---

## 7. Segurança

- `nodeIntegration: false`, `contextIsolation: true` e renderer sandboxed.
- API do renderer limitada por preload com lista permitida de canais IPC.
- Cache e dados mutáveis armazenados em `app.getPath("userData")`.
- `webSecurity` permanece desativado para compatibilidade com streams IPTV sem CORS; não carregar interfaces web remotas no renderer.
- Handler de `uncaughtException` para erros do Chromecast (evita crash).
- URLs de stream contêm credenciais — nunca expor ou compartilhar.
- Cache local de logos/posters usa hash SHA-1 (sem expor URLs originais).

---

## Licença
MIT
