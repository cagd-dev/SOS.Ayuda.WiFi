# Componentes de terceros

Este proyecto se distribuye bajo **GPL-3.0** (ver [LICENSE](LICENSE)). Los
componentes de abajo mantienen cada uno su propia licencia; ninguno de ellos se
vuelve GPL por viajar aquí dentro.

## Compatibilidad

Todas las dependencias son **licencias permisivas**, y todas son compatibles con
la GPL-3.0. Esto se comprobó recorriendo el `package.json` de cada paquete
instalado:

| Licencia | Paquetes | ¿Compatible con GPL-3.0? |
|---|---|---|
| MIT | 69 | Sí |
| BSD-3-Clause | 4 | Sí |
| ISC | 2 | Sí |
| 0BSD | 1 | Sí |
| Apache-2.0 | 1 | Sí, con GPL-3.0 (no con GPL-2.0) |

Ese último matiz importa: **Apache-2.0 es incompatible con la GPL-2.0** por su
cláusula de patentes. Es una de las razones para haber elegido la versión 3 y no
la 2 de la GPL.

## Qué viaja en el distribuible

| Componente | Licencia | Origen |
|---|---|---|
| Node.js (`runtime/node.exe`) | MIT | https://nodejs.org |
| .NET 8 Runtime (dentro de `PanelSOS.exe`) | MIT | https://dotnet.microsoft.com |
| express | MIT | https://expressjs.com |
| ws | MIT | https://github.com/websockets/ws |
| selfsigned | MIT | https://github.com/jfromaniello/selfsigned |
| node-forge (transitiva) | BSD-3-Clause / GPL-2.0 (dual) | https://github.com/digitalbazaar/forge |

Todas permiten la redistribución. El instalador se genera con **NSIS**, que no
se incorpora al producto: es solo la herramienta de construcción.

## Cómo revisar esto tú mismo

```powershell
Get-ChildItem node_modules -Directory | ForEach-Object {
  $pj = Join-Path $_.FullName 'package.json'
  if (Test-Path $pj) {
    $j = Get-Content $pj -Raw | ConvertFrom-Json
    "$($j.name)  —  $($j.license)"
  }
}
```

Si añades una dependencia, **comprueba su licencia antes**. Una dependencia con
licencia propietaria o con copyleft incompatible haría imposible distribuir el
proyecto tal como está.
