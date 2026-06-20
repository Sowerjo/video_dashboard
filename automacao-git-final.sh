#!/usr/bin/env bash

set -u

APP_TITLE="GIT MANAGER - by JOGUS"

pause_screen() {
  printf "\nPressione Enter para continuar..."
  read -r _ || true
}

set_title() {
  printf '\033]0;%s\007' "$APP_TITLE"
}

clear_screen() {
  clear
}

show_menu() {
  clear_screen
  printf '\n'
  printf '================================================\n'
  printf '       GESTOR DE PROJETOS GIT\n'
  printf '================================================\n\n'
  printf '[1] Iniciar repositorio COM Git LFS (na pasta atual + GitHub)\n'
  printf '[2] Iniciar repositorio SEM Git LFS (na pasta atual + GitHub)\n'
  printf '[3] Atualizar repositorio atual (pull + commit + push)\n'
  printf '[4] Configurar autenticacao do GitHub CLI (gh auth login)\n'
  printf '[5] Fazer logout do GitHub CLI e limpar credenciais Git\n'
  printf '[6] Configurar ou editar nome/email do Git (git config)\n'
  printf '[7] Ver Repositorio de trabalho Atual\n'
  printf '[0] Sair\n\n'
  printf 'O SEU REPOSITORIO DE TRABALHO DESTA PASTA E:\n'
  git remote -v 2>/dev/null || true
  printf '\n'
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

run_as_root() {
  if command_exists sudo; then
    sudo "$@"
  else
    "$@"
  fi
}

install_with_pkg_manager() {
  local pkg="$1"

  if command_exists apt-get; then
    run_as_root apt-get update
    run_as_root apt-get install -y "$pkg"
    return $?
  fi

  if command_exists dnf; then
    run_as_root dnf install -y "$pkg"
    return $?
  fi

  if command_exists yum; then
    run_as_root yum install -y "$pkg"
    return $?
  fi

  if command_exists pacman; then
    run_as_root pacman -Sy --noconfirm "$pkg"
    return $?
  fi

  if command_exists zypper; then
    run_as_root zypper --non-interactive install "$pkg"
    return $?
  fi

  if command_exists brew; then
    brew install "$pkg"
    return $?
  fi

  return 1
}

ensure_gh() {
  if command_exists gh; then
    return 0
  fi

  printf 'GitHub CLI nao encontrada.\n'
  printf 'Tentando instalar automaticamente...\n'

  if install_with_pkg_manager gh || install_with_pkg_manager github-cli; then
    if command_exists gh; then
      return 0
    fi
  fi

  printf 'Falha ao instalar GitHub CLI.\n'
  printf 'Instale manualmente e execute novamente.\n'
  return 1
}

ensure_lfs() {
  if git lfs version >/dev/null 2>&1; then
    return 0
  fi

  printf 'Git LFS nao encontrado.\n'
  printf 'Tentando instalar automaticamente...\n'

  if install_with_pkg_manager git-lfs; then
    if git lfs version >/dev/null 2>&1; then
      return 0
    fi
  fi

  printf 'Falha ao instalar Git LFS.\n'
  printf 'Instale manualmente e execute novamente.\n'
  return 1
}

ensure_gh_login() {
  if ! gh auth status >/dev/null 2>&1; then
    printf 'Ainda nao autenticado. Iniciando login...\n'
    gh auth login --web --git-protocol https
  else
    printf 'Ja autenticado com o GitHub.\n'
  fi
}

ensure_git_repo() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1
}

ensure_main_branch() {
  if git show-ref --verify --quiet refs/heads/main; then
    git checkout main >/dev/null 2>&1 || git switch main
  else
    git checkout -B main >/dev/null 2>&1 || git switch -c main
  fi
}

create_readme_if_missing() {
  if [ ! -f README.md ]; then
    printf '# Novo Projeto\n' > README.md
  fi
}

create_remote_repo() {
  local repo="$1"
  gh repo create "$repo" --public --source=. --remote=origin
}

commit_and_push() {
  local msg="$1"

  if git diff --cached --quiet; then
    printf 'Nada para commitar.\n'
  else
    git commit -m "$msg"
  fi

  git push -u origin main
}

configurar_gh() {
  clear_screen
  printf 'Autenticando com GitHub CLI...\n'
  if ! ensure_gh; then
    pause_screen
    return
  fi

  ensure_gh_login
  gh auth status
  pause_screen
}

logout_gh() {
  clear_screen
  printf 'Fazendo logout e limpando credenciais...\n'
  if ! ensure_gh; then
    pause_screen
    return
  fi

  gh auth logout --hostname github.com || true
  printf 'protocol=https\nhost=github.com\n\n' | git credential reject >/dev/null 2>&1 || true
  git credential-cache exit >/dev/null 2>&1 || true

  printf 'Logout completo.\n'
  pause_screen
}

config_git_id() {
  clear_screen
  printf 'CONFIGURAR OU EDITAR NOME E EMAIL PARA COMMITS (git config)\n\n'

  local gitname gitemail novonome novoemail

  gitname="$(git config --global user.name 2>/dev/null || true)"
  printf 'Nome atual: %s\n' "${gitname:-}"
  printf 'Digite um novo nome ou pressione Enter para manter: '
  read -r novonome || novonome=""
  if [ -n "${novonome:-}" ]; then
    git config --global user.name "$novonome"
    printf 'Nome atualizado para: %s\n' "$novonome"
  else
    printf 'Nome mantido: %s\n' "${gitname:-}"
  fi

  gitemail="$(git config --global user.email 2>/dev/null || true)"
  printf 'Email atual: %s\n' "${gitemail:-}"
  printf 'Digite um novo email ou pressione Enter para manter: '
  read -r novoemail || novoemail=""
  if [ -n "${novoemail:-}" ]; then
    git config --global user.email "$novoemail"
    printf 'Email atualizado para: %s\n' "$novoemail"
  else
    printf 'Email mantido: %s\n' "${gitemail:-}"
  fi

  printf '\nConfiguracao final:\n'
  git config --global user.name || true
  git config --global user.email || true
  pause_screen
}

iniciar_com_lfs() {
  clear_screen
  printf 'Iniciando repositorio COM Git LFS...\n'

  if ! ensure_gh || ! ensure_lfs; then
    pause_screen
    return
  fi

  ensure_gh_login

  if ! ensure_git_repo; then
    git init
    ensure_main_branch
  fi

  create_readme_if_missing

  printf 'Nome do repositorio no GitHub: '
  local repo msg
  read -r repo || repo=""
  if [ -z "${repo:-}" ]; then
    printf 'Nome do repositorio e obrigatorio.\n'
    pause_screen
    return
  fi

  if ! create_remote_repo "$repo"; then
    printf 'Falha ao criar repositorio.\n'
    pause_screen
    return
  fi

  git lfs install
  git lfs track "*.exe"
  git add .gitattributes

  git add .
  printf 'Mensagem do commit inicial: '
  read -r msg || msg=""
  if [ -z "${msg:-}" ]; then
    msg="Primeiro commit"
  fi

  commit_and_push "$msg"
  printf 'Repositorio criado e enviado com LFS.\n'
  pause_screen
}

iniciar_sem_lfs() {
  clear_screen
  printf 'Iniciando repositorio SEM Git LFS...\n'

  if ! ensure_gh; then
    pause_screen
    return
  fi

  ensure_gh_login

  if ! ensure_git_repo; then
    git init
    ensure_main_branch
  fi

  create_readme_if_missing

  printf 'Nome do repositorio no GitHub: '
  local repo msg
  read -r repo || repo=""
  if [ -z "${repo:-}" ]; then
    printf 'Nome do repositorio e obrigatorio.\n'
    pause_screen
    return
  fi

  if ! create_remote_repo "$repo"; then
    printf 'Falha ao criar repositorio.\n'
    pause_screen
    return
  fi

  git add .
  printf 'Mensagem do commit inicial: '
  read -r msg || msg=""
  if [ -z "${msg:-}" ]; then
    msg="Primeiro commit"
  fi

  commit_and_push "$msg"
  printf 'Repositorio criado e enviado com sucesso.\n'
  pause_screen
}

atualizar_projeto() {
  clear_screen
  printf 'Atualizando repositorio local...\n'

  if ! ensure_git_repo; then
    printf 'Este diretorio nao e um repositorio Git valido.\n'
    pause_screen
    return
  fi

  if ! git remote get-url origin >/dev/null 2>&1; then
    local url
    printf 'Digite a URL do repositorio remoto: '
    read -r url || url=""
    if [ -n "${url:-}" ]; then
      git remote add origin "$url"
    fi
  fi

  git pull origin main

  git add -A
  local msg
  printf 'Mensagem do commit: '
  read -r msg || msg=""
  if [ -z "${msg:-}" ]; then
    msg="Atualizacao"
  fi

  if git diff --cached --quiet; then
    printf 'Nada para commitar.\n'
  else
    git commit -m "$msg"
  fi

  git push origin main

  printf 'Repositorio atualizado com sucesso!\n'
  pause_screen
}

repo_list() {
  clear_screen
  printf 'O SEU REPOSITORIO DE TRABALHO ATUAL E:\n'
  git remote -v || true
  pause_screen
}

main_loop() {
  while true; do
    show_menu
    printf 'Escolha uma opcao: '
    local op
    read -r op || op=""

    case "$op" in
      1) iniciar_com_lfs ;;
      2) iniciar_sem_lfs ;;
      3) atualizar_projeto ;;
      4) configurar_gh ;;
      5) logout_gh ;;
      6) config_git_id ;;
      7) repo_list ;;
      0) exit 0 ;;
      *) printf '\nOpcao invalida.\n'; pause_screen ;;
    esac
  done
}

set_title
main_loop
