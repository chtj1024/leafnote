using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Windows.Forms;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Net;
using System.Net.Sockets;
using System.Collections.Generic;
using System.Web.Script.Serialization;

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
    static JavaScriptSerializer Serializer() { return new JavaScriptSerializer { MaxJsonLength = 32 * 1024 * 1024 }; }
    static Dictionary<string, object> RequestJson(string url, string token, string payload) {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null;
        request.AllowAutoRedirect = false;
        request.Timeout = 500;
        request.ReadWriteTimeout = 1500;
        request.ServicePoint.Expect100Continue = false;
        request.ServicePoint.UseNagleAlgorithm = false;
        if (payload != null) {
            byte[] bytes = Encoding.UTF8.GetBytes(payload);
            request.Method = "POST";
            request.ContentType = "application/json; charset=utf-8";
            request.Headers["X-Leafnote-Token"] = token;
            request.ContentLength = bytes.Length;
            using (Stream stream = request.GetRequestStream()) stream.Write(bytes, 0, bytes.Length);
        }
        HttpWebResponse response;
        try { response = (HttpWebResponse)request.GetResponse(); }
        catch (WebException error) {
            if (error.Response == null) throw;
            using (WebResponse failed = error.Response)
            using (StreamReader reader = new StreamReader(failed.GetResponseStream(), Encoding.UTF8)) {
                Dictionary<string, object> details = Serializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
                object message;
                throw new Exception(details != null && details.TryGetValue("error", out message) ? Convert.ToString(message) : "파일을 열지 못했습니다.", error);
            }
        }
        using (response)
        using (StreamReader reader = new StreamReader(response.GetResponseStream(), Encoding.UTF8)) {
            if (response.StatusCode != HttpStatusCode.OK) throw new Exception("Leafnote 서버 응답을 확인할 수 없습니다.");
            Dictionary<string, object> result = Serializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
            if (result == null) throw new Exception("Leafnote 서버 응답을 읽을 수 없습니다.");
            return result;
        }
    }
    internal static bool TryOpenRunningServer(string root, string file, int port, out string url) {
        url = "http://127.0.0.1:" + port;
        // A stopped loopback server should immediately use the startup path.
        using (TcpClient client = new TcpClient(AddressFamily.InterNetwork)) {
            IAsyncResult connection = client.BeginConnect(IPAddress.Loopback, port, null, null);
            using (System.Threading.WaitHandle wait = connection.AsyncWaitHandle) {
                if (!wait.WaitOne(60)) return false;
                try { client.EndConnect(connection); } catch (SocketException) { return false; }
            }
        }
        try {
            Dictionary<string, object> health = RequestJson(url + "/api/health", null, null);
            object app, serverRoot, version;
            if (!health.TryGetValue("app", out app) || Convert.ToString(app) != "leafnote" ||
                !health.TryGetValue("root", out serverRoot) || !String.Equals(Path.GetFullPath(Convert.ToString(serverRoot)).TrimEnd('\\'), Path.GetFullPath(root).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
                throw new Exception("다른 프로그램 또는 다른 폴더의 Leafnote가 실행 중입니다. 해당 Leafnote의 stop.cmd 실행 후 다시 열어주세요.");
            if (!health.TryGetValue("version", out version) || Convert.ToInt32(version) < 3)
                throw new Exception("이전 Leafnote가 실행 중입니다. 문서의 저장됨 표시를 확인하고 stop.cmd 실행 후 다시 열어주세요.");
            if (file != null) {
                Dictionary<string, object> bootstrap = RequestJson(url + "/api/bootstrap", null, null);
                string token = Convert.ToString(bootstrap["token"]);
                string payload = Serializer().Serialize(new Dictionary<string, string> { { "path", file } });
                Dictionary<string, object> document = RequestJson(url + "/api/open-file", token, payload);
                Guid id;
                if (!Guid.TryParse(Convert.ToString(document["id"]), out id)) throw new Exception("열린 파일 정보를 읽을 수 없습니다.");
                url += "/?document=" + id.ToString();
            }
            return true;
        } catch (WebException error) {
            if (error.Response != null) throw;
            return false;
        }
    }
    static void OpenWindow(string url) {
        string edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
        if (File.Exists(edge)) {
            Process.Start(new ProcessStartInfo(edge, "--app=" + url + " --new-window") { UseShellExecute = false });
        } else {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
    }
    [STAThread] static int Main(string[] args) {
        try {
            if (args.Length == 1 && args[0] == "--register") { Register(); return 0; }
            if (args.Length == 1 && args[0] == "--unregister") { Unregister(); return 0; }
            if (args.Length == 1 && args[0] == "--default-apps") {
                Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=Leafnote") { UseShellExecute = true }); return 0;
            }
            if (args.Length > 1) throw new Exception("한 번에 마크다운 파일 하나를 열어주세요.");
            string root = Path.GetDirectoryName(Exe), file = null;
            if (args.Length == 1) {
                file = Path.GetFullPath(args[0]);
                string ext = Path.GetExtension(file);
                if (!File.Exists(file) || !(ext.Equals(".md", StringComparison.OrdinalIgnoreCase) || ext.Equals(".markdown", StringComparison.OrdinalIgnoreCase)))
                    throw new Exception("기존 .md 또는 .markdown 파일을 선택해주세요.");
            }
            string url;
            if (TryOpenRunningServer(root, file, 43127, out url)) { OpenWindow(url); return 0; }
            // Keep the existing synchronized startup path for a stopped server.
            string script = Path.Combine(root, "launch.ps1");
            string arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"";
            if (file != null) arguments += " -PathBase64 " + Convert.ToBase64String(Encoding.UTF8.GetBytes(file));
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe");
            Process.Start(new ProcessStartInfo(powershell, arguments) {
                UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden,
                WorkingDirectory = root
            });
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Leafnote", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
