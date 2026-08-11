# Retoque de las capturas antes de publicarlas.
#
# Una captura de pantalla de este sistema lleva encima cosas que no deben acabar
# en un repositorio publico: el PIN del operador y coordenadas GPS reales. Este
# script toma las capturas en crudo de images/originales/ (que esta en
# .gitignore) y deja en images/ las versiones que van al README.
#
# Las coordenadas estan atadas a estas capturas concretas. Si vuelves a
# capturar, hay que volver a medirlas.
#
#   powershell -ExecutionPolicy Bypass -File images\retocar-capturas.ps1

Add-Type -AssemblyName System.Drawing

$raiz   = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = Join-Path $raiz 'originales'

if (-not (Test-Path $origen)) {
  Write-Host "No hay capturas en crudo en $origen" -ForegroundColor Yellow
  Write-Host "Esta carpeta no se versiona a proposito: contiene el PIN real."
  exit 1
}

function Guardar($bmp, $ruta) {
  $bmp.Save($ruta, [System.Drawing.Imaging.ImageFormat]::Png)
  $kb = [math]::Round((Get-Item $ruta).Length / 1KB)
  "  -> {0} ({1} x {2}, {3} KB)" -f (Split-Path $ruta -Leaf), $bmp.Width, $bmp.Height, $kb
}

# Tapa un texto con seis puntos dibujados a mano. A mano y no con una fuente
# porque asi no depende de que fuentes tenga instaladas la maquina.
function Ocultar($grafico, $fondo, $tinta, $x, $y, $ancho, $alto, $paso, $diametro) {
  $grafico.FillRectangle((New-Object System.Drawing.SolidBrush $fondo), $x, $y, $ancho, $alto)
  $pincel = New-Object System.Drawing.SolidBrush $tinta
  $cy = $y + ($alto - $diametro) / 2
  for ($i = 0; $i -lt 6; $i++) {
    $grafico.FillEllipse($pincel, ($x + 3 + $i * $paso), $cy, $diametro, $diametro)
  }
  $pincel.Dispose()
}

# ---------------------------------------------------------------- panel ----
# El PIN sale dos veces: en el log del arranque y en el campo de configuracion.
'PANEL DE MANDO'
$panel = [System.Drawing.Bitmap]::FromFile((Join-Path $origen 'panel.png'))
$g = [System.Drawing.Graphics]::FromImage($panel)
$g.SmoothingMode = 'AntiAlias'

Ocultar $g ([System.Drawing.Color]::FromArgb(1, 4, 9)) `
           ([System.Drawing.Color]::FromArgb(200, 200, 200)) 858 357 46 18 7 4

Ocultar $g ([System.Drawing.Color]::FromArgb(33, 38, 45)) `
           ([System.Drawing.Color]::FromArgb(226, 232, 240)) 22 546 52 20 8 5

$g.Dispose()
Guardar $panel (Join-Path $raiz 'panel-de-mando.png')
$panel.Dispose()

# ------------------------------------------------------------- operador ----
# La primera linea de GPS traia una lectura real del telefono. En vez de tapar
# los numeros se copia encima la banda de la segunda linea, que ya era una
# coordenada de prueba: queda coherente pixel a pixel y sin dato real.
'CONSOLA DEL OPERADOR'
$op = [System.Drawing.Bitmap]::FromFile((Join-Path $origen 'Operador.png'))
$destinoY = 341
$fuenteY  = 396
for ($fila = 0; $fila -lt 20; $fila++) {
  for ($x = 385; $x -le 1893; $x++) {
    $op.SetPixel($x, ($destinoY + $fila), $op.GetPixel($x, ($fuenteY + $fila)))
  }
}
Guardar $op (Join-Path $raiz 'consola-del-operador.png')
$op.Dispose()

# ---------------------------------------------------------------- portal ----
# La captura llevaba una franja blanca a la derecha, fuera de la ventana.
'PORTAL DE LA PERSONA'
$user = [System.Drawing.Bitmap]::FromFile((Join-Path $origen 'User.png'))
$rect = New-Object System.Drawing.Rectangle 0, 0, 497, $user.Height
$corte = $user.Clone($rect, $user.PixelFormat)
Guardar $corte (Join-Path $raiz 'portal-de-la-persona.png')
$corte.Dispose(); $user.Dispose()
