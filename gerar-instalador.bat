@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

for /f "delims=" %%V in ('node -p "require('./package.json').version"') do set "APP_VERSION=%%V"

echo [1/6] Gerando arquivos de icone...
call npm run build-ico
if errorlevel 1 goto :error

echo [2/6] Compilando a interface...
call npm run build-renderer
if errorlevel 1 goto :error

echo [3/6] Gerando app empacotado...
call npx electron-builder --win dir --config.win.signAndEditExecutable=false
if errorlevel 1 goto :error

echo [4/6] Aplicando identidade visual e metadados...
call node scripts\apply-windows-metadata.mjs "dist\win-unpacked\Mind Flix.exe" "icon.ico"
if errorlevel 1 goto :error

echo [5/6] Assinando executaveis quando houver certificado...
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sign-windows.ps1" -Path "dist\win-unpacked"
if errorlevel 1 goto :error

echo [6/6] Gerando e assinando instalador NSIS...
call npx electron-builder --win nsis --prepackaged dist/win-unpacked --config.win.signAndEditExecutable=false
if errorlevel 1 goto :error
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\sign-windows.ps1" -Path "dist\Mind Flix Setup %APP_VERSION%.exe"
if errorlevel 1 goto :error

echo Concluido.
echo Instalador: dist\Mind Flix Setup %APP_VERSION%.exe
exit /b 0

:error
echo Falha ao gerar instalador.
exit /b 1
