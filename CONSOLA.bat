@echo off
REM ============================================================
REM  Menu de texto. Es el respaldo del panel grafico: sirve por
REM  escritorio remoto lento o si el panel falla.
REM ============================================================
title SOS - Consola de texto

net session >nul 2>&1
if %errorLevel% neq 0 (
  powershell -NoProfile -Command "Start-Process '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"

set "NODE="
if exist "runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
if not defined NODE (
  where node >nul 2>&1
  if %errorLevel% equ 0 set "NODE=node"
)
if not defined NODE (
  echo.
  echo  ERROR: no hay Node.js ni en runtime\ ni en el sistema.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  where npm >nul 2>&1
  if %errorLevel% equ 0 call npm install --no-audit --no-fund
)

net stop dnscache >nul 2>&1

"%NODE%" tools\consola.js

echo.
pause
