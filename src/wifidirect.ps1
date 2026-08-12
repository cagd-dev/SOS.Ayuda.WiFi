<#
    Punto de acceso por Wi-Fi Direct en modo "legacy".

    ------------------------------------------------------------------
    POR QUE ESTE CAMINO

    La red hospedada (netsh wlan hostednetwork) es el mecanismo mas comodo,
    pero los drivers modernos la han ido abandonando: en la mayoria de
    adaptadores actuales sale "No". Sin ella, el modo punto de acceso propio
    quedaba descartado para casi todo el hardware.

    Wi-Fi Direct SI esta en practicamente cualquier tarjeta actual. Y aunque
    Wi-Fi Direct "puro" (P2P) NO sirve para lo nuestro —los iPhone directamente
    no lo hablan, y en Android vive en un menu aparte y no en la lista normal de
    redes—, tiene un modo LEGACY que emite un SSID corriente con clave WPA2.
    A esa red se conecta cualquier telefono desde la lista de siempre, iPhone
    incluido, sin saber que por debajo es Wi-Fi Direct.

    ------------------------------------------------------------------
    LIMITES, PARA NO PROMETER DE MAS

    - El tope de clientes lo pone el driver. Suele ser 8, a veces menos. Es
      MUCHO menos que un router. Para un puesto pequeno o una zona con poca
      gente puede ser suficiente; para una plaza llena, no.
    - No puede ser una red abierta: Windows exige clave. Por eso la clave va
      dentro del nombre de la red.
    - El proceso de PowerShell tiene que SEGUIR VIVO: el anuncio muere con el.
      Por eso este script se queda esperando y quien lo lanza lo mata para
      apagar la red.

    ------------------------------------------------------------------
        powershell -ExecutionPolicy Bypass -File wifidirect.ps1 -Ssid "X" -Clave "12345678"
#>

param(
    [Parameter(Mandatory = $true)][string]$Ssid,
    [Parameter(Mandatory = $true)][string]$Clave
)

$ErrorActionPreference = 'Stop'

# Las clases de WinRT no se cargan como las de .NET: hay que nombrarlas con su
# ContentType. Esto falla en seco si el equipo no es Windows 10/11.
try {
    [void][Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher, Windows, ContentType = WindowsRuntime]
    [void][Windows.Devices.WiFiDirect.WiFiDirectAdvertisementListenStateDiscoverability, Windows, ContentType = WindowsRuntime]
} catch {
    Write-Output "ERROR: este Windows no expone las APIs de Wi-Fi Direct ($($_.Exception.Message))"
    exit 1
}

if ($Clave.Length -lt 8) {
    Write-Output "ERROR: la clave necesita 8 caracteres o mas (WPA2)"
    exit 1
}

$publicador = [Windows.Devices.WiFiDirect.WiFiDirectAdvertisementPublisher]::new()

# El modo legacy es lo que hace que emita un SSID normal, visible y conectable
# desde la lista de WiFi de cualquier telefono. Sin esto seria Wi-Fi Direct puro
# y solo lo verian algunos Android, en un menu aparte.
$publicador.Advertisement.IsAutonomousGroupOwnerEnabled = $true
$publicador.Advertisement.LegacySettings.IsEnabled = $true
$publicador.Advertisement.LegacySettings.Ssid = $Ssid

$contrasena = [Windows.Security.Credentials.PasswordCredential, Windows, ContentType = WindowsRuntime]::new()
$contrasena.Password = $Clave
$publicador.Advertisement.LegacySettings.Passphrase = $contrasena

$publicador.Advertisement.ListenStateDiscoverability =
    [Windows.Devices.WiFiDirect.WiFiDirectAdvertisementListenStateDiscoverability]::Normal

# NO se usa Register-ObjectEvent: Windows PowerShell no puede suscribirse a
# eventos de WinRT y revienta con INVALID_REGISTRATION. Se consulta el estado
# directamente, que para esto basta.
try {
    $publicador.Start()
} catch {
    Write-Output "ERROR: no se pudo iniciar ($($_.Exception.Message))"
    exit 1
}

# El driver tarda un momento en aceptar o rechazar. Se comprueba varias veces en
# vez de esperar un rato fijo: en una tarjeta rapida no hay por que hacer
# esperar al operador, y en una lenta un solo vistazo llegaria demasiado pronto.
$intentos = 0
while ($publicador.Status -eq 'Created' -and $intentos -lt 30) {
    Start-Sleep -Milliseconds 200
    $intentos++
}

if ($publicador.Status -ne 'Started') {
    $detalle = switch ("$($publicador.Status)") {
        'Aborted' { 'el driver rechazo el anuncio (la tarjeta puede estar conectada a otra red, o apagada)' }
        'Created' { 'el driver no respondio' }
        default   { "estado '$($publicador.Status)'" }
    }
    Write-Output "ERROR: $detalle"
    exit 1
}

Write-Output "LISTO: red '$Ssid' levantada por Wi-Fi Direct (modo legacy)"

# El anuncio vive mientras viva este proceso. Quien lo lanzo lo mata para bajar
# la red; por eso no hay que "terminar" nunca por cuenta propia.
try {
    while ($publicador.Status -eq 'Started') { Start-Sleep -Seconds 2 }
    Write-Output "ERROR: el anuncio se detuvo solo (estado '$($publicador.Status)')"
    exit 1
} finally {
    try { $publicador.Stop() } catch { }
}
