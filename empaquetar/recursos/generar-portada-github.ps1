<#
    Genera la imagen de presentacion del repositorio (social preview).

    GitHub no tiene "icono de repositorio": lo que se ve al compartir el enlace
    en WhatsApp, Slack o redes es esta imagen, de 1280x640. Se sube en
    Settings > General > Social preview.

    Aprovecha que la portada tiene la mitad izquierda vacia a proposito: ahi va
    el titulo, y la escena queda a la derecha.

    OJO: portada-empaque.png es la PLANCHA DE FONDO y no se usa suelta en
    ningun sitio. Sin el texto encima, ese hueco oscuro parece una imagen mal
    recortada — el README la llevo asi un tiempo. Lo que se publica es el
    resultado de este script (github-social.png y su version .jpg).

        .\generar-portada-github.ps1
#>

Add-Type -AssemblyName System.Drawing

$carpeta = $PSScriptRoot
$origen  = Join-Path $carpeta 'portada-empaque.png'
$destino = Join-Path $carpeta 'github-social.png'

$ANCHO = 1280
$ALTO  = 640

$portada = [System.Drawing.Image]::FromFile($origen)
$lienzo  = New-Object System.Drawing.Bitmap($ANCHO, $ALTO)
$g = [System.Drawing.Graphics]::FromImage($lienzo)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

# --- Escena recortada a 2:1, conservando la parte derecha ---
$altoCorte  = $portada.Height
$anchoCorte = [int]($altoCorte * ($ANCHO / $ALTO))
$x = $portada.Width - $anchoCorte          # pegado a la derecha
$g.DrawImage($portada,
    (New-Object System.Drawing.Rectangle(0, 0, $ANCHO, $ALTO)),
    $x, 0, $anchoCorte, $altoCorte,
    [System.Drawing.GraphicsUnit]::Pixel)

# --- Velo oscuro a la izquierda para que el texto se lea sin tapar la escena ---
$degradado = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point([int]($ANCHO * 0.62), 0)),
    ([System.Drawing.Color]::FromArgb(248, 8, 12, 22)),
    ([System.Drawing.Color]::FromArgb(0, 8, 12, 22)))
$g.FillRectangle($degradado, 0, 0, [int]($ANCHO * 0.62), $ALTO)

# --- Icono ---
$rutaIcono = Join-Path $carpeta 'icono-256.png'
if (Test-Path $rutaIcono) {
    $icono = [System.Drawing.Image]::FromFile($rutaIcono)
    $g.DrawImage($icono, 74, 92, 96, 96)
    $icono.Dispose()
}

# --- Textos ---
$blanco = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$suave  = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 168, 178, 192))
$rojo   = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 235, 90, 72))

$titulo   = New-Object System.Drawing.Font('Segoe UI', 44, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$lema     = New-Object System.Drawing.Font('Segoe UI', 25, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$detalle  = New-Object System.Drawing.Font('Segoe UI', 19, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)

# Firma: DrawString(texto, fuente, pincel, x, y)
$g.DrawString('SOS', $titulo, $blanco, 74, 232)
$anchoSos = $g.MeasureString('SOS', $titulo).Width
# MeasureString incluye relleno lateral; aun asi hace falta separacion visible
# o las dos palabras se leen como una sola.
$g.DrawString('CONECTATE', $titulo, $rojo, (74 + $anchoSos + 4), 232)
$g.DrawString('PIDE AYUDA', $titulo, $blanco, 74, 288)

$g.DrawString('Portal cautivo de emergencia para', $lema, $suave, 76, 366)
$g.DrawString('localizar personas tras un desastre', $lema, $suave, 76, 398)

# Separador ASCII: los caracteres no ingleses en un .ps1 dependen de como se
# guarde el archivo y acaban saliendo mal.
$g.DrawString('Funciona sin internet  -  Software libre GPL-3.0', $detalle, $rojo, 76, 470)

$lienzo.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)

foreach ($o in @($g, $lienzo, $portada, $degradado, $blanco, $suave, $rojo, $titulo, $lema, $detalle)) {
    if ($o -and $o.Dispose) { $o.Dispose() }
}

$kb = [math]::Round((Get-Item $destino).Length / 1KB, 0)
Write-Host "  github-social.png  ->  ${ANCHO}x${ALTO}  ($kb KB)"
Write-Host "  Subelo en: Settings > General > Social preview"
