/*
 * SOS · Conectate · Pide Ayuda — portal cautivo de emergencia
 * Copyright (C) 2026 Cesar A. Guevara D.
 *
 * Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo
 * los terminos de la Licencia Publica General GNU publicada por la Free
 * Software Foundation, en su version 3 o, a tu eleccion, cualquier version
 * posterior. Se distribuye SIN NINGUNA GARANTIA.
 *
 * Consulta <https://www.gnu.org/licenses/> para el texto completo.
 */

using System.IO;
using System.Windows;

namespace PanelSOS;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        // Un fallo no controlado no puede dejar al operador con una ventana
        // muerta y sin explicacion. Se apunta SIEMPRE a un archivo, porque en
        // terreno nadie va a abrir el Visor de eventos de Windows.
        DispatcherUnhandledException += (_, args) =>
        {
            Apuntar(args.Exception);

            // El MessageBox se intenta, pero no puede tumbar la aplicacion: si
            // el fallo original es de dibujado de texto, mostrar un cuadro de
            // dialogo vuelve a fallar y se entra en cascada. Ya paso una vez.
            try
            {
                MessageBox.Show(
                    $"Ocurrio un error:\n\n{args.Exception.Message}\n\n" +
                    "Se guardo el detalle en datos\\panel-error.log",
                    "Panel SOS", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
            catch { /* ni el aviso se pudo mostrar: al menos quedo apuntado */ }

            args.Handled = true;
        };

        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
        {
            if (args.ExceptionObject is Exception ex) Apuntar(ex);
        };

        base.OnStartup(e);
    }

    private static void Apuntar(Exception ex)
    {
        try
        {
            var carpeta = Path.Combine(Proyecto.Raiz, "datos");
            Directory.CreateDirectory(carpeta);
            File.AppendAllText(
                Path.Combine(carpeta, "panel-error.log"),
                $"===== {DateTime.Now:yyyy-MM-dd HH:mm:ss} ====={Environment.NewLine}" +
                $"{ex}{Environment.NewLine}{Environment.NewLine}");
        }
        catch { /* si no se puede escribir, no hay mas que hacer */ }
    }
}
