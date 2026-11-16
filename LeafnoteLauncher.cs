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
using System.Threading;
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
            object saveMode;
            if (!health.TryGetValue("saveMode", out saveMode) || Convert.ToString(saveMode) != "inplace")
                throw new Exception("이전 저장 방식의 Leafnote가 아직 실행 중입니다. 문서를 모두 저장한 뒤 Leafnote 폴더의 stop.cmd를 실행하고 파일을 다시 열어주세요.");
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
    static string FindNode(string root) {
        List<string> candidates=new List<string> {
            Path.Combine(root,@"runtime\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),@"nodejs\node.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),@".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
        };
        foreach(string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator)) {
            try { if(!String.IsNullOrEmpty(directory)) candidates.Add(Path.Combine(directory.Trim('"'),"node.exe")); } catch(ArgumentException) {}
        }
        foreach(string candidate in candidates)if(File.Exists(candidate))return candidate;
        throw new Exception("Node.js 18 이상을 설치한 뒤 다시 열어주세요.");
    }
    internal static string OpenFileUrl(string root,string file,int port=43127) {
        string url;
        if(TryOpenRunningServer(root,file,port,out url))return url;
        using(Mutex gate=new Mutex(false,"Local\\Leafnote-"+LeafnoteWindow.RootKey(root)+"-"+port)) {
            bool locked;
            try { locked=gate.WaitOne(10000); } catch(AbandonedMutexException) { locked=true; }
            if(!locked)throw new Exception("Leafnote 시작 대기 시간이 초과되었습니다.");
            try {
                if(TryOpenRunningServer(root,file,port,out url))return url;
                string logs=Path.Combine(Path.GetTempPath(),"Leafnote",LeafnoteWindow.RootKey(root));
                ProcessStartInfo info=new ProcessStartInfo(FindNode(root),"\""+Path.Combine(root,"server-runner.cjs")+"\"") { UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden,WorkingDirectory=root,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true };
                info.EnvironmentVariables["LEAFNOTE_PORT"]=port.ToString();info.EnvironmentVariables["LEAFNOTE_LOG_DIR"]=logs;
                using(Process server=Process.Start(info)) {
                    Stopwatch waiting=Stopwatch.StartNew();
                    while(waiting.ElapsedMilliseconds<8000) {
                        if(TryOpenRunningServer(root,file,port,out url))return url;
                        if(server.HasExited)throw new Exception("Leafnote 서버를 시작하지 못했습니다. 임시 폴더의 Leafnote 로그를 확인해주세요.");
                        Thread.Sleep(20);
                    }
                }
                throw new Exception("Leafnote 서버를 시작하지 못했습니다.");
            } finally { gate.ReleaseMutex(); }
        }
    }
    static void OpenWindow(string url) {
        LeafnoteHost.Open(url,Path.GetDirectoryName(Exe));
    }
    [STAThread] static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--open-url") {
                string openedUrl = Encoding.UTF8.GetString(Convert.FromBase64String(args[1]));
                Uri uri;
                if (!Uri.TryCreate(openedUrl,UriKind.Absolute,out uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.AbsolutePath != "/" || !String.IsNullOrEmpty(uri.Fragment))
                    throw new Exception("올바른 Leafnote 창 주소가 아닙니다.");
                string readyUrl;
                if (!TryOpenRunningServer(Path.GetDirectoryName(Exe),null,uri.Port,out readyUrl)) throw new Exception("Leafnote를 다시 실행해주세요.");
                OpenWindow(openedUrl);return 0;
            }
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
            if(LeafnoteApp.TryOpenFile(root,file))return 0;
            OpenWindow(OpenFileUrl(root,file));
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Leafnote", MessageBoxButtons.OK, MessageBoxIcon.Error); return 1;
        }
    }
}
