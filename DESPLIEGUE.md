# Guía de despliegue en terreno

Esta guía asume lo peor: no hay internet, no hay energía de red, hay ruido y prisa.
Sigue los pasos en orden. Los que dicen **EN CASA** haz­los antes de salir.

---

## 1. Qué necesitas

| Cosa | Detalle | Por qué |
|---|---|---|
| Router WiFi | Cualquiera comercial. Mejor si es de 2.4 GHz con antenas externas. | 2.4 GHz llega más lejos y atraviesa mejor escombro y pared que 5 GHz. |
| PC o portátil | Con Node.js 22 o superior. | Es el servidor. Sin él no hay portal. |
| Cable de red | Del PC al router, puerto **LAN** (no WAN). | El WiFi del PC lo dejamos libre. |
| Energía | UPS, planta, inversor de carro o power bank con salida AC. | Router y PC deben durar lo que dure la operación. |
| Cartel impreso | `public/cartel.html` → imprimir. | Si nadie sabe el nombre de la red, nadie se conecta. |

**Autonomía real:** un router de casa consume 5-10 W, un portátil 20-45 W.
Con una batería de carro de 60 Ah y un inversor tienes ~10-14 horas de los dos.

---

## 2. EN CASA — preparar el equipo

**Todo se hace desde `ARRANCAR.bat`.** Doble clic, acepta el aviso de Administrador,
y se abre el **panel de mando**: una ventana con el estado arriba, los botones a la
izquierda y el registro del servidor en vivo a la derecha.

Lo importante del panel: **el portal corre dentro de él**. No se abren ventanas de
consola sueltas que salten al frente, y el log del servidor se ve en el mismo sitio
donde están los botones.

| Zona | Qué tiene |
|---|---|
| Cabecera | Portal corriendo/detenido, estado del DNS, aviso si el PIN sigue siendo el de fábrica |
| Censo | Total, atrapados, heridos y mensajes sin leer, actualizado solo cada 3 s |
| Portal | Iniciar (puertos reales) · Iniciar en puertos altos · Iniciar en modo diagnóstico DNS · Detener |
| Configuración | Nombre del puesto, PIN y tarjeta de red, editables ahí mismo. Botón para abrir los puertos en el firewall |
| Datos | Ver censo · Exportar CSV · Respaldar · Vaciar base |
| Verificar | Diagnóstico · Prueba de humo · Emitir certificado nuevo del GPS |
| Abrir en el navegador | Consola de operador · Portal · Cartel para imprimir |

El panel **no deja hacer barbaridades**: no puedes vaciar la base con el portal
encendido, avisa antes de cerrarse si el portal está corriendo, y pide confirmación
para borrar o para emitir un certificado nuevo.

### Si el panel falla

Cualquier error queda apuntado en **`datos/panel-error.log`** con fecha y traza
completa. Es lo primero que hay que mirar, antes que el Visor de eventos.

Si el panel no abre en absoluto, usa `CONSOLA.bat`: hace exactamente lo mismo y no
depende de .NET.

### Si el panel no está disponible

`CONSOLA.bat` abre el **menú de texto**, que hace exactamente lo mismo. Sirve por
escritorio remoto lento, si falta .NET, o si el panel falla. Este es su aspecto:

```
   Puesto  : Puesto de Mando SOS
   IP      : 192.168.0.150  (automatica)
   Portal  : detenido
   Censo   : base vacia
   PIN     : 1234   <-- CAMBIALO (opcion 5)
   GPS     : certificado listo

   PORTAL
    1. Iniciar el portal            (puertos 80 / 443 / 53)
    2. Iniciar en puertos altos     (pruebas, sin Administrador)
    3. Iniciar en modo diagnostico  (¿el portal no abre solo?)
    4. Detener el portal

   CONFIGURAR
    5. Cambiar el PIN de operador
    6. Cambiar el nombre del puesto
    7. Elegir la tarjeta de red / IP
    8. Abrir los puertos en el firewall

   DATOS
    9. Ver resumen del censo
   10. Exportar el censo a CSV
   11. Respaldar la base de datos
   12. Vaciar la base de datos

   VERIFICAR
   13. Diagnostico previo al despliegue
   14. Prueba de humo end-to-end
   15. Emitir un certificado nuevo para el GPS

    0. Salir
```

**El portal arranca en su propia ventana**, así que este menú nunca se bloquea:
puedes configurar, exportar o correr pruebas con el portal funcionando. Para
detenerlo usa la **opción 4** (o Ctrl+C en la ventana del portal).

El `.bat` instala las dependencias solo la primera vez (necesita internet), libera
el puerto 53 y aplica las reglas de firewall antes de abrir el panel.

Antes de salir, corre el **diagnóstico**: revisa red, puertos, firewall, ARP y
batería. **No salgas a terreno hasta que diga `TODO LISTO`.**

> Si prefieres la línea de comandos, todo tiene su equivalente:
> `npm start`, `npm run diagnostico`, `npm run prueba`, `npm run limpiar`,
> `npm run consola`.

### Compilar el panel (solo si hace falta)

El ejecutable ya está en `panel/publicado/PanelSOS.exe`. Es **autocontenido**
(~63 MB): no necesita que la VM tenga instalado .NET. Si alguna vez hay que
regenerarlo, con el SDK de .NET 8 o superior:

```powershell
cd panel
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o publicado
```

El panel **no reimplementa nada**: llama a los mismos scripts de Node que el menú
de texto (`tools/estado.js`, `tools/exportar-csv.js`, `pruebas/humo.js`…). Por eso
los dos siempre hacen exactamente lo mismo y no pueden desincronizarse.

### Cambiar el PIN de operador

El PIN de fábrica es `1234`. En la consola hay nombres, cédulas y ubicaciones de
víctimas, así que cámbialo: **`ARRANCAR.bat` → opción 5**. Queda guardado en
`datos/configuracion.json` y se aplica al arrancar el portal.

Mientras siga siendo `1234`, tanto el menú como el banner de arranque te lo
recuerdan.

### Probar que todo responde

**Opción 14**. Si el portal no está corriendo, te ofrece arrancarlo en puertos altos
y sigue sola. No debe fallar ninguna prueba.

Puede haber pruebas **omitidas**: no son fallos, son cosas que no se pudieron
comprobar en ese arranque (por ejemplo el DNS, si el portal arrancó sin él).

Después, detén el portal con la **opción 4** y vacía la base con la **opción 12** —
la prueba crea personas de ejemplo y no deben quedar mezcladas con gente real.

Respalda la base en `datos/respaldos/` antes de borrarla, y **conserva el
certificado** — así los celulares que ya aceptaron el aviso no lo vuelven a ver.
Si necesitas emitir uno nuevo (por ejemplo, porque cambió la IP), usa
`npm run limpiar -- --todo`.

> No borres la carpeta `datos/` a mano: ahí vive también el certificado, y
> borrarlo hace que todos los celulares tengan que aceptar el aviso otra vez.

---

## 3. EN CASA — configurar el router

Entra a la administración del router (normalmente `192.168.0.1` o `192.168.1.1`).

### 3.1 La red WiFi

- **Nombre (SSID):** `SOS-AYUDA` — corto, en mayúsculas, reconocible.
- **Seguridad:** **ABIERTA, sin contraseña.** Si pones clave, nadie entra.
- **Banda:** 2.4 GHz. Apaga la de 5 GHz si puedes: llega menos y divide clientes.
- **Canal:** 1, 6 u 11. Fijo, no automático.
- **Potencia de transmisión:** al máximo.
- **Aislamiento de clientes (AP isolation):** **déjalo APAGADO.** En varios firmwares
  no solo aísla los celulares entre sí, también les bloquea el acceso al cableado —
  y ahí es donde vive el servidor. Si lo enciendes, prueba con un celular que el
  portal siga cargando; si no carga, apágalo.

### 3.2 La parte que hace funcionar el portal cautivo

En **DHCP / Red LAN**:

1. **DNS primario = la IP del servidor**, la que te diga el diagnóstico. Sea cual sea
   el rango del router (`192.168.0.x`, `192.168.1.x`, `10.0.0.x`…), el sistema no
   supone ninguno: detecta la suya y te la muestra.
2. **Borra el DNS secundario.** Si dejas uno (8.8.8.8 y compañía), el celular lo
   usará y **el portal no abrirá solo**. Este es el error #1.
3. **Reserva la IP del PC** por su MAC (DHCP estático), para que no cambie al
   reiniciar. Si cambia, todo deja de funcionar.
4. **Gateway/Puerta de enlace:** deja la del router.

### 3.3 Configuración específica: Tenda AC23

Ordenado por cuánto alcance real te da cada cosa.

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

### 3.4 El límite real no es el router

El AC23 grita fuerte: alta potencia y antenas de 6 dBi. **El celular no.** Responde
con ~15 dBm y una antena diminuta dentro de una carcasa.

Eso significa que un celular puede **ver la red con señal llena y aun así no lograr
registrarse**, porque el router lo oye a él pero él no logra que lo oigan. Es el
problema del enlace asimétrico.

**Consecuencia práctica:** no confíes en las barritas de señal. Camina con un celular
hasta donde vas a atender gente y comprueba que el **registro se completa de verdad**.
Ese punto donde deja de completarse es tu alcance real, y suele estar bastante antes
de donde desaparecen las barras.

### 3.5 Verificar con un celular de verdad

Enciende el servidor (`ARRANCAR.bat`), conecta un celular al WiFi y comprueba
que **el formulario aparece solo**, sin teclear nada. Prueba con un Android **y**
con un iPhone: se comportan distinto.

---

## 4. EN TERRENO — arrancar

1. Enciende router y PC. Cable del PC al puerto **LAN** del router.
2. Doble clic en **`ARRANCAR.bat`**. Acepta el aviso de Administrador.
3. Mira la cabecera del menú: confirma que la **IP** es la que configuraste en el
   router y que el **PIN** ya no es `1234`. Si la IP está mal, opción 7.
4. **Opción 1** para arrancar el portal. Se abre en su propia ventana y el menú
   queda libre; confirma que la línea **DNS** dice *activo*.
5. Abre la consola de operador: `http://<IP>/operador.html` y mete el PIN.
6. Pega los carteles.

> El portal corre aparte, así que puedes seguir usando el menú mientras atiende
> gente: exportar el censo, respaldar, ver el resumen. Para detenerlo, **opción 4**.

### Colocación del router

- Lo más alto posible: sobre una mesa, un poste, el techo de un carro.
- Lejos de metal y concreto grueso.
- Al aire libre y en alto: 80-150 m. Entre edificios: 20-40 m.

---

## 5. Si algo falla

### EL PORTAL NO ABRE SOLO — diagnóstico en orden

Es el fallo más común. **No adivines: averigua primero dónde se corta.**
Arranca con `ARRANCAR.bat` → **opción 3 (modo diagnóstico)**. Verás cada consulta
DNS que llegue, con la IP del teléfono. Con eso en pantalla, olvida la red en un
celular y vuelve a conectarte.

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

1. **Firewall** bloqueando el puerto 80. Opción 8 del menú, o `netsh` como Admin.
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
| iPhone cierra la ventanita | Comportamiento normal del iOS | Que abra Safari y entre a la IP; el cartel la muestra |
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
2. En la pantalla de "listo" aparece **"Enviar mi ubicación exacta (GPS)"**.
3. Al tocarlo **no se abre nada todavía**: primero sale una explicación con una
   maqueta del aviso que va a ver y qué botón exacto tocar en su navegador.
4. Recién ahí se abre la ventana segura, acepta el aviso, da permiso de ubicación
   y las coordenadas llegan a la ficha.

**El aviso de certificado es inevitable** — no existe forma de tener un certificado
válido sin internet. Por eso la pantalla previa es la pieza importante: sin ella la
gente se devuelve. Los textos ya están puestos para Chrome/Android, Safari/iPhone
y Firefox.

**Si la persona abandona en el aviso no se pierde nada:** ya quedó registrada, y el
GPS es solo un enriquecimiento. También queda disponible después desde el chat, en
"Mi estado".

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

`datos/sos.sqlite3` contiene nombres, cédulas, teléfonos y ubicaciones de
víctimas. Trátalo como lo que es.

- **Respalda** la carpeta `datos/` a una USB al terminar cada jornada.
- **Exporta a CSV** desde la consola y entrégalo a la autoridad competente
  (Defensa Civil, Cruz Roja, UNGRD, alcaldía).
- **Borra** la base cuando la operación termine y los datos ya estén entregados.
- No publiques la lista completa en redes sociales.

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

Después, dentro de la VM, corre el **diagnóstico** (opción 13) y comprueba tres cosas:

1. **La IP detectada está en el mismo rango que el router.** Da igual cuál sea ese
   rango — `192.168.0.x`, `192.168.1.x`, `10.0.0.x` — el sistema no supone ninguno.
   Lo que no debe salir es una IP de VMware/VirtualBox (`10.0.2.x`, `172.16.x.x`):
   eso significa NAT. Si hay varias tarjetas, fíjala con la opción 7.
2. **La sección "Reconocimiento de teléfonos" dice OK.** Si dice que no ve
   dispositivos en tu segmento, casi siempre es NAT en vez de puente. Sin esto el
   portal funciona igual, pero quien pierda su código tendrá que registrarse otra vez.
3. **El firewall.** La VM trae el suyo, independiente del anfitrión: opción 8.

Esa IP detectada es la que va en el DHCP del router como DNS primario, y la que
reservas por MAC.

**Sobre el portátil:** llévalo aunque el servidor viva en la VM. Te sirve como
consola de operador por WiFi (entra a `http://<IP>/operador.html`) y como respaldo
completo: copias la carpeta, corres `ARRANCAR.bat` y tienes el sistema en pie otra
vez. Si el servidor vive en el portátil, ten presente que **al cerrar la tapa se
suspende y se cae el portal**: pon el plan de energía en "nunca suspender".

---

## 9. Escalar a varios puntos

Cada punto es independiente: su propio router + su propio PC + su propia base.
Al final del día se juntan los CSV. No hay sincronización automática entre puntos
— y está bien, porque la simplicidad es lo que hace que esto no se caiga.
