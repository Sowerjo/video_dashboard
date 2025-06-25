@echo off
SETLOCAL EnableDelayedExpansion

title GIT MANAGER - by JOGUS
color 0A

:: ===================== MENU =======================
:MENU
cls
echo.
echo ================================================
echo        🚀 GESTOR DE PROJETOS GIT - JOGUS
echo ================================================
echo.
echo [1] Criar novo projeto Git com GitHub e LFS
echo [2] Atualizar projeto local + enviar para GitHub
echo [0] Sair
echo.
set /p op="Escolha uma opcao: "

if "%op%"=="1" goto NOVO_PROJETO
if "%op%"=="2" goto ATUALIZAR_PROJETO
if "%op%"=="0" exit
goto MENU

:: ===================== NOVO PROJETO =======================
:NOVO_PROJETO
cls
echo.
echo 🆕 CRIAR NOVO PROJETO
echo.

:: Nome do projeto
set /p nome="Nome do projeto (sem espacos): "
mkdir "%nome%"
cd "%nome%"

:: Inicializar Git
git init

:: Criar branch main
git checkout -b main

:: Criar arquivos base
echo # %nome%> README.md

:: GitHub remote
set /p url="URL do repositório GitHub (ex: https://github.com/usuario/repositorio.git): "
git remote add origin %url%

:: Ativar Git LFS
git lfs install
git lfs track "*.exe"
git add .gitattributes

:: Adicionar arquivos e commit
git add .
set /p msg="Mensagem do primeiro commit: "
if "%msg%"=="" set msg=Primeiro commit
git commit -m "%msg%"

:: Push inicial
git push -u origin main

echo.
echo ✅ Projeto criado e enviado com sucesso!
pause
goto MENU

:: ===================== ATUALIZAR PROJETO =======================
:ATUALIZAR_PROJETO
cls
echo.
echo 🔄 ATUALIZAR PROJETO GIT EXISTENTE
echo.

:: Verificar se está em um repositório Git
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo ❌ Este diretório não é um repositório Git válido.
    pause
    goto MENU
)

:: Verificar remote origin
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    set /p url="Repositorio remoto nao configurado. Digite a URL do GitHub: "
    git remote add origin %url%
)

:: Git LFS
git lfs install
git lfs track "*.exe"
git add .gitattributes

:: Puxar atualizações do GitHub (antes de commitar)
echo 🔽 Fazendo pull do repositório remoto...
git pull origin main

:: Adicionar alterações locais
echo 📝 Adicionando arquivos modificados...
git add -A

:: Commit
set /p msg="Mensagem do commit: "
if "%msg%"=="" set msg=Atualização
git commit -m "%msg%"

:: Push para GitHub
echo ⬆️ Enviando alterações para o repositório remoto...
git push origin main

echo.
echo ✅ Projeto atualizado com sucesso!
pause
goto MENU
