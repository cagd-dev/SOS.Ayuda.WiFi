using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;

namespace PanelSOS;

public partial class MainWindow : Window
{
    private readonly Nodo _nodo = new();
    private readonly DispatcherTimer _reloj = new() { Interval = TimeSpan.FromSeconds(3) };
    private EstadoSistema _estado = EstadoSistema.Vacio();
    private bool _ocupado;

    /* Vista principal: consola de operador, portal, o el registro del servidor. */
    private enum Vista { Consola, Portal, Registro }
    private Vista _vista = Vista.Consola;

    private bool _webListo;          // WebView2 inicializado correctamente
    private bool _webInicializando;  // hay una inicializacion en vuelo
    private bool _webImposible;      // no se pudo: se abre en el navegador
    private string _urlCargada = ""; // para no recargar en cada tick del reloj

    public MainWindow()
    {
        InitializeComponent();

        _nodo.Salida += (texto, esError) =>
            Dispatcher.Invoke(() => Escribir(texto, esError));

        _nodo.ServidorTermino += () => Dispatcher.Invoke(async () =>
        {
            Escribir("");
            Escribir("── El portal se detuvo ──");
            await RefrescarAsync();
        });

        _reloj.Tick += async (_, _) => { if (!_ocupado) await RefrescarAsync(); };

        Loaded += async (_, _) => await ArrancarAsync();
        Closing += (_, e) =>
        {
            if (!_nodo.ServidorActivo) return;
            var r = MessageBox.Show(
                "El portal esta CORRIENDO. Si cierras el panel, se detiene y la gente " +
                "dejara de poder conectarse.\n\n¿Cerrar de todas formas?",
                "Panel SOS", MessageBoxButton.YesNo, MessageBoxImage.Warning);
            if (r != MessageBoxResult.Yes) { e.Cancel = true; return; }
            _nodo.DetenerServidor();
        };
    }

    /* ---------------------------------------------------------------- */
    /* Arranque y refresco                                              */
    /* ---------------------------------------------------------------- */

    private async Task ArrancarAsync()
    {
        Escribir("SOS · Conectate · Pide Ayuda — panel de mando");
        Escribir($"Proyecto: {Proyecto.Raiz}");

        if (!Proyecto.ProyectoValido)
        {
            Escribir("", true);
            Escribir("NO SE ENCONTRO EL PROYECTO.", true);
            Escribir("Este panel debe vivir dentro de la carpeta del proyecto, junto a src\\server.js.", true);
            DeshabilitarTodo();
            return;
        }

        var nodo = Proyecto.RutaNode();
        Escribir(nodo is null ? "Node.js: NO ENCONTRADO" : $"Node.js: {nodo}", nodo is null);
        if (nodo is null)
        {
            Escribir("Instala Node.js 22 o superior desde https://nodejs.org y vuelve a abrir el panel.", true);
            DeshabilitarTodo();
            return;
        }

        if (!Proyecto.DependenciasInstaladas)
        {
            Escribir("");
            Escribir("Faltan las dependencias (node_modules). Ejecuta 'npm install' una vez, con internet.", true);
        }

        if (!Proyecto.EsAdministrador())
        {
            btnAdmin.Visibility = Visibility.Visible;
            Escribir("");
            Escribir("Sin permisos de Administrador: los puertos 80/443/53 y las reglas de");
            Escribir("firewall pueden fallar. Usa el boton de arriba a la derecha si hace falta.");
        }

        Escribir("");
        await RefrescarAsync();
        _reloj.Start();
    }

    private async Task RefrescarAsync()
    {
        var (codigo, salida) = await _nodo.EjecutarAsync(Path.Combine("tools", "estado.js"));
        if (codigo != 0 || string.IsNullOrWhiteSpace(salida)) return;

        try { _estado = EstadoSistema.Desde(salida); }
        catch { return; } // JSON incompleto: reintentamos en el siguiente tick

        PintarEstado();
    }

    private void PintarEstado()
    {
        txtPuestoCabecera.Text = _estado.Puesto;
        txtTotal.Text = _estado.Personas.ToString();
        txtAtrapados.Text = _estado.Atrapados.ToString();
        txtHeridos.Text = _estado.Heridos.ToString();
        txtSinLeer.Text = _estado.SinLeer.ToString();

        var activo = _estado.PortalActivo || _nodo.ServidorActivo;

        txtPortal.Text = activo ? "PORTAL CORRIENDO" : "PORTAL DETENIDO";
        txtPortal.Foreground = new SolidColorBrush(activo
            ? Color.FromRgb(0x3F, 0xB9, 0x50) : Color.FromRgb(0xF8, 0x51, 0x49));
        chipPortal.Background = new SolidColorBrush(activo
            ? Color.FromRgb(0x10, 0x26, 0x1A) : Color.FromRgb(0x2D, 0x12, 0x14));

        // Que el DNS no arranque es silencioso y rompe el portal cautivo entero:
        // aqui tiene que verse sin buscarlo.
        chipDns.Visibility = activo ? Visibility.Visible : Visibility.Collapsed;
        if (activo)
        {
            var hayDns = _estado.PuertoDns > 0;
            txtDns.Text = hayDns ? $"DNS activo ({_estado.PuertoDns})" : "DNS APAGADO — no abrira solo";
            txtDns.Foreground = new SolidColorBrush(hayDns
                ? Color.FromRgb(0x3F, 0xB9, 0x50) : Color.FromRgb(0xF8, 0x51, 0x49));
            chipDns.Background = new SolidColorBrush(hayDns
                ? Color.FromRgb(0x10, 0x26, 0x1A) : Color.FromRgb(0x2D, 0x12, 0x14));
        }

        chipPin.Visibility = _estado.PinDeFabrica ? Visibility.Visible : Visibility.Collapsed;

        btnIniciar.IsEnabled = !activo && !_ocupado;
        btnIniciarPruebas.IsEnabled = !activo && !_ocupado;
        btnIniciarDiag.IsEnabled = !activo && !_ocupado;
        btnDetener.IsEnabled = activo && !_ocupado;
        btnVaciar.IsEnabled = !activo && !_ocupado;

        btnAbrirOperador.IsEnabled = activo;
        btnAbrirPortal.IsEnabled = activo;
        btnAbrirCartel.IsEnabled = activo;

        // No pisamos lo que el operador este escribiendo.
        if (!cajaPuesto.IsFocused) cajaPuesto.Text = _estado.Puesto;
        if (!cajaPin.IsFocused) cajaPin.Text = _estado.Pin;

        _pintandoModo = true;
        if (!listaModo.IsDropDownOpen && listaModo.SelectedIndex == -1)
        {
            listaModo.SelectedIndex = _estado.ModoPropio ? 1 : 0;
        }
        if (!cajaNombreRed.IsFocused) cajaNombreRed.Text = _estado.NombreBase;
        if (!cajaClaveRed.IsFocused) cajaClaveRed.Text = _estado.Clave;
        _pintandoModo = false;

        PintarCierre();

        zonaPuntoAcceso.Visibility = listaModo.SelectedIndex == 1 ? Visibility.Visible : Visibility.Collapsed;
        zonaIpServidor.Visibility = listaModo.SelectedIndex == 1 ? Visibility.Collapsed : Visibility.Visible;
        if (!cajaNombreRed.IsFocused && !cajaClaveRed.IsFocused) RedCambiada(this, new RoutedEventArgs());

        if (!listaAdaptadores.IsDropDownOpen && listaAdaptadores.Items.Count != _estado.Adaptadores.Count + 1)
        {
            listaAdaptadores.Items.Clear();
            listaAdaptadores.Items.Add("Deteccion automatica");
            foreach (var a in _estado.Adaptadores) listaAdaptadores.Items.Add(a);

            listaAdaptadores.SelectedIndex = 0;
            if (_estado.IpFijada)
            {
                for (var i = 0; i < _estado.Adaptadores.Count; i++)
                {
                    if (_estado.Adaptadores[i].Ip == _estado.Ip) { listaAdaptadores.SelectedIndex = i + 1; break; }
                }
            }
        }

        txtPie.Text = activo
            ? $"Portal en {_estado.UrlBase}   ·   consola de operador en {_estado.UrlBase}/operador.html"
            : $"IP del servidor: {_estado.Ip}{(_estado.IpFijada ? " (fijada)" : " (automatica)")}   ·   portal detenido";

        txtPieDerecha.Text =
            $"datos en {_estado.CarpetaDatos}" +
            $"   ·   {(Proyecto.EsAdministrador() ? "Administrador" : "sin elevar")}";

        PintarVista();
    }

    /* ---------------------------------------------------------------- */
    /* Vista principal                                                   */
    /* ---------------------------------------------------------------- */

    /// <summary>
    /// El cajon de ajustes se abre y se cierra con el boton de la cabecera.
    /// Arranca abierto porque lo primero que hay que hacer es iniciar el
    /// portal, y se cierra solo en cuanto el portal arranca: a partir de ahi
    /// lo que importa es la consola, no los botones de configuracion.
    /// </summary>
    private void AlternarAjustes_Click(object sender, RoutedEventArgs e)
        => MostrarAjustes(columnaAjustes.Width.Value == 0);

    private void MostrarAjustes(bool visible)
    {
        columnaAjustes.Width = new GridLength(visible ? 345 : 0);
        cajonAjustes.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
        btnAjustes.Content = visible ? "☰  Ocultar ajustes" : "☰  Ajustes y herramientas";
    }

    private void Pestana_Click(object sender, RoutedEventArgs e)
    {
        _vista =
            ReferenceEquals(sender, pestanaPortal) ? Vista.Portal :
            ReferenceEquals(sender, pestanaRegistro) ? Vista.Registro : Vista.Consola;
        PintarVista();
    }

    /// <summary>
    /// La consola de operador se carga por el canal CIFRADO cuando existe.
    /// Ahi viajan el PIN, la sesion y los datos de las victimas, y la red de
    /// emergencia es abierta: capturar trafico en ella es trivial.
    ///
    /// Dentro del panel esto no le cuesta nada al operador —WebView2 acepta el
    /// certificado autofirmado sin preguntar— y si el HTTPS no arranco se cae
    /// a HTTP en vez de dejarlo sin consola.
    ///
    /// El portal de la gente se mira SIEMPRE por HTTP: es lo que ven ellos.
    /// </summary>
    private string UrlDeLaVista() => _vista switch
    {
        Vista.Portal => _estado.UrlBase,
        _ => string.IsNullOrWhiteSpace(_estado.UrlSegura)
            ? $"{_estado.UrlBase}/operador.html"
            : $"{_estado.UrlSegura}/operador.html",
    };

    private void PintarVista()
    {
        pestanaConsola.Tag = _vista == Vista.Consola ? "activa" : null;
        pestanaPortal.Tag = _vista == Vista.Portal ? "activa" : null;
        pestanaRegistro.Tag = _vista == Vista.Registro ? "activa" : null;

        var enRegistro = _vista == Vista.Registro;
        herramientasLog.Visibility = enRegistro ? Visibility.Visible : Visibility.Collapsed;
        herramientasWeb.Visibility = enRegistro ? Visibility.Collapsed : Visibility.Visible;
        cajaLog.Visibility = enRegistro ? Visibility.Visible : Visibility.Collapsed;

        if (enRegistro)
        {
            vistaWeb.Visibility = Visibility.Collapsed;
            avisoVista.Visibility = Visibility.Collapsed;
            return;
        }

        var activo = _estado.PortalActivo || _nodo.ServidorActivo;

        if (!activo)
        {
            vistaWeb.Visibility = Visibility.Collapsed;
            avisoVista.Visibility = Visibility.Visible;
            btnAvisoVista.Visibility = Visibility.Collapsed;
            txtAvisoVista.Text = "El portal esta detenido.\n\n" +
                "Abre «Ajustes y herramientas» e inicia el portal: aqui aparecera " +
                "la consola de operador, con la lista de personas y sus mensajes.";
            _urlCargada = "";
            return;
        }

        if (_webImposible)
        {
            vistaWeb.Visibility = Visibility.Collapsed;
            avisoVista.Visibility = Visibility.Visible;
            btnAvisoVista.Visibility = Visibility.Visible;
            txtAvisoVista.Text = "No se pudo mostrar la consola dentro del panel: en este " +
                "equipo falta el runtime de WebView2, o ya hay otro panel abierto.\n\n" +
                "El sistema funciona igual. Mira el detalle en la pestana «Registro».";
            return;
        }

        avisoVista.Visibility = Visibility.Collapsed;
        vistaWeb.Visibility = Visibility.Visible;
        _ = NavegarAsync(UrlDeLaVista());
    }

    /// <summary>
    /// Inicializa WebView2 la primera vez y navega. Si el runtime no esta,
    /// no se rompe nada: se marca imposible y el panel ofrece el navegador.
    /// Que el equipo no tenga WebView2 no puede dejar sin consola a un puesto
    /// de mando en mitad de una emergencia.
    /// </summary>
    private async Task NavegarAsync(string url)
    {
        if (string.IsNullOrWhiteSpace(url) || _webImposible) return;

        if (!_webListo)
        {
            // El reloj refresca cada 3 s y esta inicializacion tarda mas que
            // eso: sin el cerrojo entrarian dos a la vez y la segunda revienta
            // con la carpeta de perfil ya tomada.
            if (_webInicializando) return;
            _webInicializando = true;

            try
            {
                // El perfil va en la carpeta de datos: en una instalacion el
                // directorio del programa es de solo lectura para el operador.
                var perfil = Path.Combine(
                    string.IsNullOrWhiteSpace(_estado.CarpetaDatos)
                        ? Path.Combine(Proyecto.Raiz, "datos")
                        : _estado.CarpetaDatos,
                    "webview");
                Directory.CreateDirectory(perfil);

                var entorno = await Microsoft.Web.WebView2.Core.CoreWebView2Environment
                    .CreateAsync(null, perfil);
                await vistaWeb.EnsureCoreWebView2Async(entorno);

                vistaWeb.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                vistaWeb.CoreWebView2.Settings.IsStatusBarEnabled = false;

                // El certificado del canal del GPS es autofirmado a proposito.
                vistaWeb.CoreWebView2.ServerCertificateErrorDetected += (_, args) =>
                    args.Action = Microsoft.Web.WebView2.Core
                        .CoreWebView2ServerCertificateErrorAction.AlwaysAllow;

                _webListo = true;
            }
            catch (Exception ex)
            {
                _webImposible = true;
                Escribir($"No se pudo abrir la vista embebida: {ex.Message}");
                Escribir("La consola se abrira en el navegador del sistema.");
                PintarVista();
                return;
            }
            finally { _webInicializando = false; }
        }

        if (_urlCargada == url) return;
        _urlCargada = url;
        try { vistaWeb.CoreWebView2.Navigate(url); }
        catch (Exception ex) { Escribir($"No se pudo cargar {url}: {ex.Message}", true); }
    }

    private void RecargarWeb_Click(object sender, RoutedEventArgs e)
    {
        _urlCargada = "";
        if (_webListo) { try { vistaWeb.CoreWebView2.Reload(); } catch { /* aun sin cargar */ } }
        PintarVista();
    }

    private void AbrirVistaEnNavegador_Click(object sender, RoutedEventArgs e)
        => Abrir(UrlDeLaVista());

    /* ---------------------------------------------------------------- */
    /* Registro                                                          */
    /* ---------------------------------------------------------------- */

    private int _lineasLog;

    private void Escribir(string texto, bool esError = false)
    {
        var marca = esError ? "  !  " : "     ";
        cajaLog.AppendText((_lineasLog == 0 ? "" : "\n") + marca + texto);
        _lineasLog++;

        // Llevamos la cuenta a mano en vez de preguntar cajaLog.LineCount: esa
        // propiedad fuerza un pase de maquetado en CADA linea del registro.
        if (_lineasLog > 4000)
        {
            var lineas = cajaLog.Text.Split('\n');
            var recorte = lineas.Skip(lineas.Length - 2500).ToArray();
            cajaLog.Text = string.Join("\n", recorte);
            _lineasLog = recorte.Length;
        }

        if (autoScroll.IsChecked == true) cajaLog.ScrollToEnd();
    }

    private void Titular(string texto)
    {
        Escribir("");
        Escribir($"── {texto} ──");
    }

    private void LimpiarLog_Click(object sender, RoutedEventArgs e) => cajaLog.Clear();

    private void CopiarLog_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText(cajaLog.Text);
            Escribir("Registro copiado al portapapeles.");
        }
        catch { Escribir("No se pudo copiar al portapapeles.", true); }
    }

    /* ---------------------------------------------------------------- */
    /* Portal                                                            */
    /* ---------------------------------------------------------------- */

    private async void Iniciar_Click(object sender, RoutedEventArgs e) =>
        await IniciarAsync(Array.Empty<string>(), "Iniciando el portal (puertos 80 / 443 / 53)");

    private async void IniciarPruebas_Click(object sender, RoutedEventArgs e) =>
        await IniciarAsync(new[] { "--http", "8080", "--dns", "5354", "--https", "8443" },
            "Iniciando en puertos altos (8080 / 8443 / 5354)");

    private async void IniciarDiagnostico_Click(object sender, RoutedEventArgs e) =>
        await IniciarAsync(new[] { "--dns-verboso" },
            "Iniciando en modo diagnostico — se registra cada consulta DNS");

    private async Task IniciarAsync(string[] argumentos, string titulo)
    {
        Titular(titulo);
        var error = _nodo.IniciarServidor(argumentos);
        if (error is not null)
        {
            Escribir(error, true);
            return;
        }
        await Task.Delay(1500);
        await RefrescarAsync();

        // Arrancado el portal, el trabajo pasa a ser la consola: el cajon de
        // ajustes estorba y se recoge solo. Vuelve con el boton de la cabecera.
        MostrarAjustes(false);
        _vista = Vista.Consola;
        PintarVista();
    }

    private async void Detener_Click(object sender, RoutedEventArgs e)
    {
        Titular("Deteniendo el portal");
        _nodo.DetenerServidor();
        Escribir("Detenido. Los datos quedan guardados en datos\\sos.sqlite3");
        await Task.Delay(500);
        await RefrescarAsync();
    }

    /* ---------------------------------------------------------------- */
    /* Configuracion                                                     */
    /* ---------------------------------------------------------------- */

    /* ---------------------------------------------------------------- */
    /* Modo de red                                                       */
    /* ---------------------------------------------------------------- */

    private bool _pintandoModo;

    private void Modo_Cambiado(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        var propio = listaModo.SelectedIndex == 1;
        zonaPuntoAcceso.Visibility = propio ? Visibility.Visible : Visibility.Collapsed;
        // En modo propio la IP no se elige: la fijamos nosotros en la tarjeta
        // del punto de acceso, asi que el selector solo confundiria.
        zonaIpServidor.Visibility = propio ? Visibility.Collapsed : Visibility.Visible;
        RedCambiada(sender, e);
    }

    private void RedCambiada(object sender, RoutedEventArgs e)
    {
        if (_pintandoModo || txtRedFinal is null) return;

        var (ssid, aviso) = ComponerSsid(
            cajaNombreRed.Text.Trim(),
            cajaClaveRed.Text.Trim(),
            claveDentroDelNombre.IsChecked == true);

        var bytes = Encoding.UTF8.GetByteCount(ssid);
        txtRedFinal.Text = $"{ssid}\n({bytes} de 32 caracteres)";
        txtRedAviso.Text = aviso ?? "";
        txtRedAviso.Visibility = aviso is null ? Visibility.Collapsed : Visibility.Visible;
    }

    /// <summary>
    /// Vista previa del nombre de red. La composicion que MANDA es la de
    /// src/puntoacceso.js, que es la que configura la tarjeta de verdad; esto
    /// solo da respuesta inmediata mientras se escribe. Tras guardar, el panel
    /// vuelve a leer el nombre real desde tools/estado.js.
    /// </summary>
    private static (string ssid, string? aviso) ComponerSsid(string baseNombre, string clave, bool incluir)
    {
        if (string.IsNullOrWhiteSpace(baseNombre)) baseNombre = "SOS-AYUDA";
        if (!incluir) return (baseNombre, null);

        var compuesto = $"{baseNombre}-CLAVE-{clave}";
        var bytes = Encoding.UTF8.GetByteCount(compuesto);
        if (bytes <= 32) return (compuesto, null);

        return (baseNombre,
            $"Con la clave dentro serian {bytes} caracteres y el maximo son 32. " +
            "Acorta el nombre o la clave.");
    }

    private async void ComprobarAp_Click(object sender, RoutedEventArgs e) =>
        await CorrerAsync("Comprobando si la tarjeta puede ser punto de acceso",
            Path.Combine("tools", "punto-acceso.js"));

    private async void LevantarAp_Click(object sender, RoutedEventArgs e)
    {
        if (_estado.Modo != "propio")
        {
            MessageBox.Show("Primero pon el modo en \"Punto de acceso propio\" y guarda la configuracion.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }
        await CorrerAsync("Levantando la red WiFi", Path.Combine("tools", "punto-acceso.js"), "iniciar");
    }

    private async void BajarAp_Click(object sender, RoutedEventArgs e) =>
        await CorrerAsync("Bajando la red WiFi", Path.Combine("tools", "punto-acceso.js"), "detener");

    private async void Guardar_Click(object sender, RoutedEventArgs e)
    {
        var pin = cajaPin.Text.Trim();
        if (!System.Text.RegularExpressions.Regex.IsMatch(pin, @"^\d{4,8}$"))
        {
            MessageBox.Show("El PIN tiene que ser de 4 a 8 digitos.\n\n" +
                            "Solo digitos: en celular y tablet abre el teclado numerico.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var puesto = cajaPuesto.Text.Trim();
        if (puesto.Length == 0) puesto = "Puesto de Mando SOS";

        var ip = listaAdaptadores.SelectedItem as Adaptador;
        var propio = listaModo.SelectedIndex == 1;

        var clave = cajaClaveRed.Text.Trim();
        if (propio && clave.Length < 8)
        {
            MessageBox.Show("La clave de la red WiFi debe tener 8 caracteres o mas.\n\n" +
                            "Windows no permite que una red hospedada sea abierta.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        try
        {
            Ajustes.Guardar(new Dictionary<string, object?>
            {
                ["puesto"] = puesto,
                ["pin"] = pin,
                ["ip"] = ip?.Ip,
                ["modo"] = propio ? "propio" : "router",
                ["apNombre"] = cajaNombreRed.Text.Trim(),
                ["apClave"] = clave,
                ["apClaveEnNombre"] = claveDentroDelNombre.IsChecked == true,
            });

            Titular("Configuracion guardada");
            Escribir($"Puesto : {puesto}");
            Escribir($"PIN    : {pin}");
            Escribir($"Modo   : {(propio ? "punto de acceso propio" : "router externo")}");
            if (propio)
            {
                var (ssid, _) = ComponerSsid(cajaNombreRed.Text.Trim(), clave,
                    claveDentroDelNombre.IsChecked == true);
                Escribir($"Red    : {ssid}");
                Escribir($"Clave  : {clave}");
            }
            else
            {
                Escribir($"IP     : {(ip is null ? "deteccion automatica" : ip.Ip)}");
            }
            Escribir("");
            Escribir("Se aplica la proxima vez que arranques el portal.");
            if (_nodo.ServidorActivo || _estado.PortalActivo)
                Escribir("El portal esta corriendo: detenlo y vuelve a iniciarlo para que tome los cambios.", true);
        }
        catch (Exception ex) { Escribir($"No se pudo guardar: {ex.Message}", true); }

        await RefrescarAsync();
    }

    private async void Firewall_Click(object sender, RoutedEventArgs e)
    {
        Titular("Abriendo los puertos en el firewall");
        if (!Proyecto.EsAdministrador())
            Escribir("Sin permisos de Administrador esto suele fallar. Reinicia elevado si no funciona.", true);

        var reglas = new (string nombre, string protocolo, int puerto)[]
        {
            ("SOS Portal HTTP", "TCP", 80),
            ("SOS Portal HTTPS", "TCP", 443),
            ("SOS Portal DNS", "UDP", 53),
            // El modo punto de acceso propio levanta su propio DHCP y sin esta
            // regla los celulares no consiguen direccion. Faltaba.
            ("SOS Portal DHCP", "UDP", 67),
        };

        foreach (var (nombre, protocolo, puerto) in reglas)
        {
            // Borrar antes de anadir: "netsh advfirewall firewall add rule" NO
            // reemplaza, apila. Pulsar este boton varias veces —o reinstalar—
            // dejaba el firewall lleno de reglas repetidas con el mismo nombre,
            // imposibles de auditar. Que el delete falle porque no existia es
            // lo normal la primera vez, y no se reporta como error.
            await EjecutarNetshAsync($"advfirewall firewall delete rule name=\"{nombre}\"");

            var ok = await EjecutarNetshAsync(
                $"advfirewall firewall add rule name=\"{nombre}\" dir=in action=allow " +
                $"protocol={protocolo} localport={puerto}");
            Escribir($"{(ok ? "[ OK ]" : "[FALLA]")} {nombre,-18} {protocolo}/{puerto}", !ok);
        }
    }

    private static async Task<bool> EjecutarNetshAsync(string argumentos)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo("netsh", argumentos)
            {
                UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            });
            if (p is null) return false;
            await p.WaitForExitAsync();
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    private void ReiniciarComoAdmin_Click(object sender, RoutedEventArgs e)
    {
        if (_nodo.ServidorActivo)
        {
            MessageBox.Show("Deten el portal antes de reiniciar el panel.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }
        try
        {
            var exe = Environment.ProcessPath;
            if (exe is null) return;
            Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, Verb = "runas" });
            Application.Current.Shutdown();
        }
        catch { Escribir("No se pudo reiniciar como Administrador (¿cancelaste el aviso?).", true); }
    }

    /* ---------------------------------------------------------------- */
    /* Cierre de operacion                                               */
    /* ---------------------------------------------------------------- */

    private void PintarCierre()
    {
        var abierta   = _estado.OperacionAbierta;
        var cerrada   = _estado.OperacionCerrada;
        var entregada = _estado.OperacionEntregada;
        var purgada   = _estado.OperacionPurgada;

        txtEstadoCierre.Text = _estado.EstadoCierre switch
        {
            "cerrada"   => $"Censo exportado ({_estado.ArchivoCsv}). Falta registrar a quien se entrego.",
            "entregada" => $"Entregado a {_estado.Receptor}. " +
                           (_estado.PuedePurgar
                               ? "Plazo cumplido: ya se pueden destruir los datos."
                               : $"Faltan {_estado.DiasFaltan} dia(s) del plazo de conservacion."),
            "purgada"   => "Datos personales destruidos. La constancia esta en " +
                           "datos\\CONSTANCIA-DE-CIERRE.txt",
            _           => "Operacion abierta. Al terminar, cierrala para exportar el censo.",
        };

        var portalActivo = _estado.PortalActivo || _nodo.ServidorActivo;
        btnCerrarOperacion.IsEnabled = abierta && !portalActivo && !_ocupado;
        zonaEntrega.Visibility = cerrada ? Visibility.Visible : Visibility.Collapsed;
        zonaPurga.Visibility   = entregada ? Visibility.Visible : Visibility.Collapsed;
        btnPurgar.IsEnabled = entregada && !portalActivo && !_ocupado;

        if (purgada) btnCerrarOperacion.Visibility = Visibility.Collapsed;
    }

    private async void CerrarOperacion_Click(object sender, RoutedEventArgs e)
    {
        if (_estado.PortalActivo || _nodo.ServidorActivo)
        {
            MessageBox.Show("Deten el portal antes de cerrar la operacion.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var r = MessageBox.Show(
            $"Se genera el censo definitivo con las {_estado.Personas} persona(s) " +
            "registradas y un respaldo verificado.\n\n" +
            "Ese CSV es el que se entrega a la autoridad competente.\n\n¿Cerrar la operacion?",
            "Cerrar operacion", MessageBoxButton.YesNo, MessageBoxImage.Question);
        if (r != MessageBoxResult.Yes) return;

        await CorrerAsync("Cerrando la operacion", Path.Combine("tools", "cierre.js"), "cerrar");
    }

    private async void RegistrarEntrega_Click(object sender, RoutedEventArgs e)
    {
        var receptor = cajaReceptor.Text.Trim();
        if (receptor.Length < 3)
        {
            MessageBox.Show("Escribe a quien se entrego el censo: el organismo o la persona.\n\n" +
                            "Es lo que queda en la constancia cuando los datos ya no existan.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        await CorrerAsync("Registrando la entrega", Path.Combine("tools", "cierre.js"),
            "entregar", receptor, cajaContacto.Text.Trim(), cajaMedio.Text.Trim());
    }

    private async void Purgar_Click(object sender, RoutedEventArgs e)
    {
        if (_estado.PortalActivo || _nodo.ServidorActivo)
        {
            MessageBox.Show("Deten el portal antes de destruir los datos.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var motivo = cajaMotivoPurga.Text.Trim();
        if (!_estado.PuedePurgar && motivo.Length < 5)
        {
            MessageBox.Show(
                $"{_estado.MotivoBloqueoPurga}\n\n" +
                "Si necesitas destruirlos igualmente, escribe el motivo en el campo " +
                "de arriba. Quedara anotado en la constancia.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        // Doble confirmacion: esto es irreversible y borra datos de victimas.
        var r = MessageBox.Show(
            "ESTO DESTRUYE LOS DATOS PERSONALES Y NO SE PUEDE DESHACER.\n\n" +
            "Se borran la base de datos, los respaldos y las exportaciones CSV.\n\n" +
            "Queda una constancia que NO contiene datos personales: dice cuantas " +
            "personas hubo, a quien se entrego el archivo y su huella digital.\n\n" +
            "¿Continuar?",
            "Destruir los datos personales", MessageBoxButton.YesNo, MessageBoxImage.Warning,
            MessageBoxResult.No);
        if (r != MessageBoxResult.Yes) return;

        var r2 = MessageBox.Show(
            $"Confirma por ultima vez.\n\n¿Ya entregaste el censo a {_estado.Receptor}?",
            "Ultima confirmacion", MessageBoxButton.YesNo, MessageBoxImage.Stop,
            MessageBoxResult.No);
        if (r2 != MessageBoxResult.Yes) return;

        // Quien purga queda en la constancia. El usuario de Windows es mas
        // fiable que un campo escrito a mano: nadie lo rellena con prisa.
        var quien = $"{Environment.UserName} ({Environment.MachineName})";

        string[] argumentos = string.IsNullOrEmpty(motivo)
            ? new string[] { "purgar", quien }
            : new string[] { "purgar", quien, motivo };

        await CorrerAsync("Destruyendo los datos personales",
            Path.Combine("tools", "cierre.js"), argumentos);
    }

    /* ---------------------------------------------------------------- */
    /* Datos y verificacion                                              */
    /* ---------------------------------------------------------------- */

    private void VerCenso_Click(object sender, RoutedEventArgs e)
    {
        Titular("Resumen del censo");
        if (!_estado.HayBase || _estado.Personas == 0)
        {
            Escribir("Todavia no se ha registrado nadie.");
            return;
        }
        Escribir($"Personas registradas : {_estado.Personas}");
        Escribir($"Mensajes             : {_estado.Mensajes}");
        Escribir($"Atrapados            : {_estado.Atrapados}");
        Escribir($"Heridos              : {_estado.Heridos}");
        Escribir($"Mensajes sin leer    : {_estado.SinLeer}");
        Escribir($"Reportes dudosos     : {_estado.Dudosos}");
    }

    private async void Exportar_Click(object sender, RoutedEventArgs e) =>
        await CorrerAsync("Exportando el censo a CSV", Path.Combine("tools", "exportar-csv.js"));

    private async void Respaldar_Click(object sender, RoutedEventArgs e) =>
        await CorrerAsync("Respaldando la base de datos", Path.Combine("tools", "respaldar.js"));

    private async void Diagnostico_Click(object sender, RoutedEventArgs e) =>
        await CorrerAsync("Diagnostico previo al despliegue", Path.Combine("pruebas", "diagnostico.js"));

    private async void Vaciar_Click(object sender, RoutedEventArgs e)
    {
        if (_nodo.ServidorActivo || _estado.PortalActivo)
        {
            MessageBox.Show("Deten el portal antes de vaciar la base.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            return;
        }

        var r = MessageBox.Show(
            $"Vas a borrar {_estado.Personas} persona(s) y {_estado.Mensajes} mensaje(s).\n\n" +
            "Se guarda un respaldo automatico antes de borrar.\n\n¿Seguro?",
            "Vaciar la base de datos", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (r != MessageBoxResult.Yes) return;

        await CorrerAsync("Vaciando la base de datos", Path.Combine("tools", "reiniciar-bd.js"));
    }

    private async void Certificado_Click(object sender, RoutedEventArgs e)
    {
        var r = MessageBox.Show(
            "Se emitira un certificado nuevo para el canal del GPS.\n\n" +
            "Hazlo si CAMBIO LA IP del puesto de mando.\n\n" +
            "OJO: los celulares que ya aceptaron el aviso lo veran otra vez.\n\n¿Continuar?",
            "Certificado del GPS", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (r != MessageBoxResult.Yes) return;

        Titular("Emitiendo un certificado nuevo");
        try
        {
            var carpeta = Path.Combine(Proyecto.Raiz, "datos", "tls");
            if (Directory.Exists(carpeta)) Directory.Delete(carpeta, true);
            Escribir("Certificado borrado. Se emite uno nuevo al arrancar el portal.");
        }
        catch (Exception ex) { Escribir($"No se pudo borrar: {ex.Message}", true); }
        await RefrescarAsync();
    }

    private async void Humo_Click(object sender, RoutedEventArgs e)
    {
        var activo = _estado.PortalActivo || _nodo.ServidorActivo;
        if (!activo)
        {
            MessageBox.Show("La prueba necesita el portal corriendo.\n\n" +
                            "Arrancalo primero (mejor en puertos altos) y vuelve a intentarlo.",
                "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Information);
            return;
        }

        var r = MessageBox.Show(
            "La prueba crea personas de ejemplo en la base.\n\n" +
            "Si ya estas en operacion con gente real, NO la corras.\n\n¿Continuar?",
            "Prueba de humo", MessageBoxButton.YesNo, MessageBoxImage.Warning);
        if (r != MessageBoxResult.Yes) return;

        await CorrerAsync("Prueba de humo end-to-end", Path.Combine("pruebas", "humo.js"),
            "--url", _estado.UrlBase,
            "--dns", _estado.PuertoDns.ToString(),
            "--seguro", PuertoSeguroActual().ToString(),
            "--pin", _estado.Pin);
    }

    private int PuertoSeguroActual() => _estado.UrlBase.Contains(":8080") ? 8443 : 443;

    private async Task CorrerAsync(string titulo, string script, params string[] argumentos)
    {
        if (_ocupado) return;
        _ocupado = true;
        PintarEstado();

        Titular(titulo);
        try { await _nodo.EjecutarConLogAsync(script, argumentos); }
        catch (Exception ex) { Escribir($"Fallo: {ex.Message}", true); }

        _ocupado = false;
        await RefrescarAsync();
    }

    /* ---------------------------------------------------------------- */
    /* Atajos al navegador                                               */
    /* ---------------------------------------------------------------- */

    private void AbrirOperador_Click(object sender, RoutedEventArgs e)
    {
        // Fuera del panel el navegador SI muestra el aviso del certificado: hay
        // que avisarlo, o el operador lo lee como que algo esta roto y se va.
        if (!string.IsNullOrWhiteSpace(_estado.UrlSegura))
        {
            Escribir("Abriendo la consola por el canal cifrado. El navegador va a avisar del");
            Escribir("certificado: es normal aqui, aceptalo una vez. Sin cifrar seria");
            Escribir($"{_estado.UrlBase}/operador.html");
        }
        Abrir(UrlDeLaVista());
    }
    private void AbrirPortal_Click(object sender, RoutedEventArgs e) => Abrir(_estado.UrlBase);
    private void AbrirCartel_Click(object sender, RoutedEventArgs e) => Abrir($"{_estado.UrlBase}/cartel.html");

    private void AbrirDatos_Click(object sender, RoutedEventArgs e)
    {
        // En una instalacion los datos NO estan junto al programa, sino en
        // ProgramData. Sin este boton el operador no sabria donde buscarlos.
        var carpeta = string.IsNullOrWhiteSpace(_estado.CarpetaDatos)
            ? Path.Combine(Proyecto.Raiz, "datos")
            : _estado.CarpetaDatos;

        try { Directory.CreateDirectory(carpeta); } catch { /* ya existira o no se puede */ }
        Abrir(carpeta);
    }

    private void Abrir(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return;
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { Escribir($"No se pudo abrir {url}: {ex.Message}", true); }
    }

    private void DeshabilitarTodo()
    {
        foreach (var b in new[] { btnIniciar, btnIniciarPruebas, btnIniciarDiag, btnDetener, btnVaciar })
            b.IsEnabled = false;
    }
}
