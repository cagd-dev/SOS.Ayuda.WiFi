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
!define VERSION    "1.4.0"
!define CARPETA    "salida\SOS.Conectate.PideAyuda"

Name              "${NOMBRE}"
OutFile           "salida\SOS.Conectate.PideAyuda-Setup.exe"
Unicode           true
; El PROGRAMA va a Archivos de programa y los DATOS a ProgramData. Antes se
; instalaba todo junto en C:\SOS.Conectate.PideAyuda, que ademas es la carpeta
; donde se desarrolla: instalar encima habria machacado el codigo fuente.
InstallDir        "$PROGRAMFILES64\SOS Conectate Pide Ayuda"
InstallDirRegKey  HKLM "Software\SOSConectate" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

VIProductVersion "1.4.0.0"
VIAddVersionKey  "ProductName"     "${NOMBRE}"
VIAddVersionKey  "FileDescription" "Portal cautivo de emergencia"
VIAddVersionKey  "FileVersion"     "${VERSION}"
VIAddVersionKey  "LegalCopyright"  "Copyright (C) 2026 - Licencia GPL-3.0"

!define MUI_ABORTWARNING
!define MUI_ICON   "recursos\icono-sos.ico"
!define MUI_UNICON "recursos\icono-sos.ico"

; Franja lateral recortada de la portada del proyecto.
!define MUI_WELCOMEFINISHPAGE_BITMAP    "recursos\instalador-lateral.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP  "recursos\instalador-lateral.bmp"

; Titulos propios de las paginas de bienvenida y de fin.
;
; Los de fabrica son "Bienvenido al Asistente de Instalacion de $(^NameDA)" y
; "Completando el Asistente de Instalacion de $(^NameDA)". Con un nombre de
; cuatro palabras como el nuestro no caben: el recuadro del titulo mide dos
; lineas y la tercera sale cortada a media palabra ("...Pide Ayud").
;
; Se arregla por los dos lados —titulo mas corto Y una linea mas de espacio—
; para que siga cabiendo si alguien alarga el nombre mas adelante.
!define MUI_WELCOMEFINISHPAGE_TITLE_3LINES
!define MUI_WELCOMEPAGE_TITLE "Bienvenido a SOS Conectate Pide Ayuda"
!define MUI_WELCOMEPAGE_TEXT "Este asistente instalara en este equipo el portal cautivo de emergencia: censo de personas y chat con el puesto de mando, funcionando sin internet.$\r$\n$\r$\nNo hace falta instalar nada mas. Node.js y todo lo necesario viajan dentro.$\r$\n$\r$\nPresione Siguiente para continuar."

!define MUI_FINISHPAGE_TITLE "Listo para operar"
!define MUI_FINISHPAGE_TEXT "El sistema quedo instalado.$\r$\n$\r$\nAbre el panel de mando, pulsa Iniciar el portal y pega los carteles con el nombre de la red. La guia de despliegue explica como configurar el router para que el portal se abra solo en los celulares.$\r$\n$\r$\nEl censo se guarda en C:\ProgramData\SOS.Ayuda.WiFi, aparte del programa."
!define MUI_FINISHPAGE_RUN "$INSTDIR\PanelSOS.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir el panel de mando"
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\DESPLIEGUE.md"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Leer la guia de despliegue"

!insertmacro MUI_PAGE_WELCOME
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

  ; Con contexto "all", $APPDATA es C:\ProgramData: el sitio de Windows para
  ; datos de aplicacion compartidos entre usuarios. Es donde va el censo.
  SetShellVarContext all
  CreateDirectory "$APPDATA\SOS.Ayuda.WiFi"

  ; Esta marca es lo que le dice al programa que es una INSTALACION y que los
  ; datos van a ProgramData, no junto al ejecutable. La version portatil (el
  ; ZIP) no la lleva, y por eso guarda los datos a su lado.
  FileOpen $0 "$INSTDIR\.instalado" w
  FileWrite $0 "Instalado el ${__DATE__} ${__TIME__}$\r$\n"
  FileWrite $0 "Los datos (censo, respaldos, configuracion) viven en:$\r$\n"
  FileWrite $0 "$APPDATA\SOS.Ayuda.WiFi$\r$\n"
  FileClose $0

  CreateDirectory "$SMPROGRAMS\${NOMBRE}"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Panel de mando.lnk" "$INSTDIR\PanelSOS.exe"
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Guia de despliegue.lnk" "$INSTDIR\DESPLIEGUE.md"
  ; Acceso directo a los datos: el operador tiene que poder llegar rapido a los
  ; respaldos y al CSV sin saber que existe ProgramData.
  CreateShortcut "$SMPROGRAMS\${NOMBRE}\Carpeta de datos (censo y respaldos).lnk" \
                 "$APPDATA\SOS.Ayuda.WiFi"
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
;
; Se BORRA antes de anadir. "netsh advfirewall firewall add rule" no reemplaza:
; apila. Cada reinstalacion dejaba un juego nuevo de reglas con el mismo nombre,
; y tras varias versiones el firewall acumulaba duplicados que nadie iba a
; limpiar y que hacian imposible auditar que estaba abierto de verdad. Borrar
; una regla que no existe devuelve error y no rompe nada, por eso no se
; comprueba el codigo de salida.
Section "Abrir los puertos en el firewall" Firewall
  DetailPrint "Abriendo los puertos del portal..."

  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal HTTP"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal HTTPS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal DNS"'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SOS Portal DHCP"'

  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal HTTP" dir=in action=allow protocol=TCP localport=80'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal HTTPS" dir=in action=allow protocol=TCP localport=443'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal DNS" dir=in action=allow protocol=UDP localport=53'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SOS Portal DHCP" dir=in action=allow protocol=UDP localport=67'
SectionEnd

; ---------------------------------------------------------------------
Section "Uninstall"
  ; ProgramData\SOS.Ayuda.WiFi NO se toca: ahi esta el censo. Borrarlo aqui
  ; seria destruir datos de victimas sin constancia; para eso esta el cierre
  ; de operacion guiado, que exporta, registra la entrega y deja constancia.
  SetShellVarContext all
  Delete "$INSTDIR\.instalado"
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
    "Se desinstalo el programa.$\n$\nEL CENSO NO SE BORRO. Sigue en:$\n$APPDATA\SOS.Ayuda.WiFi$\n$\nSi la operacion termino, usa el cierre guiado del panel antes de borrarlo: exporta, registra a quien se entrego y deja constancia."
SectionEnd
