@echo off
REM ============================================================
REM  SOS - Conectate - Pide Ayuda
REM  Doble clic aqui. Prepara el equipo y abre el panel de mando.
REM ============================================================
title SOS - Panel de mando

REM --- Administrador: hace falta para los puertos 80, 443, 53 y 67 ---
net session >nul 2>&1
if %errorLevel% neq 0 (
  echo Pidiendo permisos de Administrador...
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

REM --- Node: primero el empaquetado, si no el del sistema ---
set "NODE="
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
if not defined NODE (
  where node >nul 2>&1
  if %errorLevel% equ 0 set "NODE=node"
)
if not defined NODE (
  echo.
  echo  ERROR: no hay Node.js.
  echo  En la version instalada deberia existir runtime\node.exe
  echo  Si trabajas sobre el codigo fuente, instala Node 22 o superior
  echo  desde https://nodejs.org
  echo.
  pause
  exit /b 1
)

REM --- Dependencias: en el distribuible ya vienen; esto es para el codigo fuente ---
if not exist "node_modules\express" (
  where npm >nul 2>&1
  if %errorLevel% equ 0 (
    echo.
    echo  Faltan las dependencias. Instalando ^(necesita internet una vez^)...
    echo.
    call npm install --no-audit --no-fund
  ) else (
    echo.
    echo  ERROR: faltan las dependencias y no hay npm para instalarlas.
    echo.
    pause
    exit /b 1
  )
)

REM --- Liberar el puerto 53 si lo tiene el cliente DNS de Windows ---
net stop dnscache >nul 2>&1

REM --- Reglas de firewall ---
REM Se borran antes de anadirlas: "add rule" NO reemplaza, apila. Este .bat se
REM ejecuta en cada arranque, asi que sin el delete el firewall acumulaba una
REM regla repetida por sesion. El delete falla la primera vez y da igual.
netsh advfirewall firewall delete rule name="SOS Portal HTTP" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal HTTPS" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal DNS" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal DHCP" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal HTTP alto" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal HTTPS alto" >nul 2>&1
netsh advfirewall firewall delete rule name="SOS Portal DNS alto" >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal HTTP" dir=in action=allow protocol=TCP localport=80 >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal HTTPS" dir=in action=allow protocol=TCP localport=443 >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal DNS" dir=in action=allow protocol=UDP localport=53 >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal DHCP" dir=in action=allow protocol=UDP localport=67 >nul 2>&1
REM Puertos altos: "iniciar en puertos altos" no sirve de nada si el firewall
REM los bloquea. El celular se conecta, recibe direccion, y el portal no carga.
netsh advfirewall firewall add rule name="SOS Portal HTTP alto" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal HTTPS alto" dir=in action=allow protocol=TCP localport=8443 >nul 2>&1
netsh advfirewall firewall add rule name="SOS Portal DNS alto" dir=in action=allow protocol=UDP localport=5354 >nul 2>&1

REM --- Panel grafico ---
if exist "PanelSOS.exe" (
  start "" "PanelSOS.exe"
  exit /b
)
if exist "panel\publicado\PanelSOS.exe" (
  start "" "panel\publicado\PanelSOS.exe"
  exit /b
)

REM --- Respaldo: si el panel no esta, el menu de texto ---
echo.
echo  El panel grafico no esta compilado. Abriendo el menu de texto.
echo  Para generarlo:  .\empaquetar\construir.ps1
echo.
"%NODE%" tools\consola.js

echo.
pause
