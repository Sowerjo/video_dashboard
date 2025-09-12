# Video Dashboard Futurista

Aplicativo desktop (Electron + React) para organizar e assistir vídeos em pastas, com visual futurista (efeito glass), geração automática de thumbnails via FFmpeg e retomada de reprodução.

## Visão geral
- Baseado em Electron (main process) e React (renderer) com styled-components.
- Lê pastas do usuário, organiza por playlists (com subpastas) e extrai thumbs automaticamente.
- Armazena o progresso de reprodução (posição do vídeo) e itens “assistidos”.
- Interface com fundo desfocado, vinheta e logo fixo no topo.

## Principais recursos
- Adicionar pastas de vídeos (com suporte a subpastas).
- Thumbnails automáticos via FFmpeg (primeiro frame em 1s).
- Marcação de vídeos assistidos e “limpar checks” por playlist.
- Retomada automática do ponto onde você parou (persistência por vídeo).
- Importar/Exportar playlists (JSON).
- Visual com topo fixo, cartões em vidro, vinheta e background com blur.

## Estrutura do projeto
- <mcfile name="main.js" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\main.js"></mcfile> — Processo principal do Electron, cria a janela e expõe handlers de IPC (FFmpeg, persistência, diálogos etc.).
- <mcfile name="webpack.config.js" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\webpack.config.js"></mcfile> — Empacota o renderer (React) em public/bundle.js.
- <mcfile name="public/index.html" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\public\index.html"></mcfile> — HTML base carregado pelo Electron.
- <mcfile name="src/index.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\index.jsx"></mcfile> — Ponto de entrada do React.
- <mcfile name="src/App.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\App.jsx"></mcfile> — Orquestra estado global, camadas de fundo, top bar e integra com Electron.
- <mcfile name="src/Dashboard.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\Dashboard.jsx"></mcfile> — Lista playlists, subpastas e vídeos, modais e full-screen player.
- <mcfile name="src/FolderTile.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\FolderTile.jsx"></mcfile> — Card de uma playlist.
- <mcfile name="src/styles.js" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\styles.js"></mcfile> — styled-components (BackgroundLayer, VignetteOverlay, LogoOverlay, TopBar, Tiles etc.).
- bin/ — FFmpeg empacotado (ffmpeg/ffplay/ffprobe). 
- public/ — Bundle, HTML e ativos estáticos (topo.png, background.png).

## Requisitos
- Node.js LTS (18+ recomendado).
- Windows (binaries do FFmpeg já incluídos). Para macOS/Linux, inclua binários compatíveis em bin/ (o main resolve o caminho automaticamente: ffmpeg.exe no Windows, ffmpeg no Unix).

## Instalação e execução
1) Instalar dependências:
```
npm install
```
2) Gerar o bundle do renderer:
```
npm run build
```
3) Executar o app Electron:
```
npm run electron
```
Dica (dev): use dois terminais — um com `npm start` (webpack --watch) e outro com `npm run electron` para recarregar mais rápido.

## Empacotamento (instalador)
```
npm run dist
```
- Saída em dist/ (alvo Windows NSIS).
- O build inclui `bin/` e `thumbs/` via `extraResources` do electron-builder.
- Atenção: o `build.win.icon` no package.json aponta para `assets/icon.ico`. Certifique-se de colocar esse arquivo (há um `assets/icon.png`; troque para `.ico` ou ajuste o caminho no package.json).

## Como funciona (arquitetura)
- Electron Main
  - Carrega `public/index.html` e injeta o bundle do React.
  - Define handlers de IPC:
    - `load-config`: lê `config.json` em `app.getPath('userData')` (fallback vazio).
    - `get-thumbs-path`: expõe o caminho da pasta `thumbs` do usuário.
    - `select-folder`: abre diálogo para escolher uma pasta.
    - `load-folders`/`save-folders`: playlists via electron-store.
    - `load-watched`/`save-watched`: vídeos assistidos via electron-store.
    - `load-positions`/`save-position`/`clear-positions`: progresso dos vídeos via electron-store.
    - `generate-thumbnails`: percorre arquivos de cada pasta; para vídeos, chama FFmpeg para exportar 1 frame (1s) em `thumbs/<nome>.jpg`.
- Renderer (React)
  - `scanFolder(folderPath, thumbsDir)`: varre pastas recursivamente, filtra vídeos pelas extensões suportadas e associa thumbs existentes.
  - Fluxo de inicialização do <mcfile name="src/App.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\App.jsx"></mcfile>:
    1. Lê config inicial via `load-config` (folders/watchedVideos).
    2. Obtém `thumbsDir` via `get-thumbs-path`.
    3. Gera thumbs (`generate-thumbnails`) e re-escaneia as pastas para preencher `videos`/`subfolders`.
    4. Persiste `folders` e `watched` continuamente (`save-folders`/`save-watched`).
  - UI: TopBar com botões “Adicionar Pasta +”, “Atualizar”, “Importar”, “Exportar”.
  - `Dashboard`: exibe cards de playlists; ao abrir, mostra subpastas e miniaturas. Clique abre vídeo em modal full-screen.
  - Full-screen `<video>` salva a posição em `timeupdate`, `pause` e `seeked`; ao carregar, reposiciona para a última posição.
  - Tecla ESC fecha modais (painéis, subpastas e full-screen).

## Extensões suportadas
Definidas em `VIDEO_EXTS` no App: `.mp4, .avi, .mkv, .mov, .webm, .wmv, .flv`.

## Persistência e arquivos
- electron-store
  - `folders` — array de playlists.
  - `watchedVideos` — lista de paths de vídeos marcados.
  - `positions` — mapa `path -> segundos`.
- `config.json` (em `userData/`) — lido por `load-config` no boot (quando existir).
- `thumbs/` (em `userData/`) — thumbs geradas pelo FFmpeg; nome do arquivo é derivado do nome do vídeo sanitizado.

## Estilo/tema e camadas visuais
Definidos em <mcfile name="src/styles.js" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\styles.js"></mcfile>.
- Background
  - `BackgroundLayer`: ocupa a tela (fixed), usa `topo.png` como imagem de fundo com `blur`, `brightness` e `saturate`.
  - `VignetteOverlay`: vinheta radial para reforçar contraste com as bordas.
  - `LogoOverlay`: imagem fixa e centralizada no topo (usa `topo.png`); não intercepta cliques.
- Controles/Cartões
  - `TopBar`: barra semi-transparente com blur para efeito glass.
  - `Tile` e `Modal`: semi‑transparentes com `backdrop-filter`, borda e glow vermelhos.

Para trocar imagens:
- Coloque seu logo em `public/` (ex.: `logo.png`) e altere `LogoOverlay src` em <mcfile name="src/App.jsx" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\App.jsx"></mcfile>.
- Troque o fundo alterando a URL de `BackgroundLayer` em <mcfile name="src/styles.js" path="c:\Users\JOEL-PREVENDAS\OneDrive - MOBITECH TECNOLOGIA LTDA\Área de Trabalho\Nova pasta\video_dashboard\src\styles.js"></mcfile>.

## Uso da interface
1. Adicione uma pasta (botão “Adicionar Pasta +”).
2. O app gera as miniaturas e preenche a playlist.
3. Clique em uma playlist para abrir; clique em uma miniatura para reproduzir em tela cheia.
4. “Limpar Checks” remove marcadores de assistido e posições daquela playlist.
5. Use “Importar”/“Exportar” para salvar/restaurar sua lista de playlists.

## Dicas e observações
- Se as thumbs não aparecerem, confirme que os binários do FFmpeg existem em `bin/` e são executáveis.
- No macOS/Linux, inclua os binários corretos e/ou instale FFmpeg no sistema se preferir.
- Segurança: `nodeIntegration: true` e `contextIsolation: false` são adequados para app local; evite carregar conteúdo remoto.

## Scripts disponíveis
- `npm run start` — Webpack em watch (renderer).
- `npm run build` — Gera `public/bundle.js`.
- `npm run electron` — Inicia o app.
- `npm run dist` — Gera instalador com electron-builder.

## Licença
MIT.