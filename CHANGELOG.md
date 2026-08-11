# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/),
versionado según [SemVer](https://semver.org/lang/es/).

---

## [1.2.0] — 2026-08-11

### Añadido

- **Cierre de operación guiado.** Hasta ahora los datos de las víctimas se
  quedaban en el equipo indefinidamente: recogerlos está justificado por la
  emergencia, conservarlos para siempre no. Es una máquina de estados que solo
  avanza:

  `ABIERTA → CERRADA → ENTREGADA → PURGADA`

  1. **Cerrar** genera el censo definitivo en CSV, un respaldo verificado y la
     huella SHA-256 del archivo.
  2. **Registrar la entrega** anota a quién se entregó, cómo y cuándo. Es
     obligatorio decir a quién.
  3. **Purgar** destruye base, respaldos y exportaciones. Solo se permite tras
     un plazo de conservación de 30 días desde la entrega — o antes, con un
     motivo escrito que queda registrado.

- **La constancia sobrevive a la purga y no contiene ni un dato personal.**
  Guarda cuántas personas hubo, a quién se entregó el archivo, su huella
  digital y quién destruyó los datos. Es lo que permite responder «¿qué pasó
  con esos datos?» cuando ya no existen. Hay pruebas que verifican que no se
  filtran nombres, cédulas ni ubicaciones.
- El panel guía los tres pasos y solo muestra el siguiente. La purga pide doble
  confirmación y exige el portal detenido.
- `pruebas/cierre.js`: 27 pruebas propias, contra una carpeta temporal para no
  tocar datos reales.

### Corregido

- **El instalador apuntaba a la carpeta de desarrollo.** `C:\SOS.Conectate.PideAyuda`
  era a la vez el destino de instalación y donde vive el código fuente:
  instalar encima habría machacado el proyecto.

### Cambiado

- **Programa y datos separados**, como manda Windows:
  - Programa → `C:\Program Files\SOS Conectate Pide Ayuda`
  - Datos → `C:\ProgramData\SOS.Ayuda.WiFi`

  La versión portátil (el ZIP) sigue guardando los datos a su lado, que es lo
  que se espera de algo que va en una USB. La diferencia la marca un archivo
  `.instalado` que crea el instalador.
- Acceso directo a la carpeta de datos en el menú inicio, y botón en el panel:
  el operador tiene que poder llegar a los respaldos sin saber que existe
  ProgramData.
- El desinstalador **no borra el censo** y lo dice claramente, remitiendo al
  cierre guiado.

---

## [1.1.0] — 2026-08-11

Endurecimiento tras una revisión de seguridad externa.

### Corregido

- **El respaldo perdía la base entera.** `respaldar.js` copiaba el archivo
  `.sqlite3` a secas, pero la base está en modo WAL: con el portal encendido,
  los datos viven en el archivo `-wal` hasta que se hace *checkpoint*. Medido en
  un caso real: el archivo principal tenía 4 KB y el `-wal` 800 KB, y la copia
  plana **ni siquiera se podía abrir**. Ahora se usa `VACUUM INTO`, que produce
  una copia coherente aunque haya escrituras en curso, **y se verifica** abriendo
  la copia y contando los registros. Si algo falla, se borra el archivo a medias
  en vez de dejar un respaldo falso.
- **El directorio público volcaba el censo completo.** Una petición sin texto de
  búsqueda devolvía hasta 200 personas con nombre, código, estado y
  acompañantes, a cualquiera conectado a la red. Ahora exige dos caracteres y
  devuelve como mucho 50 coincidencias.
- **Inyección de fórmulas en el CSV.** Excel ejecuta como fórmula toda celda que
  empiece por `=`, `+`, `-` o `@`. Como el CSV lo abre la autoridad en su equipo,
  bastaba registrarse con un nombre malicioso. Ahora esas celdas se neutralizan.

### Cambiado

- **El PIN ya no es `1234`.** En el primer arranque se genera uno aleatorio de
  seis dígitos y se guarda. Un aviso pidiendo cambiarlo no es una defensa: con
  prisa, ese PIN se queda puesto, y detrás están los datos de las víctimas.
- **El PIN ya no viaja en la URL del WebSocket.** Se usa la sesión de
  `/admin/login`, que no queda en el historial del navegador y muere al
  reiniciar el servidor.
- **Retardo creciente por dispositivo al fallar el PIN** (hasta 8 s). No es un
  bloqueo: dejar fuera al operador sería peor que el abuso que evita.
- **Cuotas por dispositivo** en registro, recuperación, mensajes, ubicación y
  acceso. Generosas a propósito, porque en una emergencia la gente se registra
  a ráfagas.
- **Límite de 64 KB por mensaje de WebSocket.**
- El token de sesión **se borra de la barra de direcciones** al capturarlo, y se
  envía `Referrer-Policy: no-referrer`. En un teléfono prestado, ese token en el
  historial entrega la sesión de otra persona.

### Identidad visual

- **Icono propio, generado por código** ([generar-icono.ps1](empaquetar/recursos/generar-icono.ps1)),
  con ocho resoluciones dentro del `.ico` (16 a 256 px). Cada tamaño se dibuja
  aparte en vez de reescalar uno grande, que es lo que hace que los iconos se
  vean sucios en la barra de tareas. El detalle es progresivo: a 16 px solo el
  pin, el agujero aparece a 48 y las ondas a 64. El texto se descartó: tres
  letras a 16 px no se leen, solo ensucian.
- El icono va embebido en el panel, en el instalador y como favicon del portal.
- La portada del proyecto se usa en la página de bienvenida del instalador, en
  el README y en la imagen de presentación del repositorio.

---

## [1.0.0] — 2026-08-11

Primera versión funcional. Nace tras el terremoto de Colombia de agosto de 2026,
con un objetivo concreto: **localizar personas cuando no hay comunicaciones**.

### Portal cautivo

- Servidor DNS propio escrito sobre `dgram`, sin dependencias: responde
  cualquier dominio con la IP del puesto de mando.
- Intercepción de las sondas de conectividad de Android, iOS/macOS, Windows,
  Firefox y Ubuntu. Al conectarse al WiFi, **el formulario se abre solo**.
- Respuesta `AAAA` vacía sin error: sin esto algunos Android se cuelgan en vez
  de caer a IPv4.
- Latido del DNS cada 30 s que avisa si no llega ninguna consulta — el síntoma
  de que el router no está entregando nuestra IP como DNS.

### Censo y coordinación

- Registro con estado (atrapado, herido grave, herido leve, busca familiar,
  bien), necesidades, ubicación, acompañantes y a quién avisar.
- **Código pronunciable** por persona (`A-4821`), sin letras I ni O para no
  confundirlas con 1 y 0.
- Chat con el puesto de mando por WebSocket, **con respaldo automático por
  polling** cuando el WebSocket no levanta (habitual en el navegador del portal
  cautivo de iOS).
- Consola de operador que **se ordena sola por urgencia**: atrapado y herido
  grave al tope, atendidos al fondo.
- Aviso general a todas las personas conectadas.
- Exportación del censo a CSV para entregar a las autoridades.
- Marcador de **reporte dudoso**: baja de prioridad sin borrar, con motivo
  obligatorio y registro de quién lo marcó y cuándo. La persona nunca lo ve.

### Ubicación

- Canal HTTPS paralelo con certificado autofirmado, **solo** para desbloquear el
  GPS: los navegadores no entregan la ubicación fuera de contexto seguro.
- El certificado lleva la IP en `subjectAltName` y se regenera si la IP cambia.
  Sin eso los navegadores rechazan la conexión sin ofrecer continuar.
- Pantalla que explica **antes** de abrir la ventana qué aviso va a aparecer y
  qué botón tocar, con los pasos exactos por navegador.
- Camino manual alternativo (app Brújula en iPhone, Google Maps en Android).

### No perder a nadie

- Reconocimiento del teléfono **por su dirección MAC** vía tabla ARP: recupera
  la sesión aunque se pierdan cookie, token y código. Pregunta antes de
  entregarla, por si el teléfono lo usaron dos personas.
- Detección del mini-navegador del portal cautivo, con instrucciones para pasar
  al navegador real y botón para copiar la dirección.

### Dos modos de red

- **Modo router**: un router externo reparte DHCP. Más alcance y más gente.
- **Modo propio**: el punto de acceso es la tarjeta WiFi del equipo y el DHCP lo
  ponemos nosotros.
  - Servidor DHCP propio (RFC 2131) escrito sobre `dgram`.
  - Anuncia la URL del portal por **opción 114 (RFC 8910)**: el teléfono abre el
    portal sin depender del secuestro de DNS.
  - Misma MAC, misma IP: las sesiones sobreviven a las reconexiones.
  - La clave puede ir **dentro del nombre de la red** (`SOS-AYUDA-CLAVE-12345678`),
    así se lee en la lista de WiFi sin depender del cartel.
  - Detección de si el adaptador puede ser punto de acceso, con veredicto y
    motivo concreto.

### Uso responsable

- Aviso en cuatro puntos del recorrido: antes del formulario, pegado al botón de
  envío, como primer mensaje del chat y sobre el cuadro de escritura.
- El argumento no es la amenaza sino el coste para terceros: un reporte falso
  desvía una brigada y le quita el turno a alguien atrapado de verdad.

### Herramientas de operación

- **Panel de mando en WPF** con el log del servidor embebido: se acabaron las
  ventanas de consola que saltan al frente.
- Menú de texto equivalente (`CONSOLA.bat`) como respaldo.
- Diagnóstico previo al despliegue: red, puertos, firewall, ARP y batería.
- Respaldo y vaciado de la base con copia automática previa.
- Cartel imprimible con el nombre de la red y la dirección del portal.

### Distribución

- Instalador NSIS (79 MB) y versión portátil en ZIP (90 MB).
- **Node viaja dentro** (`runtime/node.exe`): no requiere instalar nada.
- El JavaScript se distribuye **sin empaquetar ni ofuscar**, a propósito.

### Licencia

- **GPL-3.0.** Elegida para que las mejoras vuelvan al proyecto: quien
  distribuya una versión modificada tiene que publicar sus cambios, y así están
  disponibles para quien los necesite en la siguiente emergencia.
- Se eligió la versión 3 y no la 2 porque una dependencia usa Apache-2.0, que es
  incompatible con la GPL-2.0 por su cláusula de patentes.
- [TERCEROS.md](TERCEROS.md) documenta las licencias de todos los componentes.
  Las 77 dependencias son permisivas (MIT, BSD-3-Clause, ISC, 0BSD, Apache-2.0)
  y ninguna impide la distribución bajo GPL.
- [CONTRIBUIR.md](CONTRIBUIR.md) recoge lo que más falta y los criterios de
  diseño del proyecto.

### Pruebas

- 100 pruebas end-to-end (`npm run prueba`), incluidas las sondas de portal
  cautivo, el canal HTTPS, el DHCP, la confidencialidad de las notas internas y
  la composición del nombre de red.

---

## Cómo se versiona esto

- **MAYOR** — cambios que rompen despliegues existentes (formato de la base,
  puertos, protocolo).
- **MENOR** — funcionalidad nueva compatible hacia atrás.
- **PARCHE** — correcciones.

Cada versión toca tres sitios, que deben coincidir:
`package.json`, `panel/PanelSOS.csproj` y `empaquetar/instalador.nsi`.
