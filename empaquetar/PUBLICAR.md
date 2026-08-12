# Publicar una versión

Los ejecutables **no se guardan en el repositorio** — son 170 MB por versión y
Git no olvida nada, así que el repo crecería sin freno y cada `git clone`
arrastraría todas las versiones anteriores. Van en las **Releases** de GitHub,
que es almacenamiento aparte pensado justo para esto.

Esto es lo que hace que alguien que no programa pueda usar el proyecto: sin una
Release publicada, la única forma de obtenerlo es clonar el repo e instalar
Node. Con ella, es bajar un `.exe` y darle doble clic.

---

## 1. Antes de publicar

```powershell
# Las dos suites en verde
npm run prueba-cierre
npm start                 # en otra ventana
npm run prueba

# La versión tiene que coincidir en los tres sitios
#   package.json · panel/PanelSOS.csproj · empaquetar/instalador.nsi
```

Y el `CHANGELOG.md` con la entrada de la versión escrita.

## 2. Construir

```powershell
.\empaquetar\construir.ps1 -Instalador
```

Deja en `empaquetar/salida/`:

| Archivo | Tamaño aprox. |
|---|---|
| `SOS.Conectate.PideAyuda-Setup.exe` | 80 MB |
| `SOS.Conectate.PideAyuda.zip` | 91 MB |

El script se autocomprueba: antes de comprimir ejecuta `tools/estado.js` con el
Node empaquetado y falla si no responde, para no publicar un paquete roto.

## 3. Etiquetar y subir el código

```powershell
git add -A
git commit -m "feat: lo que sea"
git tag -a v1.3.0 -m "v1.3.0 - resumen corto"
git push origin main
git push origin v1.3.0
```

## 4. Crear la Release

**Con la web:** entra a
`https://github.com/cagd-dev/SOS.Ayuda.WiFi/releases/new`, elige la etiqueta que
acabas de subir, pon de título `v1.3.0 — resumen corto`, pega en el cuerpo lo
que dice el CHANGELOG de esa versión y **arrastra los dos archivos** de
`empaquetar/salida/`. Publicar.

**Con la línea de comandos**, si tienes [GitHub CLI](https://cli.github.com):

```powershell
gh release create v1.3.0 `
  empaquetar\salida\SOS.Conectate.PideAyuda-Setup.exe `
  empaquetar\salida\SOS.Conectate.PideAyuda.zip `
  --title "v1.3.0 — resumen corto" `
  --notes-file NOTAS.md
```

## 5. Comprobar que sirve

Baja el `.exe` **desde la página de la Release**, no desde tu carpeta, e
instálalo en un equipo limpio o en una máquina virtual. Es la única forma de
saber que lo que publicaste es lo que funciona.

---

## Qué avisarle a la gente

Windows va a mostrar el aviso de SmartScreen: *"Windows protegió su PC"*. Es
esperado — firmar un ejecutable cuesta dinero y este proyecto no vende nada.
Hay que hacer clic en *Más información → Ejecutar de todas formas*.

Merece la pena decirlo en la propia Release, porque para alguien que no es
técnico ese aviso parece un virus y abandona ahí.

---

## Números de versión

- **MAYOR** — rompe despliegues existentes (formato de la base, puertos, protocolo).
- **MENOR** — funcionalidad nueva compatible hacia atrás.
- **PARCHE** — correcciones.

Un fallo de seguridad que permita acceder a datos de víctimas se publica como
versión propia y cuanto antes, aunque sea un cambio pequeño: la gente tiene que
poder actualizar sabiendo por qué.
