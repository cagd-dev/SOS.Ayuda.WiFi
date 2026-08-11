# Cómo contribuir

Esta herramienta existe porque alguien la necesitó de urgencia. Si la mejoras,
esa mejora le puede servir a la siguiente persona que la despliegue en una
emergencia. Por eso el proyecto es **GPL-3.0**: lo que construyas sobre esto
vuelve a estar disponible para todos.

No hace falta permiso para empezar. Abre un *issue* si quieres discutirlo antes,
o manda directamente un *pull request*.

## Lo que más falta ahora mismo

| Necesidad | Por qué importa |
|---|---|
| **Probar el modo punto de acceso** con adaptadores que sí lo admitan | Está construido pero no verificado con hardware real |
| **Probar en teléfonos reales**, sobre todo el paso del aviso de certificado del GPS | Es el punto con más fricción de todo el sistema |
| Traducción de la interfaz | Hoy solo está en español |
| Soporte de Linux para el servidor | El código de red usa `netsh` en varias partes |
| Relevo de mensajes cuando aparece algún enlace a internet | Hoy los mensajes no salen de la red local |

## Antes de mandar un cambio

```powershell
npm start          # en una ventana
npm run prueba     # en otra
```

**Las 100 pruebas tienen que seguir en verde.** Si tu cambio añade
funcionalidad, añade pruebas: `pruebas/humo.js` está escrito para que agregar
una comprobación sea una línea.

Después, deja la base limpia:

```powershell
npm run limpiar
```

## Criterios que sigue este proyecto

No son caprichos de estilo, salen de dónde se usa esto:

- **Nada que haya que compilar en terreno.** Sin dependencias nativas. Por eso
  la base de datos usa `node:sqlite` y no `better-sqlite3`, y el DNS y el DHCP
  están escritos a mano sobre `dgram`.
- **Que falle diciendo qué hacer.** Un mensaje de error tiene que traer el
  comando que lo arregla. Quien opere esto va a estar cansado y con prisa.
- **Degradar, no romper.** Si el WebSocket no levanta, hay polling. Si el GPS no
  está disponible, hay instrucciones manuales. Si el DNS falla, la dirección va
  en el cartel.
- **Nada de datos internos hacia la persona.** Las notas del operador y la marca
  de reporte dudoso no salen nunca del puesto de mando. Hay pruebas dedicadas a
  esto; no las quites.
- **Comentarios que expliquen el porqué**, no el qué. Los que hay marcan trampas
  reales que costaron encontrar.
- **Español sin acentos en el código**, con acentos en la documentación. Es para
  evitar problemas de codificación en consolas de Windows.

## Añadir dependencias

Piénsalo dos veces: cada una es algo que puede fallar en un despliegue sin
internet. Si aun así hace falta, **comprueba su licencia** — ver
[TERCEROS.md](TERCEROS.md). Una licencia incompatible con GPL-3.0 haría
imposible distribuir el proyecto.

## Versionado

Ver el final de [CHANGELOG.md](CHANGELOG.md). Recuerda que la versión vive en
tres archivos que deben coincidir: `package.json`, `panel/PanelSOS.csproj` y
`empaquetar/instalador.nsi`.
