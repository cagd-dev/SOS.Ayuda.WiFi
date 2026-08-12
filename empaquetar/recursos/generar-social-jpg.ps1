# La imagen de presentacion de GitHub tiene un limite de 1 MB, y el PNG de
# origen pesa 1.06: se pasa por 62 KB. Subir la compresion de un PNG no ayuda
# —es sin perdida— y bajarlo a 256 colores destroza los degradados del cielo.
#
# La solucion correcta es cambiar de formato: la portada es una ilustracion
# tipo fotografia, sin transparencia, que es justo para lo que sirve JPEG.
# A calidad 92 baja a una fraccion del tamano sin diferencia visible.
#
#   powershell -ExecutionPolicy Bypass -File empaquetar\recursos\generar-social-jpg.ps1

Add-Type -AssemblyName System.Drawing

$aqui    = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen  = Join-Path $aqui 'github-social.png'
$destino = Join-Path $aqui 'github-social.jpg'
$CALIDAD = 92

$png = [System.Drawing.Bitmap]::FromFile($origen)

# Se dibuja sobre fondo opaco antes de guardar: JPEG no tiene canal alfa y, sin
# esto, cualquier zona transparente saldria negra o con basura.
$plano = New-Object System.Drawing.Bitmap $png.Width, $png.Height,
    ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g = [System.Drawing.Graphics]::FromImage($plano)
$g.Clear([System.Drawing.Color]::FromArgb(10, 15, 30))
$g.DrawImage($png, 0, 0, $png.Width, $png.Height)
$g.Dispose()

$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
    Where-Object { $_.MimeType -eq 'image/jpeg' }
$parametros = New-Object System.Drawing.Imaging.EncoderParameters 1
$parametros.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter(
    [System.Drawing.Imaging.Encoder]::Quality, [int]$CALIDAD)

$plano.Save($destino, $codec, $parametros)
$plano.Dispose(); $png.Dispose()

$antes   = (Get-Item $origen).Length
$despues = (Get-Item $destino).Length
"  PNG origen : {0,8:N0} bytes ({1:N2} MB)" -f $antes, ($antes / 1MB)
"  JPG salida : {0,8:N0} bytes ({1:N2} MB)  calidad {2}" -f $despues, ($despues / 1MB), $CALIDAD
if ($despues -lt 1MB) { "  OK  cabe en el limite de 1 MB de GitHub" }
else { "  SIGUE PASADO: baja CALIDAD y vuelve a correrlo" }
