using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;

internal static class LeafnoteLauncher {
    const string ProgId = "Leafnote.Markdown";
    [DllImport("shell32.dll")] static extern void SHChangeNotify(uint id, uint flags, IntPtr item1, IntPtr item2);
    static string Exe { get { return Application.ExecutablePath; } }
    static void Set(string path, string name, string value) {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(path)) key.SetValue(name, value);
    }
    static void Register() {
        string classes = @"Software\Classes\", command = "\"" + Exe + "\" \"%1\"", icon = "\"" + Exe + "\",0";
        Set(classes + ProgId, "", "Leafnote Markdown 문서");
        Set(classes + ProgId + @"\DefaultIcon", "", icon);
        Set(classes + ProgId + @"\shell\open\command", "", command);
        string app = classes + @"Applications\Leafnote.exe";
        Set(app, "FriendlyAppName", "Leafnote");
        Set(app + @"\DefaultIcon", "", icon);
        Set(app + @"\shell\open\command", "", command);
        foreach (string ext in new [] { ".md", ".markdown" }) {
            Set(app + @"\SupportedTypes", ext, "");
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(classes + ext + @"\OpenWithProgids"))
                key.SetValue(ProgId, new byte[0], RegistryValueKind.None);
            Set(@"Software\Leafnote\Capabilities\FileAssociations", ext, ProgId);
        }
        Set(@"Software\Leafnote\Capabilities", "ApplicationName", "Leafnote");
        Set(@"Software\Leafnote\Capabilities", "ApplicationDescription", "로컬 마크다운 블록 편집기");
        Set(@"Software\Leafnote\Capabilities", "ApplicationIcon", icon);
        Set(@"Software\RegisteredApplications", "Leafnote", @"Software\Leafnote\Capabilities");
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }
    static void Unregister() {
        foreach (string key in new [] { @"Software\Classes\" + ProgId, @"Software\Classes\Applications\Leafnote.exe", @"Software\Leafnote\Capabilities" })
            Registry.CurrentUser.DeleteSubKeyTree(key, false);
        foreach (string ext in new [] { ".md", ".markdown" })
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\" + ext + @"\OpenWithProgids", true))
                if (key != null) key.DeleteValue(ProgId, false);
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true))
            if (key != null) key.DeleteValue("Leafnote", false);
        SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero);
    }
    [STAThread] static int Main(string[] args) {
        try {
            if (args.Length == 1 && args[0] == "--register") { Register(); return 0; }
            if (args.Length == 1 && args[0] == "--unregister") { Unregister(); return 0; }
            if (args.Length == 1 && args[0] == "--default-apps") {
                Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=Leafnote") { UseShellExecute = true }); return 0;
            }
            if (args.Length > 1) throw new Exception("한 번에 마크다운 파일 하나를 열어주세요.");
            string script = Path.Combine(Path.GetDirectoryName(Exe), "launch.ps1");
            string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
            if (args.Length == 1) {
                string file = Path.GetFullPath(args[0]);
                string ext = Path.GetExtension(file);
                if (!File.Exists(file) || !(ext.Equals(".md", StringComparison.OrdinalIgnoreCase) || ext.Equals(".markdown", StringComparison.OrdinalIgnoreCase)))
                    throw new Exception("기존 .md 또는 .markdown 파일을 선택해주세요.");
                arguments += " -PathBase64 " + Convert.ToBase64String(Encoding.UTF8.GetBytes(file));
            }
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            Process.Start(new ProcessStartInfo(powershell, arguments) {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = Path.GetDirectoryName(Exe)
            });
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Leafnote", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
