# Guía de despliegue en terreno

Esta guía asume lo peor: no hay internet, no hay energía de red, hay ruido y prisa.
Sigue los pasos en orden. Los que dicen **EN CASA** haz­los antes de salir.

> **¿Solo quieres usarlo, sin programar nada?** Baja el instalador de la
> [página de versiones](https://github.com/cagd-dev/SOS.Ayuda.WiFi/releases),
> instálalo y salta al **paso 2**. No necesitas Node, ni .NET, ni tocar
> una línea de código: todo viaja dentro.

---

## 1. Qué necesitas

| Cosa | Detalle | Por qué |
|---|---|---|
| PC o portátil con Windows | 10 u 11. Con el instalador **no hace falta instalar nada más**. | Es el servidor. Sin él no hay portal. |
| WiFi | Un **router** comercial (recomendado), **o** la tarjeta WiFi del propio equipo. | Es por donde entra la gente. Ver paso 3. |
| Cable de red | Solo en modo router: del PC al puerto **LAN** (no WAN). | Deja libre el WiFi del PC. |
| Energía | UPS, planta, inversor de carro o power bank con salida AC. | Router y PC deben durar lo que dure la operación. |
| Cartel impreso | El panel lo genera listo para imprimir. | Si nadie sabe el nombre de la red, nadie se conecta. |

**Autonomía real:** un router de casa consume 5-10 W, un portátil 20-45 W.
Con una batería de carro de 60 Ah y un inversor tienes ~10-14 horas de los dos.

---

## 2. EN CASA — preparar el equipo

### Instalarlo

Baja **`SOS.Conectate.PideAyuda-Setup.exe`** de la
[página de versiones](https://github.com/cagd-dev/SOS.Ayuda.WiFi/releases) y
ejecútalo. Deja:

- El programa en `C:\Program Files\SOS Conectate Pide Ayuda`
- Los datos en `C:\ProgramData\SOS.Ayuda.WiFi` — separados a propósito, para que
  actualizar o desinstalar el programa no toque el censo
- Un acceso directo **SOS Panel de mando** en el escritorio y en el menú inicio

> **¿Prefieres no instalar?** Está también el ZIP portátil: se descomprime en una
> USB y se ejecuta `PanelSOS.exe`. En ese modo los datos viven **junto al
> programa**, que es lo que se espera de algo que va en el bolsillo.

### El panel de mando

Abre **SOS Panel de mando** y acepta el aviso de Administrador (hace falta para los
puertos 80, 443 y 53). Lo que ves:

| Zona | Qué es |
|---|---|
| **Cabecera** | Estado del portal y del DNS, censo en vivo, y el botón **☰ Ajustes y herramientas** |
| **Zona principal** | La **consola de operador embebida** — el puesto de trabajo real. Con pestañas para ver el portal como lo ve la gente, y el registro del servidor |
| **Cajón de ajustes** | Todo lo demás: arrancar, configurar, exportar, cerrar la operación. Se abre y se cierra con el botón ☰ |

El cajón arranca abierto (lo primero que hay que hacer es iniciar el portal) y **se
recoge solo en cuanto el portal arranca**, porque a partir de ahí lo que importa es
la consola. Vuelve con el mismo botón.

Dentro del cajón, por secciones:

| Sección | Qué tiene |
|---|---|
| Portal | Iniciar (puertos reales) · Iniciar en puertos altos · Iniciar en modo diagnóstico DNS · Detener |
| Modo de red | Router externo **o** punto de acceso propio (ver paso 3) |
| Configuración | Nombre del puesto, PIN y tarjeta de red. Botón para abrir los puertos en el firewall |
| Datos | Ver censo · Exportar CSV · Respaldar · Vaciar base |
| Cierre de operación | Los tres pasos del cierre guiado (ver paso 7) |
| Verificar | Diagnóstico · Prueba de humo · Emitir certificado nuevo del GPS |
| Abrir en el navegador | Consola · Portal · Cartel para imprimir · Carpeta de datos |

El panel **no deja hacer barbaridades**: no puedes vaciar la base con el portal
encendido, avisa antes de cerrarse si el portal está corriendo, y pide confirmación
para borrar o para emitir un certificado nuevo.

### El PIN de operador

**Se genera solo, aleatorio de seis dígitos, la primera vez que arranca.** Sale en
el registro del arranque y en el cajón de ajustes. Anótalo: es lo que abre la
consola, y detrás están los nombres, las cédulas y las ubicaciones de las víctimas.

Puedes cambiarlo por uno que recuerdes desde **Ajustes → Configuración → PIN de
operador → Guardar configuración**. Queda en `configuracion.json`, dentro de la
carpeta de datos.

### Si el panel falla

Cualquier error queda apuntado en **`panel-error.log`**, dentro de la carpeta de
datos, con fecha y traza completa. Es lo primero que hay que mirar, antes que el
Visor de eventos.

Si el panel no abre en absoluto, o si trabajas por escritorio remoto lento, está el
**menú de texto**: `CONSOLA.bat` en la carpeta del programa. Hace lo mismo y no
depende de .NET.

### Probar que todo responde antes de salir

Dos comprobaciones, ambas en **Ajustes → Verificar**:

1. **Diagnóstico previo al despliegue.** Revisa red, puertos, firewall, tabla ARP y
   batería. **No salgas a terreno hasta que diga `TODO LISTO`.**
2. **Prueba de humo end-to-end.** Levanta el sistema entero y lo ejercita. No debe
   fallar ninguna.

Puede haber pruebas **omitidas**: no son fallos, son cosas que no se pudieron
comprobar en ese arranque (por ejemplo el DNS, si el portal arrancó sin él).

Después, **detén el portal y vacía la base**: la prueba crea personas de ejemplo y
no pueden quedar mezcladas con gente real. El vaciado respalda antes de borrar y
**conserva el certificado**, así los celulares que ya aceptaron el aviso no lo
vuelven a ver.

> No borres la carpeta de datos a mano: ahí vive también el certificado del GPS, y
> borrarlo obliga a todos los celulares a aceptar el aviso otra vez.

---

## 2 bis. Si vas a tocar el código

Esta parte **no hace falta para operar**, solo para desarrollar.

Necesitas **Node.js 22.5 o superior** (por `node:sqlite`) y, para el panel, el
**SDK de .NET 8**. Con eso:

| Comando | Para qué |
|---|---|
| `npm start` | Levanta el sistema en los puertos 80 y 53 |
| `npm run puertos-altos` | Igual, en 8080/8443/5354, sin necesitar Administrador |
| `npm run consola` | El menú de texto |
| `npm run diagnostico` | Chequeo previo al despliegue |
| `npm run prueba` | Pruebas end-to-end (necesita el portal arriba) |
| `npm run prueba-cierre` | Pruebas del cierre de operación (no necesita el portal) |
| `npm run limpiar` | Respalda y vacía la base. Con `-- --todo` borra también el certificado |

`ARRANCAR.bat` es el atajo de desarrollo: instala dependencias la primera vez,
libera el puerto 53, aplica el firewall y abre el panel.

Para regenerar el ejecutable del panel:

```powershell
cd panel
dotnet publish -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o publicado
```

Y el distribuible completo (instalador + ZIP portátil):

```powershell
.\empaquetar\construir.ps1 -Instalador
```

El panel **no reimplementa nada**: llama a los mismos scripts de Node que el menú
de texto (`tools/estado.js`, `tools/exportar-csv.js`, `pruebas/humo.js`…). Por eso
los dos siempre hacen exactamente lo mismo y no pueden desincronizarse.

---

## 3. EN CASA — la red WiFi

Hay **dos modos**, y se eligen en el cajón de ajustes del panel.

### Modo router externo — el recomendado

Un router comercial reparte el WiFi y el DHCP; el PC solo sirve el portal. Es el
que da más alcance y aguanta más gente. Sigue leyendo el paso 3.1.

### Modo punto de acceso propio — sin router

El WiFi lo levanta **la tarjeta del propio equipo** y el DHCP lo pone el sistema.
Sirve cuando no hay router a mano. Hay **tres mecanismos**, y el sistema elige el
mejor que admita la tarjeta:

| Mecanismo | Clientes | Notas |
|---|---|---|
| Red hospedada | ~8 o más | El mejor, pero casi ningún driver moderno lo admite ya |
| Soft AP | ~8 | Lo que usa el «Punto de acceso móvil» de Windows |
| **Wi-Fi Direct (legacy)** | **2 a 8, según la tarjeta** | El comodín: está en casi cualquier adaptador actual |

Wi-Fi Direct emite un **SSID normal con clave WPA2**: cualquier teléfono se
conecta desde la lista de siempre, iPhone incluido. El tope de clientes lo pone
el driver y **puede ser tan bajo como 2**.

> Dos teléfonos es poquísimo al lado de un router. Pero en un punto con poca
> gente, poder atender a dos personas es infinitamente mejor que no poder
> atender a ninguna. Por eso la opción existe — y por eso el diagnóstico te dice
> el número **antes** de que salgas a terreno.

El panel trae el botón **«¿Puede esta tarjeta ser punto de acceso?»**, que
responde SÍ o NO, con qué mecanismo y con cuántos clientes admite.

**Si Windows no te deja fijar la IP** (hace falta Administrador), la tarjeta se
queda con la que él asigna, normalmente `192.168.137.1`. El diagnóstico te la
dice: o lanzas el panel elevado, o configuras el modo propio con *esa* IP para
que el DHCP reparta en su mismo segmento.

Windows **no permite red hospedada abierta**, así que hay clave obligatoria. Para
que la gente no dependa del cartel, el sistema puede **meter la clave dentro del
nombre de la red**: `SOS-AYUDA-CLAVE-12345678`. Se lee directamente en la lista de
redes del celular. El límite de un SSID son 32 bytes, y el panel avisa si no cabe.

---

## 3.1 Configurar el router

Entra a la administración del router (normalmente `192.168.0.1` o `192.168.1.1`).

### La red WiFi

- **Nombre (SSID):** `SOS-AYUDA` — corto, en mayúsculas, reconocible.
- **Seguridad:** **ABIERTA, sin contraseña.** Si pones clave, nadie entra.
- **Banda:** 2.4 GHz. Apaga la de 5 GHz si puedes: llega menos y divide clientes.
- **Canal:** 1, 6 u 11. Fijo, no automático.
- **Potencia de transmisión:** al máximo.
- **Aislamiento de clientes (AP isolation):** **déjalo APAGADO.** En varios firmwares
  no solo aísla los celulares entre sí, también les bloquea el acceso al cableado —
  y ahí es donde vive el servidor. Si lo enciendes, prueba con un celular que el
  portal siga cargando; si no carga, apágalo.

### La parte que hace funcionar el portal cautivo

En **DHCP / Red LAN**:

1. **DNS primario = la IP del servidor**, la que te diga el diagnóstico. Sea cual sea
   el rango del router (`192.168.0.x`, `192.168.1.x`, `10.0.0.x`…), el sistema no
   supone ninguno: detecta la suya y te la muestra.
2. **Borra el DNS secundario.** Si dejas uno (8.8.8.8 y compañía), el celular lo
   usará y **el portal no abrirá solo**. Este es el error #1.
3. **Reserva la IP del PC** por su MAC (DHCP estático), para que no cambie al
   reiniciar. Si cambia, todo deja de funcionar.
4. **Gateway/Puerta de enlace:** deja la del router.

### Un ejemplo completo: Tenda AC23

Es el router con el que se desarrolló y probó el sistema. **Los criterios valen para
cualquier router**, solo cambian los nombres de los menús. Ordenado por cuánto
alcance real te da cada cosa.

| Dónde | Ajuste | Valor | Por qué |
|---|---|---|---|
| Nombre y contraseña de red WiFi | Red de **5 GHz** | **APAGADA** | 5 GHz llega la mitad y atraviesa mucho peor. Si queda encendida, el *band steering* empuja los celulares a la banda mala. |
| Nombre y contraseña de red WiFi | SSID 2.4 GHz | `SOS-AYUDA`, **sin clave**, visible | Si pide clave u oculta el nombre, nadie entra. |
| Ancho de banda y canal | Ancho 2.4 GHz | **20 MHz** (no 40) | Contraintuitivo pero es el ajuste que más alcance da: la misma potencia concentrada en la mitad del espectro sube ~3 dB la densidad y baja el ruido. Nosotros movemos texto, no video. |
| Ancho de banda y canal | Canal | **1, 6 u 11 fijo** | Nunca "Auto": al recanalizar bota a todos. Escanea con una app y elige el más vacío. |
| Potencia de transmisión | 2.4 GHz | **Alta** | Es lo que ya tienes puesto. Déjalo. |
| Beamforming+ | | **Activar** | Enfoca la señal hacia cada celular en vez de radiar parejo. Ojo: el beamforming explícito es de 802.11ac y vive en 5 GHz — con la banda apagada su efecto en 2.4 GHz es pequeño y depende de que el celular lo soporte. Se deja porque no cuesta nada, no porque mueva la aguja. **Si con mucha gente ves desconexiones raras, es lo primero que apagas para descartar.** |
| Programación de WiFi | | **Desactivar** | Si se apaga el WiFi de madrugada, se cae el punto. |
| Wireless Repitiendo | | **Desactivar** | Convierte el router en repetidor y pierde su DHCP, que es justo lo que necesitamos. |
| WPS | | **Desactivar** | No sirve en red abierta y es superficie de ataque. |
| Antinterferencia | | Automático | Déjalo como está salvo que veas caídas. |
| **Modo PA** | | **NO ACTIVAR** | Es "modo Punto de Acceso": apaga el DHCP del router. Sin DHCP no podemos repartir nuestro DNS y **el portal deja de abrirse solo**. Este es el ajuste que más fácil rompe todo. |

En **Configuración avanzada → DHCP**:

- **DNS primario = la IP del servidor.** Secundario **vacío**.
- **Tiempo de concesión (lease): 1–2 horas.** El default suele ser un día; con gente
  entrando y saliendo se te agotan las IPs. Con lease corto se reciclan solas.
- Reserva por MAC la IP del servidor.

**El puerto WAN queda vacío.** El panel del Tenda va a mostrar "sin conexión a
internet" en rojo: ignóralo, es lo esperado. El WiFi y el DHCP funcionan igual.

**Antenas:** todas **verticales**. Un router irradia como una dona horizontal; las
antenas acostadas mandan la señal al cielo y al suelo. Si lo pones en alto para
cubrir hacia abajo, inclina 2 o 3 hacia afuera.

**Energía:** el AC23 usa 12 V. Para operar de batería de carro, **no lo conectes
directo** (una batería cargada da 12.6–14.4 V). Usa un convertidor buck regulado a
12.0 V — es mucho más eficiente que inversor a 110 V y de ahí al adaptador.

### El límite real no es el router

El AC23 grita fuerte: alta potencia y antenas de 6 dBi. **El celular no.** Responde
con ~15 dBm y una antena diminuta dentro de una carcasa.

Eso significa que un celular puede **ver la red con señal llena y aun así no lograr
registrarse**, porque el router lo oye a él pero él no logra que lo oigan. Es el
problema del enlace asimétrico.

**Consecuencia práctica:** no confíes en las barritas de señal. Camina con un celular
hasta donde vas a atender gente y comprueba que el **registro se completa de verdad**.
Ese punto donde deja de completarse es tu alcance real, y suele estar bastante antes
de donde desaparecen las barras.

### Verificar con un celular de verdad

Abre el panel, inicia el portal, conecta un celular al WiFi y comprueba que **el
formulario aparece solo**, sin teclear nada. Prueba con un Android **y** con un
iPhone: se comportan distinto.

---

## 4. EN TERRENO — arrancar

1. Enciende router y PC. Cable del PC al puerto **LAN** del router.
2. Abre **SOS Panel de mando**. Acepta el aviso de Administrador.
3. En **☰ Ajustes**, confirma que la **IP** es la que configuraste en el router.
   Si está mal, elígela en *Tarjeta de red / IP del servidor* y guarda.
4. **Iniciar el portal.** El cajón de ajustes se recoge solo y aparece la consola
   de operador; confirma arriba que el chip del **DNS** dice *activo*.
5. Mete el PIN en la consola y ya estás operando.
6. Imprime y pega los carteles (**Ajustes → Cartel para imprimir**).

> Todo lo demás sigue disponible mientras atiendes gente: abre el cajón con ☰ para
> exportar el censo, respaldar o ver el resumen, sin detener el portal.

### Colocación del router

- Lo más alto posible: sobre una mesa, un poste, el techo de un carro.
- Lejos de metal y concreto grueso.
- Al aire libre y en alto: 80-150 m. Entre edificios: 20-40 m.

---

## 5. Si algo falla

### EL PORTAL NO ABRE SOLO — diagnóstico en orden

Es el fallo más común. **No adivines: averigua primero dónde se corta.**
En el panel, **☰ Ajustes → Iniciar en modo diagnóstico DNS**, y mira la pestaña
**Registro**: verás cada consulta DNS que llegue, con la IP del teléfono. Con eso en
pantalla, olvida la red en un celular y vuelve a conectarte.

**Caso A — no aparece NINGUNA línea `[dns]`**

El celular no nos está preguntando. El problema está en el router, no aquí:

1. **El router se entrega a sí mismo como DNS.** Es lo más frecuente, y los Tenda
   lo hacen: actúan de relé DNS y reparten su propia IP LAN pase lo que pase.
   *Solución:* pon la IP del servidor como **DNS del WAN / Internet** del router.
   Entonces el router nos relevará las consultas y el portal vuelve a abrirse solo.
   Busca en *Configuración de Internet → DNS* o *Ajustes avanzados → DNS*.
2. **Quedó un DNS secundario** (8.8.8.8 o similar). Bórralo: el celular usa ese.
3. **El celular no renovó el DHCP.** Olvida la red y reconéctate, o apaga y
   enciende el WiFi. No basta con salir y volver a entrar de la pantalla.
4. **IPv6.** Si el router entrega IPv6, el celular puede preferir el DNS por esa
   vía y saltarse el nuestro. Apaga IPv6 en el router.
5. **DNS privado del celular** (Android: *Ajustes → Red → DNS privado*). Si está en
   un nombre fijo como `dns.google`, ignora nuestro DNS. Ponlo en *Desactivado* o
   *Automático*. Esto solo lo puedes arreglar teléfono por teléfono — otro motivo
   para que el cartel lleve la dirección IP escrita.

**Caso B — sí aparecen líneas `[dns]` pero el portal no abre**

El DNS funciona; el corte está en el HTTP:

1. **Firewall** bloqueando el puerto 80. **Ajustes → Abrir los puertos en el
   firewall**, o `netsh` como Administrador.
2. **Prueba directa:** desde el celular, entra a `http://<IP-del-servidor>`. Si el
   portal carga, es solo la detección automática lo que falla; si no carga, es
   firewall o ruta.
3. **El aviso salió y lo cerraron.** Android pregunta *"la red no tiene internet,
   ¿seguir conectado?"* — si responden que no, se va a datos móviles.

**Caso C — aparecen consultas de una sola IP que no es la del celular**

Es el router relevando (caso A.1 ya resuelto). Funciona igual.

---

| Síntoma | Causa casi siempre | Arreglo |
|---|---|---|
| El portal no abre solo | El router se reparte a sí mismo como DNS | Pon nuestra IP como DNS del **WAN** del router |
| El portal no abre solo | El router está repartiendo un DNS secundario | Bórralo en el DHCP del router |
| El portal no abre solo | El puerto 53 lo tiene Windows | Como Admin: `net stop dnscache` |
| El celular no carga nada | Firewall de Windows | Como Admin: `netsh advfirewall firewall add rule name="SOS Portal HTTP" dir=in action=allow protocol=TCP localport=80` |
| Android se va a datos móviles | Android abandona redes sin internet | Que el usuario responda **SÍ** a "seguir conectado" |
| iPhone: al cerrar la ventanita se cae el WiFi | Todavía no se ha registrado, así que iOS cree que abandonó el portal | Que se registre primero. Al quedar registrado el sistema suelta la red y ya puede cerrarla sin perder la conexión |
| iPhone: no deja abrir Safari | La red sigue marcada como «cautiva» | Igual: registrarse, o usar el botón **Salir a mi navegador** |
| "Puerto 80 ocupado" | IIS o el servicio HTTP | Como Admin: `net stop http`, o usa `npm run puertos-altos` |
| Va lentísimo con mucha gente | Router saturado | Ver límites abajo |

**Regla de oro:** si el portal automático falla, el sistema **sigue sirviendo**.
La gente teclea la dirección IP del cartel y entra igual.

### El GPS: cómo funciona y qué va a ver la gente

Los navegadores solo entregan la ubicación en **contexto seguro** (HTTPS). El portal
es HTTP puro porque la detección de portal cautivo lo exige. Por eso el sistema
levanta **un segundo canal en HTTPS, solo para el GPS**, con un certificado que se
genera solo la primera vez.

**El flujo que ve la persona:**

1. Se registra normalmente (HTTP, sin ningún aviso raro).
2. En la pantalla de "listo" aparece **"Enviar mi ubicación exacta (GPS)"**. Dentro
   del chat está siempre a mano en el botón **📍 Ubicación**, al lado de donde se
   escribe.
3. Al tocarlo **no se abre nada todavía**: primero sale una explicación con una
   maqueta del aviso que va a ver y qué botón exacto tocar en su navegador.
4. Recién ahí se abre la ventana segura, acepta el aviso, da permiso de ubicación
   y las coordenadas llegan a la ficha.

**Lo que ve el operador:** la coordenada llega al hilo del chat y a la ficha como
un **enlace a Google Maps**, con un botón **copiar** al lado. El enlace necesita
internet en el puesto de mando; el botón de copiar funciona siempre, y es lo que se
dicta por radio a la brigada.

**La consola de operador va por HTTPS.** Ahí viajan el PIN y los datos de las
víctimas, y esta red es abierta. Desde el panel de mando no notarás nada: la
consola viene embebida y el certificado se acepta solo. Desde otro equipo hay
que entrar a `https://<IP>/operador.html` y aceptar el aviso **una vez**; si
entras sin la **s**, te redirige. Si en algún equipo no hay forma de aceptar el
certificado, arranca con `SOS_ADMIN_HTTP=1` y vuelve a funcionar sin cifrar.

> **En iPhone hay un paso antes.** El GPS **no funciona dentro de la ventanita
> de conexión**: Apple no expone la ubicación a esa WebView, así que no hay
> permiso que activar. La persona tiene que salir a Safari primero — el portal
> lo detecta y se lo dice, con un botón que lo hace. Al quedar registrada, el
> sistema suelta la red y Safari empieza a funcionar con normalidad.

**El aviso de certificado es inevitable** — no existe forma de tener un certificado
válido sin internet. Por eso la pantalla previa es la pieza importante: sin ella la
gente se devuelve. Los textos ya están puestos para Chrome/Android, Safari/iPhone
y Firefox.

**Si la persona abandona en el aviso no se pierde nada:** ya quedó registrada, y el
GPS es solo un enriquecimiento. Puede volver a intentarlo cuando quiera desde el
botón 📍 del chat.

**Prueba esto con un celular real antes de salir.** Es la parte con más fricción de
todo el sistema.

**Sobre la seguridad, para que lo sepas tú:** un certificado autofirmado en WiFi
abierto no protege contra alguien malicioso dentro de la misma red — puede
suplantarlo. No estás peor que en el resto del portal, que va sin cifrar, pero no
le vendas a nadie que ese canal es "seguro" en sentido estricto. Sirve para
desbloquear el GPS, que es para lo que está.

**Si el canal HTTPS no arranca**, el portal lo detecta y muestra en su lugar cómo
copiar las coordenadas a mano (app Brújula en iPhone, mantener pulsado el punto azul
en Google Maps en Android). Ambas funcionan sin internet.

**Consecuencia operativa que no cambia:** insiste igual en la ubicación escrita.
Barrio, calle, piso y **algo que se vea desde afuera**. Entre edificios colapsados un
GPS de celular da 20-30 m de error, y un buen punto de referencia le sirve más a una
brigada que unas coordenadas imprecisas.

---

## 6. Límites reales — sé honesto con esto

- **Capacidad:** un router doméstico aguanta bien **20-40 celulares a la vez**.
  Con 60+ empieza a botar conexiones. Para más gente necesitas varios routers,
  cada uno con su propio PC, o un AP empresarial.
- **Alcance:** no esperes más de 100-150 m en línea de vista.
- **Sin internet:** los mensajes **no salen de esta red**. Sirve para hablar con
  el puesto de mando y para dejar constancia. No manda WhatsApp ni SMS.
- **Es HTTP sin cifrar en red abierta:** cualquiera con conocimientos puede leer
  el tráfico. En una emergencia el intercambio vale la pena, pero **avísale a la
  gente que no escriba contraseñas ni datos bancarios**. El cartel ya lo dice.

---

## 7. Los datos de las personas

La base contiene nombres, cédulas, teléfonos y ubicaciones de víctimas. Trátala
como lo que es.

**Dónde está**, según cómo lo hayas puesto:

| Forma de uso | Carpeta de datos |
|---|---|
| Instalado con el `.exe` | `C:\ProgramData\SOS.Ayuda.WiFi` |
| Portátil (ZIP en una USB) | `datos\` junto al programa |

El panel te la abre con el botón **"Abrir la carpeta de datos"**, y hay un acceso
directo en el menú inicio. No hace falta que recuerdes la ruta.

Durante la operación:

- **Respalda** cada jornada y copia a una USB. El respaldo se verifica solo.
- No publiques la lista completa en redes sociales.

### Cuando la operación termine: el cierre guiado

No borres la carpeta a mano. El panel tiene un **cierre de operación** en tres
pasos que deja constancia de lo que se hizo:

**1. Cerrar la operación.** Genera el censo definitivo en CSV, un respaldo
verificado y la huella SHA-256 del archivo. Ese CSV es el que se entrega.

**2. Registrar la entrega.** Anota a quién se lo diste (Defensa Civil, Cruz
Roja, UNGRD, alcaldía), su contacto y por qué medio. Es obligatorio decir a
quién: es lo que queda cuando los datos ya no existan.

**3. Destruir los datos personales.** Solo se habilita **30 días después de la
entrega**, por si la autoridad necesita una aclaración. Se puede hacer antes,
pero exige escribir un motivo que queda registrado.

Al purgar se borran base, respaldos y CSV, y queda
**`CONSTANCIA-DE-CIERRE.txt`**: cuántas personas hubo, a quién se entregó el
archivo, su huella digital y quién destruyó los datos.

> **Guarda esa constancia.** Es tu prueba de que los datos se entregaron a quien
> correspondía y se destruyeron después — y no contiene ni un dato personal, así
> que la puedes archivar sin problema.

El desinstalador **no borra el censo**: destruir datos de víctimas sin
constancia sería justo lo contrario de lo que busca este flujo.

---

## 8. Si lo montas en una máquina virtual

Es buena idea: la VM queda limpia, dedicada, y no pelea con el DNS ni el puerto 80
de tu equipo de trabajo. Pero hay un ajuste que **tiene que estar bien o nada funciona**:

> **La tarjeta de red de la VM debe estar en modo PUENTE (Bridged), no NAT.**

Con NAT la VM vive detrás del anfitrión y los celulares del router jamás la
alcanzan. En modo puente la VM pide su propia IP al router y aparece en la red
como una máquina más, que es justo lo que necesitamos.

- **VMware:** Configuración de la VM → Network Adapter → **Bridged (Automatic)**.
  Si el anfitrión tiene varias tarjetas, en *Bridged: Replicate physical network
  connection state* elige explícitamente la tarjeta conectada al router.
- **VirtualBox:** Red → Conectado a: **Adaptador puente** → Nombre: la tarjeta del router.
- **Hyper-V:** crea un *Conmutador virtual* de tipo **Externo** ligado a la tarjeta física.

Después, dentro de la VM, corre el **diagnóstico** (**Ajustes → Verificar**) y
comprueba tres cosas:

1. **La IP detectada está en el mismo rango que el router.** Da igual cuál sea ese
   rango — `192.168.0.x`, `192.168.1.x`, `10.0.0.x` — el sistema no supone ninguno.
   Lo que no debe salir es una IP de VMware/VirtualBox (`10.0.2.x`, `172.16.x.x`):
   eso significa NAT. Si hay varias tarjetas, elígela en *Ajustes → Configuración*.
2. **La sección "Reconocimiento de teléfonos" dice OK.** Si dice que no ve
   dispositivos en tu segmento, casi siempre es NAT en vez de puente. Sin esto el
   portal funciona igual, pero quien pierda su código tendrá que registrarse otra vez.
3. **El firewall.** La VM trae el suyo, independiente del anfitrión: *Ajustes →
   Abrir los puertos en el firewall*.

Esa IP detectada es la que va en el DHCP del router como DNS primario, y la que
reservas por MAC.

**Sobre el portátil:** llévalo aunque el servidor viva en la VM. Te sirve como
consola de operador por WiFi (entra a `https://<IP>/operador.html` — con **s**, y
acepta el aviso del certificado una vez) y como respaldo
completo: instala ahí el mismo `.exe` y tienes el sistema en pie otra vez. Si el
servidor vive en el portátil, ten presente que **al cerrar la tapa se suspende y se
cae el portal**: pon el plan de energía en "nunca suspender".

---

## 9. Escalar a varios puntos

Cada punto es independiente: su propio router + su propio PC + su propia base.
Al final del día se juntan los CSV. No hay sincronización automática entre puntos
— y está bien, porque la simplicidad es lo que hace que esto no se caiga.
