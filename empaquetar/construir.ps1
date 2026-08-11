<#
    Construye el distribuible completo de SOS · Conectate · Pide Ayuda.

    Deja en  empaquetar\salida\SOS.Conectate.PideAyuda\  una carpeta que
    funciona en cualquier Windows 10/11 x64 SIN instalar nada: ni Node, ni
    .NET, ni Visual C++.

    El codigo JavaScript viaja TAL CUAL, legible y modificable. Es a proposito:
    esto tiene que poder auditarlo y adaptarlo cualquiera que lo necesite.

        .\empaquetar\construir.ps1              carpeta + zip
        .\empaquetar\construir.ps1 -Instalador  ademas genera el .exe (necesita NSIS)
#>

param(
    [switch]$Instalador,
    [string]$RutaNode = "C:\Program Files\nodejs\node.exe"
)

$ErrorActionPreference = 'Stop'
$raiz    = Split-Path -Parent $PSScriptRoot
$salida  = Join-Path $PSScriptRoot 'salida'
$destino = Join-Path $salida 'SOS.Conectate.PideAyuda'

function Paso($texto) { Write-Host "`n>> $texto" -ForegroundColor Cyan }
function Bien($texto) { Write-Host "   OK  $texto" -ForegroundColor Green }
function Mal($texto)  { Write-Host "   !!  $texto" -ForegroundColor Red }

Paso "Limpiando la salida anterior"
if (Test-Path $salida) { Remove-Item $salida -Recurse -Force }
New-Item -ItemType Directory -Path $destino -Force | Out-Null
Bien $destino

# ---------------------------------------------------------------- #
Paso "Compilando el panel (.NET, autocontenido)"
Push-Location (Join-Path $raiz 'panel')
try {
    dotnet publish -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
        -p:EnableCompressionInSingleFile=true `
        -o publicado -v quiet --nologo
    if ($LASTEXITCODE -ne 0) { throw "fallo la compilacion del panel" }
} finally { Pop-Location }

$exePanel = Join-Path $raiz 'panel\publicado\PanelSOS.exe'
if (-not (Test-Path $exePanel)) { throw "no se genero PanelSOS.exe" }
Copy-Item $exePanel $destino
Bien ("PanelSOS.exe  {0} MB" -f [math]::Round((Get-Item $exePanel).Length / 1MB, 1))

# ---------------------------------------------------------------- #
Paso "Empaquetando Node"
if (-not (Test-Path $RutaNode)) { throw "no se encontro node.exe en $RutaNode" }
New-Item -ItemType Directory -Path (Join-Path $destino 'runtime') -Force | Out-Null
Copy-Item $RutaNode (Join-Path $destino 'runtime\node.exe')
$version = (& $RutaNode -v)
Bien ("runtime\node.exe  {0}  {1} MB" -f $version, [math]::Round((Get-Item $RutaNode).Length / 1MB, 1))

# ---------------------------------------------------------------- #
Paso "Copiando el codigo (legible, sin empaquetar ni ofuscar)"
foreach ($carpeta in @('src', 'public', 'tools', 'pruebas')) {
    Copy-Item (Join-Path $raiz $carpeta) $destino -Recurse -Force
    Bien $carpeta
}
foreach ($archivo in @('package.json', 'package-lock.json', 'README.md',
                       'DESPLIEGUE.md', 'LICENSE', 'ARRANCAR.bat', 'CONSOLA.bat')) {
    $origen = Join-Path $raiz $archivo
    if (Test-Path $origen) { Copy-Item $origen $destino; Bien $archivo }
}

# ---------------------------------------------------------------- #
Paso "Instalando dependencias de produccion en el distribuible"
Push-Location $destino
try {
    & $RutaNode (Join-Path (Split-Path $RutaNode) 'node_modules\npm\bin\npm-cli.js') `
        install --omit=dev --no-audit --no-fund --silent
    if ($LASTEXITCODE -ne 0) { throw "fallo npm install" }
} finally { Pop-Location }

$modulos = Join-Path $destino 'node_modules'
if (-not (Test-Path (Join-Path $modulos 'express'))) { throw "no se instalaron las dependencias" }
Bien ("node_modules  {0} MB" -f [math]::Round(((Get-ChildItem $modulos -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1))

# ---------------------------------------------------------------- #
Paso "Comprobando que el distribuible funciona por si mismo"
$nodoEmpaquetado = Join-Path $destino 'runtime\node.exe'
$prueba = & $nodoEmpaquetado (Join-Path $destino 'tools\estado.js') 2>&1 | Out-String
if ($prueba -notmatch '"puesto"') {
    Mal "el distribuible no responde:"
    Write-Host $prueba
    throw "distribuible invalido"
}
Bien "tools\estado.js responde usando el Node empaquetado"

# ---------------------------------------------------------------- #
$total = [math]::Round(((Get-ChildItem $destino -Recurse -File | Measure-Object Length -Sum).Sum) / 1MB, 1)
Paso "Comprimiendo"
$zip = Join-Path $salida 'SOS.Conectate.PideAyuda.zip'
if (Test-Path 'C:\Program Files\7-Zip\7z.exe') {
    & 'C:\Program Files\7-Zip\7z.exe' a -tzip -mx=7 $zip "$destino\*" | Out-Null
} else {
    Compress-Archive -Path "$destino\*" -DestinationPath $zip -CompressionLevel Optimal
}
Bien ("{0}  ({1} MB comprimido, {2} MB en disco)" -f (Split-Path $zip -Leaf),
      [math]::Round((Get-Item $zip).Length / 1MB, 1), $total)

# ---------------------------------------------------------------- #
if ($Instalador) {
    Paso "Generando el instalador"
    $nsis = @("C:\Program Files (x86)\NSIS\makensis.exe", "C:\Program Files\NSIS\makensis.exe") |
            Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $nsis) {
        Mal "NSIS no esta instalado: se omite el instalador (descargalo de nsis.sourceforge.io)"
    } else {
        & $nsis /V2 (Join-Path $PSScriptRoot 'instalador.nsi')
        if ($LASTEXITCODE -ne 0) { throw "fallo NSIS" }
        $setup = Get-ChildItem $salida -Filter '*Setup*.exe' | Select-Object -First 1
        Bien ("{0}  ({1} MB)" -f $setup.Name, [math]::Round($setup.Length / 1MB, 1))
    }
}

Write-Host "`n=================================================" -ForegroundColor Green
Write-Host " LISTO. Distribuible en:" -ForegroundColor Green
Write-Host " $salida" -ForegroundColor Green
Write-Host "=================================================`n" -ForegroundColor Green
