@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

echo [1/5] Gerando arquivos de icone...
call npm run build-ico
if errorlevel 1 goto :error

echo [2/5] Gerando app empacotado (win-unpacked)...
call npx electron-builder --win dir --config.win.signAndEditExecutable=false
if errorlevel 1 goto :error

set "RCEDIT="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $base=Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'; $r=Get-ChildItem -Path $base -Directory -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'rcedit-x64.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1; if(-not $r){ exit 1 }; Write-Output $r"`) do set "RCEDIT=%%I"
if not defined RCEDIT (
  echo Nao foi possivel localizar rcedit-x64.exe no cache do electron-builder.
  goto :error
)

echo [3/5] Aplicando icon.ico no executavel...
set "TMPDIR=%LOCALAPPDATA%\Temp\appiptv-icon"
if not exist "%TMPDIR%" mkdir "%TMPDIR%"
copy /Y "dist\win-unpacked\Mind Flix.exe" "%TMPDIR%\MindFlix.exe" >nul
if errorlevel 1 goto :error
copy /Y "icon.ico" "%TMPDIR%\icon.ico" >nul
if errorlevel 1 goto :error

"%RCEDIT%" "%TMPDIR%\MindFlix.exe" --set-icon "%TMPDIR%\icon.ico"
if errorlevel 1 goto :error
copy /Y "%TMPDIR%\MindFlix.exe" "dist\win-unpacked\Mind Flix.exe" >nul
if errorlevel 1 goto :error

echo [4/5] Gerando instalador NSIS...
if not exist "dist" mkdir "dist"
type nul > "dist\__uninstaller-nsis-video-dashboard-app.exe"
call npx electron-builder --win nsis --prepackaged dist/win-unpacked --config.win.signAndEditExecutable=false
if errorlevel 1 goto :error
if exist "dist\__uninstaller-nsis-video-dashboard-app.exe" del /f /q "dist\__uninstaller-nsis-video-dashboard-app.exe" >nul 2>nul

echo [5/5] Concluido.
echo Instalador: dist\Mind Flix Setup 1.0.0.exe
start "" "dist"
exit /b 0

:error
if exist "dist\__uninstaller-nsis-video-dashboard-app.exe" del /f /q "dist\__uninstaller-nsis-video-dashboard-app.exe" >nul 2>nul
echo Falha ao gerar instalador.
exit /b 1
