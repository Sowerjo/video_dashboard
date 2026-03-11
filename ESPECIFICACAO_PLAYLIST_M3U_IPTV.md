# Especificação de Playlist M3U para o Modo IPTV

## 1. Objetivo
Definir como a playlist M3U deve ser estruturada para que o aplicativo classifique corretamente os conteúdos em:
- TV ao Vivo
- Filmes
- Séries

## 2. Formato mínimo por item
Cada item deve ter:
- uma linha `#EXTINF` com metadados
- a URL do stream na linha seguinte

Exemplo:

```m3u
#EXTINF:-1 tvg-id="canal.exemplo" tvg-name="Canal Exemplo" tvg-logo="https://cdn.exemplo/logo.png" group-title="♦️Canais | Notícias",Canal Exemplo HD
http://servidor.exemplo/live/usuario/senha/12345.m3u8
```

## 3. Atributos suportados no EXTINF
- `tvg-id`
- `tvg-name`
- `tvg-logo`
- `group-title`

Se `group-title` não existir, o sistema usa `Sem grupo`.

## 4. Regra oficial de classificação (prioridade 1)
O classificador tenta primeiro um padrão de grupo com separador `|`.

Padrões aceitos:
- `Canais | ...` => TV ao Vivo (`kind = live`)
- `Filmes | ...` => Filmes (`kind = movie`)
- `Séries | ...` ou `Series | ...` => Séries (`kind = series`)

Observações:
- O parser remove o prefixo e mantém só a subcategoria após `|`.
- Exemplo: `♦️Canais | Esportes` vira grupo final `Esportes`.

## 5. Regra de fallback (prioridade 2)
Se não casar com os padrões da seção 4, o sistema detecta por URL e palavras-chave:

### 5.1 Por URL
- contém `/series/` => `series`
- contém `/movie/` => `movie`
- contém `/live/` ou termina com `.m3u8` / `.ts` => `live`

### 5.2 Por palavras no `group-title`
- Séries: `séries`, `series`, `serie`, `novelas`, `novela`, `season`, `temporada`, `anime`, `desenho`
- Filmes: `filmes`, `filme`, `movies`, `movie`, `vod`, `cinema`, `4k`, `fhd`
- TV ao Vivo: `canais`

Se nada casar, classifica como `other`.

## 6. Normalização do nome de categoria na interface
Antes de exibir, a UI normaliza o nome do grupo:
- remove símbolos no início
- compacta espaços duplicados
- separa por `|`
- exibe em maiúsculo
- mantém até 2 níveis visuais (`GRUPO | SUBGRUPO`)

Exemplos:
- `♦️Canais | esportes` => `CANAIS | ESPORTES`
- `filmes ação` => `FILMES AÇÃO`
- vazio => `SEM GRUPO`

## 7. Padrão recomendado para provedores (obrigatório para melhor resultado)
Use sempre:

```m3u
group-title="<TIPO> | <CATEGORIA>"
```

Onde `<TIPO>` deve ser um destes:
- `Canais`
- `Filmes`
- `Séries`

Exemplos recomendados:
- `group-title="♦️Canais | Notícias"`
- `group-title="♠️Filmes | Ação"`
- `group-title="♣️Séries | Drama"`

## 8. Convenções de nomenclatura para episódios de série
Para melhor agrupamento de temporadas/episódios no app, use no nome:
- `Nome da Série S01 E01`
- `Nome da Série S01E01`
- `Nome da Série 1x01`

Se não casar com padrão de episódio, o app assume Temporada 1 Episódio 1.

## 9. Regras de qualidade da playlist
- Evitar grupos genéricos como `VOD` para todo conteúdo misturado.
- Evitar misturar tipos diferentes no mesmo `group-title`.
- Garantir URLs válidas e acessíveis por HTTP/HTTPS.
- Preferir `tvg-logo` com URL estável.

## 10. Exemplo completo recomendado

```m3u
#EXTM3U

#EXTINF:-1 tvg-id="sportv.br" tvg-name="SporTV" tvg-logo="https://cdn.exemplo/sportv.png" group-title="♦️Canais | Esportes",SporTV HD
http://servidor.exemplo/live/user/pass/1001.m3u8

#EXTINF:-1 tvg-id="matrix.1999" tvg-name="Matrix" tvg-logo="https://cdn.exemplo/matrix.jpg" group-title="♠️Filmes | Ficção",Matrix (1999)
http://servidor.exemplo/movie/user/pass/2001.mp4

#EXTINF:-1 tvg-id="dark.s01e01" tvg-name="Dark S01E01" tvg-logo="https://cdn.exemplo/dark.jpg" group-title="♣️Séries | Ficção",Dark S01E01
http://servidor.exemplo/series/user/pass/3001.mkv
```
