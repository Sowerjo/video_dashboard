# Mind Flix

Aplicativo desktop em Electron + React com dois modos de operação:
- Modo Offline para biblioteca local de vídeos.
- Modo IPTV para reprodução de listas M3U, com organização por TV ao vivo, filmes e séries.

## 1. Requisitos de Execução

### 1.1 Ambiente base
- Node.js LTS (recomendado: 18+).
- npm (instalado junto com Node.js).
- Sistema operacional: Windows (principal alvo de build e instalador).

### 1.2 Dependências da aplicação
- Runtime:
  - `electron-store`
  - `react`
  - `react-dom`
  - `react-icons`
  - `react-player`
  - `styled-components`
- Build:
  - `electron`
  - `webpack` + `webpack-cli`
  - `babel-loader` + presets Babel
  - `electron-builder`
  - `sharp` + `png-to-ico` (pipeline de ícones)

### 1.3 Dependências externas e recursos obrigatórios
- FFmpeg local em `bin/`:
  - `ffmpeg.exe`
  - `ffprobe.exe`
  - `ffplay.exe`
- Ícone principal em `icon.ico` para o executável.
- Arquivos de UI em `public/` (como `index.html`, `topo.png`, `background.png`).

### 1.4 Variáveis de ambiente e integrações
- `TMDB_API_KEY` (opcional, mas necessária para sinopses de filmes/séries no modo IPTV).
- A chave TMDB é buscada na seguinte ordem:
  1. `process.env.TMDB_API_KEY`
  2. valor salvo em `electron-store` (`tmdb_api_key`)
  3. variáveis de ambiente do Windows (User e Machine)
- Também é possível configurar a chave TMDB direto pela interface do IPTV (menu do usuário), sem depender de variável de ambiente no sistema.

### 1.5 Permissões e conectividade
- Acesso de leitura às pastas de mídia escolhidas no modo offline.
- Acesso HTTP/HTTPS para:
  - download de playlist M3U
  - logos remotos
  - consulta de metadados no TMDB

## 2. Requisitos de Compilação

### 2.1 Instalação e execução local
```bash
npm install
npm run build
npm run electron
```

Fluxo de desenvolvimento recomendado:
```bash
npm run start
npm run electron
```

### 2.2 Scripts disponíveis
- `npm run start`: compila o renderer em modo watch.
- `npm run build` / `npm run build-renderer`: gera `public/bundle.js`.
- `npm run electron`: inicia a aplicação desktop.
- `npm run build-ico`: gera `icon.ico`, `assets/icon.ico`, `assets/installer.ico` e `assets/uninstaller.ico`.
- `npm run dist`: build do renderer + empacotamento com electron-builder.

### 2.3 Empacotamento do instalador
```bash
npm run build-ico
npm run dist
```

Características atuais do build:
- Target Windows NSIS.
- Saída em `dist/`.
- Binários de `bin/` incluídos via `extraFiles`.
- `asar: false` para facilitar acesso a binários externos.
- Ícones NSIS definidos em `assets/installer.ico` e `assets/uninstaller.ico`.

Observação operacional:
- Em ambientes com restrição de assinatura no Windows, pode ser necessário gerar com:
```bash
npx electron-builder --win --config.win.signAndEditExecutable=false
```

### 2.4 Estrutura de compilação
- `webpack.config.js` empacota `src/index.jsx` para `public/bundle.js`.
- `target: "electron-renderer"` para compatibilidade com renderer Electron.
- `main.js` é o entrypoint do processo principal (`"main": "main.js"`).

## 3. Funcionalidades Implementadas

### 3.1 Menu inicial
- Seleção entre Modo Offline e Modo IPTV em `src/App.jsx`.

### 3.2 Modo Offline
- Cadastro de pastas locais de vídeo.
- Varredura recursiva de subpastas.
- Geração automática de thumbnails via FFmpeg.
- Marcação de vídeos assistidos.
- Retomada de reprodução por posição salva.
- Importação/exportação de playlists em JSON.
- Reordenação manual de:
  - playlists
  - subpastas
  - vídeos
- Reset de ordenação para padrão do sistema de arquivos.
- Barra de progresso visual durante geração de thumbs.

### 3.3 Modo IPTV
- Login por URL M3U.
- Carregamento de canais com filtros por tipo:
  - live
  - movie
  - series
  - other
- Busca textual e agrupamento por categoria.
- Navegação dedicada de séries:
  - categorias
  - lista de séries
  - temporadas
  - episódios
- Reprodução com avanço automático para próximo episódio.
- Favoritos, curtidos e recentes persistidos localmente (`localStorage`).
- Sinopse, ano, nota e poster para filmes/séries via TMDB (com cache).
- Cache local de logos remotos para reduzir dependência de rede.
- Fluxos de manutenção:
  - limpar cache IPTV
  - trocar URL da playlist
  - configurar chave TMDB
  - excluir playlist local em cache
  - limpar todos os dados do app

### 3.4 Persistência de dados
- `electron-store` para:
  - `folders`
  - `watchedVideos`
  - `positions`
  - `videoAnnotations`
- `user-meta.json` em `app.getPath("userData")` para metadados complementares.
- Cache de projeto em `cache/`:
  - `cache/playlist/playlist.m3u`
  - `cache/logos/`
  - `cache/synopsis/synopses.json`
  - `cache/synopsis/posters/`
  - `cache/thumbs/`
  - `cache/chromium/`

## 4. Particularidades de Funcionamento

### 4.1 Arquitetura Electron
- Processo principal (`main.js`):
  - cria janela principal
  - registra handlers IPC
  - executa integração com sistema de arquivos e FFmpeg
- Renderer (`src/*`):
  - componentes React para UI
  - chamadas `ipcRenderer.invoke(...)` para operações nativas

### 4.2 IPCs principais
- Offline:
  - `load-config`, `save-config`
  - `load-folders`, `save-folders`
  - `load-watched`, `save-watched`
  - `load-positions`, `save-position`, `clear-positions`
  - `generate-thumbnails`
- IPTV:
  - `iptv-validate-login`
  - `iptv-load-channels`
  - `iptv-get-synopsis`
  - `iptv-get-tmdb-key-status`
  - `iptv-set-tmdb-key`
  - `iptv-cache-logo`
  - `iptv-has-local-playlist`
  - `iptv-delete-local-playlist`
  - `iptv-clear-cache`
  - `iptv-clear-all`
  - `iptv-exit-app`

### 4.3 Estratégia de cache e resiliência
- Playlist IPTV:
  - cache em memória com TTL de 2 minutos.
  - cache em disco (`cache/playlist/playlist.m3u`) com fallback quando o download falha.
- Sinopses:
  - cache em memória + cache em disco (`synopses.json`).
  - tentativa de busca TMDB em `pt-BR` com fallback para `en-US`.
- Logos e posters:
  - download e cache local com nome baseado em hash SHA-1.

### 4.4 Organização de conteúdo IPTV
- Parser M3U classifica canais por tipo (live/movie/series/other).
- Séries são derivadas do nome do item e agrupadas por temporada/episódio.
- Categorias adultas recebem bloqueio de confirmação antes da navegação.

### 4.5 Particularidades de segurança
- `nodeIntegration: true` e `contextIsolation: false`.
- O projeto foi estruturado para uso desktop local; evitar carregamento de páginas remotas arbitrárias.

## 5. Estrutura Hierárquica do Projeto

```text
video_dashboard/
├─ main.js
├─ package.json
├─ webpack.config.js
├─ scripts/
│  └─ build-ico.js
├─ src/
│  ├─ index.jsx
│  ├─ App.jsx
│  ├─ OfflineModule.jsx
│  ├─ IptvModule.jsx
│  ├─ Dashboard.jsx
│  ├─ FolderTile.jsx
│  ├─ VideoPlayer.jsx
│  └─ styles.js
├─ public/
│  ├─ index.html
│  ├─ bundle.js
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
└─ dist/
```

## 6. Observações Operacionais
- Extensões de vídeo suportadas: `.mp4`, `.avi`, `.mkv`, `.mov`, `.webm`, `.wmv`, `.flv`.
- Limpar cache IPTV remove dados temporários em `cache/` e recompõe diretórios necessários.
- Limpar todos os dados remove também persistências de usuário (`electron-store`, `user-meta.json` e legado `config.json`).

## Licença
MIT
