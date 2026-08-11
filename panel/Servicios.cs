using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;

namespace PanelSOS;

/// <summary>
/// Localiza el proyecto y Node, y lee su estado. Toda la logica de negocio
/// vive en los scripts de Node: este panel es una carcasa comoda, no una
/// segunda implementacion que se pueda desincronizar.
/// </summary>
public static class Proyecto
{
    private static string? _raiz;

    /// <summary>
    /// Carpeta del proyecto. Se busca subiendo desde el ejecutable, porque el
    /// .exe compilado queda en panel/bin/Release/... y no al lado del codigo.
    /// </summary>
    public static string Raiz
    {
        get
        {
            if (_raiz is not null) return _raiz;

            var candidatos = new List<string>();
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir is not null)
            {
                candidatos.Add(dir.FullName);
                dir = dir.Parent;
            }
            candidatos.Add(Directory.GetCurrentDirectory());

            foreach (var c in candidatos)
            {
                if (File.Exists(Path.Combine(c, "src", "server.js")) &&
                    File.Exists(Path.Combine(c, "package.json")))
                {
                    return _raiz = c;
                }
            }

            // No encontrado: devolvemos algo razonable para que el mensaje de
            // error diga donde se busco.
            return _raiz = Directory.GetCurrentDirectory();
        }
    }

    public static bool ProyectoValido =>
        File.Exists(Path.Combine(Raiz, "src", "server.js"));

    public static bool DependenciasInstaladas =>
        Directory.Exists(Path.Combine(Raiz, "node_modules", "express"));

    /// <summary>
    /// Ruta de node.exe. Primero el que viene DENTRO de la instalacion: en el
    /// distribuible no se puede dar por hecho que el equipo tenga Node, y
    /// tampoco queremos depender de la version que tenga instalada.
    /// </summary>
    public static string? RutaNode()
    {
        var empaquetado = Path.Combine(Raiz, "runtime", "node.exe");
        if (File.Exists(empaquetado)) return empaquetado;

        var ruta = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var carpeta in ruta.Split(Path.PathSeparator))
        {
            if (string.IsNullOrWhiteSpace(carpeta)) continue;
            try
            {
                var candidato = Path.Combine(carpeta.Trim(), "node.exe");
                if (File.Exists(candidato)) return candidato;
            }
            catch { /* entrada del PATH invalida */ }
        }

        foreach (var fijo in new[]
                 {
                     @"C:\Program Files\nodejs\node.exe",
                     @"C:\Program Files (x86)\nodejs\node.exe",
                 })
        {
            if (File.Exists(fijo)) return fijo;
        }
        return null;
    }

    public static bool EsAdministrador()
    {
        try
        {
            using var identidad = System.Security.Principal.WindowsIdentity.GetCurrent();
            var principal = new System.Security.Principal.WindowsPrincipal(identidad);
            return principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }
}

/// <summary>Estado del sistema, tal y como lo reporta tools/estado.js.</summary>
public sealed class EstadoSistema
{
    public string Ip { get; init; } = "";
    public string CarpetaDatos { get; init; } = "";
    public bool IpFijada { get; init; }
    public string Puesto { get; init; } = "";
    public string Pin { get; init; } = "1234";
    public bool PinDeFabrica { get; init; } = true;
    public bool Certificado { get; init; }
    public bool HayBase { get; init; }
    public int Personas { get; init; }
    public int Mensajes { get; init; }
    public int SinLeer { get; init; }
    public int Dudosos { get; init; }
    public int Atrapados { get; init; }
    public int Heridos { get; init; }
    public bool PortalActivo { get; init; }
    public string UrlBase { get; init; } = "";
    public int PuertoDns { get; init; }
    public List<Adaptador> Adaptadores { get; init; } = new();

    // Cierre de operacion
    public string EstadoCierre { get; init; } = "abierta";
    public bool OperacionAbierta => EstadoCierre == "abierta";
    public bool OperacionCerrada => EstadoCierre == "cerrada";
    public bool OperacionEntregada => EstadoCierre == "entregada";
    public bool OperacionPurgada => EstadoCierre == "purgada";
    public string? Receptor { get; init; }
    public string? ArchivoCsv { get; init; }
    public bool PuedePurgar { get; init; }
    public string? MotivoBloqueoPurga { get; init; }
    public int DiasFaltan { get; init; }

    // Modo de red
    public string Modo { get; init; } = "router";
    public bool ModoPropio => Modo == "propio";
    public string NombreBase { get; init; } = "SOS-AYUDA";
    public string Ssid { get; init; } = "";
    public string Clave { get; init; } = "";
    public bool ClaveEnNombre { get; init; } = true;
    public string? AvisoSsid { get; init; }
    public string ApIp { get; init; } = "";
    public string ApDesde { get; init; } = "";
    public string ApHasta { get; init; } = "";

    public static EstadoSistema Vacio() => new();

    public static EstadoSistema Desde(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var raiz = doc.RootElement;

        int Entero(JsonElement padre, string nombre) =>
            padre.TryGetProperty(nombre, out var v) && v.ValueKind == JsonValueKind.Number
                ? v.GetInt32() : 0;

        string Texto(JsonElement padre, string nombre, string porDefecto = "") =>
            padre.ValueKind == JsonValueKind.Object &&
            padre.TryGetProperty(nombre, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() ?? porDefecto : porDefecto;

        var censo = raiz.TryGetProperty("censo", out var c) && c.ValueKind == JsonValueKind.Object
            ? c : default;
        var ap = raiz.TryGetProperty("puntoAcceso", out var pa) && pa.ValueKind == JsonValueKind.Object
            ? pa : default;
        var ci = raiz.TryGetProperty("cierre", out var cc) && cc.ValueKind == JsonValueKind.Object
            ? cc : default;
        var portal = raiz.TryGetProperty("portal", out var p) && p.ValueKind == JsonValueKind.Object
            ? p : default;

        var adaptadores = new List<Adaptador>();
        if (raiz.TryGetProperty("adaptadores", out var lista) && lista.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in lista.EnumerateArray())
            {
                adaptadores.Add(new Adaptador(
                    a.GetProperty("nombre").GetString() ?? "",
                    a.GetProperty("ip").GetString() ?? "",
                    a.TryGetProperty("virtual", out var v) && v.ValueKind == JsonValueKind.True));
            }
        }

        return new EstadoSistema
        {
            Ip = raiz.GetProperty("ip").GetString() ?? "",
            CarpetaDatos = raiz.TryGetProperty("carpetaDatos", out var cd)
                ? cd.GetString() ?? "" : "",
            IpFijada = raiz.GetProperty("ipFijada").GetBoolean(),
            Puesto = raiz.GetProperty("puesto").GetString() ?? "",
            Pin = raiz.GetProperty("pin").GetString() ?? "1234",
            PinDeFabrica = raiz.GetProperty("pinDeFabrica").GetBoolean(),
            Certificado = raiz.GetProperty("certificado").GetBoolean(),
            HayBase = raiz.GetProperty("hayBase").GetBoolean(),
            Personas = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "personas") : 0,
            Mensajes = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "mensajes") : 0,
            SinLeer = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "sinLeer") : 0,
            Dudosos = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "dudosos") : 0,
            Atrapados = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "atrapados") : 0,
            Heridos = censo.ValueKind == JsonValueKind.Object ? Entero(censo, "heridos") : 0,
            PortalActivo = portal.ValueKind == JsonValueKind.Object,
            UrlBase = portal.ValueKind == JsonValueKind.Object
                ? portal.GetProperty("urlBase").GetString() ?? "" : "",
            PuertoDns = portal.ValueKind == JsonValueKind.Object ? Entero(portal, "puertoDns") : 0,
            Adaptadores = adaptadores,

            EstadoCierre = Texto(ci, "estado", "abierta"),
            Receptor = Texto(ci, "receptor") is { Length: > 0 } rc ? rc : null,
            ArchivoCsv = Texto(ci, "archivoCsv") is { Length: > 0 } ac ? ac : null,
            PuedePurgar = ci.ValueKind == JsonValueKind.Object &&
                          ci.TryGetProperty("puedePurgar", out var pp) &&
                          pp.ValueKind == JsonValueKind.True,
            MotivoBloqueoPurga = Texto(ci, "motivoBloqueo") is { Length: > 0 } mb ? mb : null,
            DiasFaltan = Entero(ci, "diasFaltan"),

            Modo = raiz.TryGetProperty("modo", out var m) ? m.GetString() ?? "router" : "router",
            NombreBase = Texto(ap, "nombreBase", "SOS-AYUDA"),
            Ssid = Texto(ap, "ssid"),
            Clave = Texto(ap, "clave"),
            ClaveEnNombre = ap.ValueKind == JsonValueKind.Object &&
                            ap.TryGetProperty("claveEnNombre", out var cen) &&
                            cen.ValueKind != JsonValueKind.False,
            AvisoSsid = Texto(ap, "avisoSsid") is { Length: > 0 } av ? av : null,
            ApIp = Texto(ap, "ip"),
            ApDesde = Texto(ap, "desde"),
            ApHasta = Texto(ap, "hasta"),
        };
    }
}

public sealed record Adaptador(string Nombre, string Ip, bool Virtual)
{
    public override string ToString() =>
        $"{Ip}  —  {Nombre}{(Virtual ? "  (virtual)" : "")}";
}

/// <summary>
/// Lanza procesos de Node y entrega su salida linea a linea.
///
/// El servidor corre como HIJO de este panel con la salida redirigida, asi que
/// el log aparece dentro de la ventana. Esa es la razon de ser del panel: se
/// acabaron las ventanas de consola que saltan al frente y roban el teclado.
/// </summary>
public sealed class Nodo
{
    private Process? _servidor;

    public event Action<string, bool>? Salida;   // texto, esError
    public event Action? ServidorTermino;

    public bool ServidorActivo => _servidor is { HasExited: false };

    private ProcessStartInfo Preparar(string nodo, IEnumerable<string> argumentos)
    {
        var inicio = new ProcessStartInfo
        {
            FileName = nodo,
            WorkingDirectory = Proyecto.Raiz,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            // Node emite UTF-8; sin esto los acentos y los recuadros del banner
            // salen como basura.
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        foreach (var a in argumentos) inicio.ArgumentList.Add(a);
        return inicio;
    }

    public string? IniciarServidor(IEnumerable<string> argumentos)
    {
        if (ServidorActivo) return "El portal ya esta corriendo.";

        var nodo = Proyecto.RutaNode();
        if (nodo is null) return "No se encontro Node.js. Instalalo desde nodejs.org (version 22 o superior).";

        var lista = new List<string> { Path.Combine("src", "server.js") };
        lista.AddRange(argumentos);

        try
        {
            _servidor = new Process { StartInfo = Preparar(nodo, lista), EnableRaisingEvents = true };
            _servidor.OutputDataReceived += (_, e) => { if (e.Data is not null) Salida?.Invoke(e.Data, false); };
            _servidor.ErrorDataReceived += (_, e) => { if (e.Data is not null) Salida?.Invoke(e.Data, true); };
            _servidor.Exited += (_, _) => ServidorTermino?.Invoke();

            _servidor.Start();
            _servidor.BeginOutputReadLine();
            _servidor.BeginErrorReadLine();
            return null;
        }
        catch (Exception ex)
        {
            _servidor = null;
            return ex.Message;
        }
    }

    public void DetenerServidor()
    {
        if (_servidor is null) return;
        try
        {
            if (!_servidor.HasExited) _servidor.Kill(entireProcessTree: true);
        }
        catch { /* ya se habia ido */ }

        // El servidor borra su archivo de estado al cerrar ordenadamente; si lo
        // matamos no le da tiempo, asi que lo limpiamos nosotros para que nada
        // crea que sigue vivo.
        try
        {
            var marca = Path.Combine(Proyecto.Raiz, "datos", "servidor.json");
            if (File.Exists(marca)) File.Delete(marca);
        }
        catch { /* si no se puede, el chequeo de PID lo detectara igual */ }

        _servidor = null;
    }

    /// <summary>Corre un script de una sola vez y devuelve su salida completa.</summary>
    public async Task<(int codigo, string salida)> EjecutarAsync(
        string script, params string[] argumentos)
    {
        var nodo = Proyecto.RutaNode();
        if (nodo is null) return (-1, "No se encontro Node.js.");

        var lista = new List<string> { script };
        lista.AddRange(argumentos);

        using var proceso = new Process { StartInfo = Preparar(nodo, lista) };
        var texto = new StringBuilder();

        proceso.OutputDataReceived += (_, e) => { if (e.Data is not null) texto.AppendLine(e.Data); };
        proceso.ErrorDataReceived += (_, e) => { if (e.Data is not null) texto.AppendLine(e.Data); };

        proceso.Start();
        proceso.BeginOutputReadLine();
        proceso.BeginErrorReadLine();
        await proceso.WaitForExitAsync();

        return (proceso.ExitCode, texto.ToString());
    }

    /// <summary>Igual, pero volcando la salida al log segun va llegando.</summary>
    public async Task<int> EjecutarConLogAsync(string script, params string[] argumentos)
    {
        var nodo = Proyecto.RutaNode();
        if (nodo is null)
        {
            Salida?.Invoke("No se encontro Node.js.", true);
            return -1;
        }

        var lista = new List<string> { script };
        lista.AddRange(argumentos);

        using var proceso = new Process { StartInfo = Preparar(nodo, lista) };
        proceso.OutputDataReceived += (_, e) => { if (e.Data is not null) Salida?.Invoke(e.Data, false); };
        proceso.ErrorDataReceived += (_, e) => { if (e.Data is not null) Salida?.Invoke(e.Data, true); };

        proceso.Start();
        proceso.BeginOutputReadLine();
        proceso.BeginErrorReadLine();
        await proceso.WaitForExitAsync();
        return proceso.ExitCode;
    }
}

/// <summary>Lee y escribe datos/configuracion.json, el mismo que usa Node.</summary>
public static class Ajustes
{
    private static string Ruta => Path.Combine(Proyecto.Raiz, "datos", "configuracion.json");

    /// <summary>Mezcla los cambios sobre lo ya guardado, sin perder lo demas.</summary>
    public static void Guardar(IDictionary<string, object?> cambios)
    {
        var carpeta = Path.GetDirectoryName(Ruta)!;
        Directory.CreateDirectory(carpeta);

        var actual = new Dictionary<string, object?>();
        if (File.Exists(Ruta))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(Ruta));
                foreach (var p in doc.RootElement.EnumerateObject())
                {
                    actual[p.Name] = p.Value.ValueKind switch
                    {
                        JsonValueKind.String => p.Value.GetString(),
                        JsonValueKind.Number => p.Value.GetInt64(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => null,
                    };
                }
            }
            catch { /* corrupto: lo reescribimos entero */ }
        }

        foreach (var (clave, valor) in cambios) actual[clave] = valor;
        actual["actualizado"] = DateTime.UtcNow.ToString("o");

        File.WriteAllText(Ruta,
            JsonSerializer.Serialize(actual, new JsonSerializerOptions { WriteIndented = true }));
    }
}
