<#
    Genera el icono de la aplicacion.

    Se dibuja POR CODIGO y cada tamano por separado, en vez de reescalar una
    imagen grande. Reescalar es justo lo que hace que los iconos se vean sucios
    a 16 px: los trazos finos se convierten en manchas grises.

    Reglas de diseno, pensadas para donde se ve de verdad (16 px en la barra de
    tareas):

      - UNA sola idea: el pin de ubicacion. Sin texto: tres letras a 16 px
        ocupan 3 pixeles de alto y no se leen, solo ensucian.
      - Fondo rojo macizo: da silueta reconocible sobre barras claras y oscuras.
      - Detalle progresivo: el agujero del pin aparece a partir de 48 px y las
        ondas de WiFi a partir de 64. Debajo de eso estorban mas que aportan.

        .\generar-icono.ps1
#>

Add-Type -AssemblyName System.Drawing

$carpeta = $PSScriptRoot
$tamanos = @(16, 20, 24, 32, 48, 64, 128, 256)

$rojo   = [System.Drawing.Color]::FromArgb(255, 220, 47, 38)   # #DC2F26
$blanco = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)

function New-RectanguloRedondeado([single]$x, [single]$y, [single]$w, [single]$h, [single]$r) {
    $ruta = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $ruta.AddArc($x, $y, $d, $d, 180, 90)
    $ruta.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $ruta.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $ruta.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $ruta.CloseFigure()
    return $ruta
}

function New-Icono([int]$s) {
    $bmp = New-Object System.Drawing.Bitmap($s, $s, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb))
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $pincelRojo   = New-Object System.Drawing.SolidBrush($rojo)
    $pincelBlanco = New-Object System.Drawing.SolidBrush($blanco)

    # --- Fondo ---
    # Margen minimo en tamanos pequenos: cada pixel cuenta.
    $margen = if ($s -le 24) { 0 } else { [single]($s * 0.045) }
    $lado   = [single]($s - 2 * $margen)
    $radio  = [single]([Math]::Max(1.5, $s * 0.21))
    $fondo  = New-RectanguloRedondeado $margen $margen $lado $lado $radio
    $g.FillPath($pincelRojo, $fondo)
    $fondo.Dispose()

    # --- Pin ---
    # Pin ligeramente descentrado a la izquierda y algo mas pequeno, para dejarle
    # sitio limpio a las ondas. Antes se tocaban y parecian un apendice del pin.
    $cx = [single]($s * 0.455)
    $cy = [single]($s * 0.435)
    $r  = [single]($s * 0.185)

    $g.FillEllipse($pincelBlanco, $cx - $r, $cy - $r, $r * 2, $r * 2)

    $puntos = @(
        (New-Object System.Drawing.PointF(($cx - $r * 0.80), ($cy + $r * 0.58))),
        (New-Object System.Drawing.PointF(($cx + $r * 0.80), ($cy + $r * 0.58))),
        (New-Object System.Drawing.PointF($cx, [single]($s * 0.80)))
    )
    $g.FillPolygon($pincelBlanco, $puntos)

    # El agujero solo a partir de 48: mas pequeno se cierra y ensucia el pin.
    if ($s -ge 48) {
        $rh = [single]($r * 0.40)
        $g.FillEllipse($pincelRojo, $cx - $rh, $cy - $rh, $rh * 2, $rh * 2)
    }

    # Las ondas solo a partir de 64: por debajo son dos pixeles sueltos que
    # parecen suciedad, no una senal.
    if ($s -ge 64) {
        $grosor = [single]($s * 0.052)
        $lapiz  = New-Object System.Drawing.Pen($blanco, $grosor)
        $lapiz.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
        $lapiz.EndCap   = [System.Drawing.Drawing2D.LineCap]::Round

        # Origen en la esquina superior derecha, bien despegado del pin, y las
        # ondas abriendose hacia arriba: se leen como senal, no como adorno.
        $ox = [single]($s * 0.815)
        $oy = [single]($s * 0.255)
        foreach ($factor in @(0.085, 0.150)) {
            $rr = [single]($s * $factor)
            $g.DrawArc($lapiz, $ox - $rr, $oy - $rr, $rr * 2, $rr * 2, 190, 110)
        }
        $lapiz.Dispose()
    }

    $pincelRojo.Dispose(); $pincelBlanco.Dispose(); $g.Dispose()
    return $bmp
}

# --- Genera cada tamano y guarda los PNG de referencia ---
$imagenes = @{}
foreach ($s in $tamanos) {
    $bmp = New-Icono $s
    $imagenes[$s] = $bmp
    if ($s -in @(16, 32, 256)) {
        $bmp.Save((Join-Path $carpeta "icono-$s.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    }
}

# --- Arma el .ico con TODOS los tamanos dentro ---
# Formato ICO: cabecera, una entrada de directorio por imagen, y despues los
# datos. Se usa PNG dentro del ICO, que Windows admite desde Vista.
$destino = Join-Path $carpeta 'icono-sos.ico'
$flujo   = [System.IO.File]::Create($destino)
$escritor = New-Object System.IO.BinaryWriter($flujo)

$cargas = @()
foreach ($s in $tamanos) {
    $ms = New-Object System.IO.MemoryStream
    $imagenes[$s].Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $cargas += ,$ms.ToArray()
    $ms.Dispose()
}

$escritor.Write([UInt16]0)                 # reservado
$escritor.Write([UInt16]1)                 # tipo: icono
$escritor.Write([UInt16]$tamanos.Count)

$desplazamiento = 6 + (16 * $tamanos.Count)
for ($i = 0; $i -lt $tamanos.Count; $i++) {
    $s = $tamanos[$i]
    $byteLado = if ($s -ge 256) { 0 } else { $s }   # 0 significa 256
    $escritor.Write([Byte]$byteLado)
    $escritor.Write([Byte]$byteLado)
    $escritor.Write([Byte]0)                        # paleta
    $escritor.Write([Byte]0)                        # reservado
    $escritor.Write([UInt16]1)                      # planos
    $escritor.Write([UInt16]32)                     # bits por pixel
    $escritor.Write([UInt32]$cargas[$i].Length)
    $escritor.Write([UInt32]$desplazamiento)
    $desplazamiento += $cargas[$i].Length
}
foreach ($carga in $cargas) { $escritor.Write($carga) }

$escritor.Close(); $flujo.Close()
foreach ($bmp in $imagenes.Values) { $bmp.Dispose() }

$kb = [math]::Round((Get-Item $destino).Length / 1KB, 1)
Write-Host "  icono-sos.ico  ->  $($tamanos -join ', ') px   ($kb KB)"
Write-Host "  PNG de referencia: icono-16.png, icono-32.png, icono-256.png"
