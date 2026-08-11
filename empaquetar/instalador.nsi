; =====================================================================
;  SOS · Conectate · Pide Ayuda — instalador
;
;  Genera un unico .exe que deja el sistema listo para operar sin
;  necesidad de instalar Node, .NET ni nada mas.
;
;  Se construye desde empaquetar\construir.ps1 -Instalador
; =====================================================================

!include "MUI2.nsh"

!define NOMBRE     "SOS Conectate Pide Ayuda"
!define VERSION    "1.0.0"
!define CARPETA    "salida\SOS.Conectate.PideAyuda"

Name              "${NOMBRE}"
OutFile           "salida\SOS.Conectate.PideAyuda-Setup.exe"
Unicode           true
; Se instala fuera de Archivos de programa a proposito: el operador tiene que
; poder llegar facil a la carpeta datos\ para respaldar el censo.
InstallDir        "C:\SOS.Conectate.PideAyuda"
InstallDirRegKey  HKLM "Software\SOSConectate" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

VIProductVersion "1.0.0.0"
VIAddVersionKey  "ProductName"     "${NOMBRE}"
VIAddVersionKey  "FileDescription" "Portal cautivo de emergencia"
VIAddVersionKey  "FileVersion"     "${VERSION}"
VIAddVersionKey  "LegalCopyright"  "Copyright (C) 2026 - Licencia GPL-3.0"

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\PanelSOS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir el panel de mando"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\DESPLIEGUE.md"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Leer la guia de despliegue"

!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "Spanish"

; ---------------------------------------------------------------------
Section "Sistema completo" Principal
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${CARPETA}\*.*"

  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Panel de mando.lnk" "$INSTDIR\PanelSOS.exe"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Guia de despliegue.lnk" "$INSTDIR\DESPLIEGUE.md"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Desinstalar.lnk" "$INSTDIR\Desinstalar.exe"
  CreateShortcut "$DESKTOP\SOS Panel de mando.lnk" "$INSTDIR\PanelSOS.exe"

  WriteRegStr HKLM "Software\SOSConectate" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate" \
                   "DisplayName" "${NOMBRE}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate" \
                   "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate" \
                   "UninstallString" "$INSTDIR\Desinstalar.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate" \
                   "DisplayIcon" "$INSTDIR\PanelSOS.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate" \
                   "Publisher" "Proyecto libre - licencia GPL-3.0"

  WriteUninstaller "$INSTDIR\Desinstalar.exe"
SectionEnd

; Las reglas de firewall tambien las pone el panel al arrancar; hacerlo aqui
; ahorra que el operador tenga que acordarse en terreno.
Section "Abrir los puertos en el firewall" Firewall
  DetailPrint "Abriendo los puertos del portal..."
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal HTTP" dir=in action=allow protocol=TCP localport=80'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal HTTPS" dir=in action=allow protocol=TCP localport=443'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal DNS" dir=in action=allow protocol=UDP localport=53'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal DHCP" dir=in action=allow protocol=UDP localport=67'
SectionEnd

; ---------------------------------------------------------------------
Section "Uninstall"
  ; La carpeta datos\ NO se toca: ahi esta el censo, y borrarlo por accidente
  ; seria perder el registro de personas.
  Delete "$INSTDIR\PanelSOS.exe"
  Delete "$INSTDIR\*.bat"
  Delete "$INSTDIR\*.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\package.json"
  Delete "$INSTDIR\package-lock.json"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir /r "$INSTDIR\src"
  RMDir /r "$INSTDIR\public"
  RMDir /r "$INSTDIR\tools"
  RMDir /r "$INSTDIR\pruebas"
  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\node_modules"
  RMDir "$INSTDIR"

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal HTTP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal HTTPS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal DNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal DHCP"'

  Delete "$SMPROGRAMS\${NOMBRE}\*.lnk"
  RMDir  "$SMPROGRAMS\${NOMBRE}"
  Delete "$DESKTOP\SOS Panel de mando.lnk"

  DeleteRegKey HKLM "Software\SOSConectate"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\SOSConectate"

  MessageBox MB_OK|MB_ICONINFORMATION \
    "Se desinstalo el programa.$\n$\nLa carpeta datos\ NO se borro: ahi esta el censo.$\nBorrala a mano cuando ya lo hayas entregado."
SectionEnd
