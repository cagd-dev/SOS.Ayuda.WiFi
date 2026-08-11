<#
    Prepara los graficos que pide NSIS a partir de la portada.

    NSIS exige BMP con medidas exactas, no PNG: 164x314 para la pagina de
    bienvenida. Recortamos una franja vertical de la portada centrada en la
    escena (la gente con los telefonos y el operador), porque la mitad
    izquierda de la ilustracion es fondo vacio a proposito.

        .\generar-graficos-instalador.ps1
#>

Add-Type -AssemblyName System.Drawing

$carpeta = $PSScriptRoot
$origen  = Join-Path $carpeta 'portada-empaque.png'

if (-not (Test-Path $origen)) {
    Write-Host "  No se encontro portada-empaque.png" -ForegroundColor Red
    exit 1
}

$portada = [System.Drawing.Image]::FromFile($origen)
Write-Host "  Portada: $($portada.Width) x $($portada.Height)"

function New-Recorte([int]$ancho, [int]$alto, [double]$centroX, [string]$nombre) {
    # Recorte con la misma proporcion que el destino, para no deformar nada.
    $proporcion = $ancho / $alto
    $altoCorte  = $portada.Height
    $anchoCorte = [int]($altoCorte * $proporcion)

    $x = [int](($portada.Width * $centroX) - ($anchoCorte / 2))
    $x = [Math]::Max(0, [Math]::Min($x, $portada.Width - $anchoCorte))

    $destino = New-Object System.Drawing.Bitmap($ancho, $alto)
    $g = [System.Drawing.Graphics]::FromImage($destino)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $g.DrawImage($portada,
        (New-Object System.Drawing.Rectangle(0, 0, $ancho, $alto)),
        $x, 0, $anchoCorte, $altoCorte,
        [System.Drawing.GraphicsUnit]::Pixel)

    $ruta = Join-Path $carpeta $nombre
    # BMP de 24 bits: es lo que entiende NSIS sin sorpresas.
    $destino.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Bmp)
    $g.Dispose(); $destino.Dispose()

    $kb = [math]::Round((Get-Item $ruta).Length / 1KB, 0)
    Write-Host "  $nombre  ->  $ancho x $alto  ($kb KB)"
}

# Pagina de bienvenida y de final: franja vertical centrada en la escena.
New-Recorte 164 314 0.62 'instalador-lateral.bmp'

$portada.Dispose()
Write-Host "  Listo."
