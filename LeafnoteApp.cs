using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class LeafnoteOpenRequest {
    public int Version=1;
    public string Kind, Value;
}

// One UI process owns the windows and retains at most one empty editor for two minutes.
internal sealed class LeafnoteApp : ApplicationContext {
    static readonly string BuildKey=typeof(LeafnoteApp).Assembly.ManifestModule.ModuleVersionId.ToString("N");
    readonly string root,profile,stateFile;
    readonly Control dispatcher=new Control();
    readonly List<LeafnoteHost> active=new List<LeafnoteHost>();
    readonly System.Windows.Forms.Timer idle;
    LeafnoteHost parked;
    volatile bool stopping;
    NamedPipeServerStream waitingPipe;
    readonly object pipeGate=new object();
    internal event Action<LeafnoteHost,bool> HostOpened;
    internal event Action BecameIdle;
    internal LeafnoteApp(string root,string url,int idleMilliseconds=120000,string stateFile=null,string profile=null) {
        this.root=root;this.stateFile=stateFile ?? LeafnoteWindow.StatePath(root);
        this.profile=profile ?? Path.Combine(Path.GetDirectoryName(this.stateFile),"webview");
        IntPtr handle=dispatcher.Handle;
        idle=new System.Windows.Forms.Timer { Interval=idleMilliseconds };
        idle.Tick+=delegate { idle.Stop();ExitThread(); };
        new Thread(Listen) { IsBackground=true,Name="Leafnote file requests" }.Start();
        dispatcher.BeginInvoke(new Action(delegate { OpenUrl(url); }));
    }
    internal static string PipeName(string root) { return "Leafnote-UI-"+LeafnoteWindow.RootKey(root)+"-"+Process.GetCurrentProcess().SessionId+"-"+BuildKey; }
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool AllowSetForegroundWindow(int processId);
    static bool Send(string root,LeafnoteOpenRequest request,int timeout=20) {
        try {
            // Let the running UI process bring an already open window to the front.
            AllowSetForegroundWindow(-1);
            using (NamedPipeClientStream pipe=new NamedPipeClientStream(".",PipeName(root),PipeDirection.InOut,PipeOptions.Asynchronous)) {
                pipe.Connect(timeout);
                byte[] bytes=Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(request));
                if(bytes.Length>32768) return false;
                using(BinaryWriter writer=new BinaryWriter(pipe,Encoding.UTF8,true)) { writer.Write(bytes.Length);writer.Write(bytes);writer.Flush(); }
                byte[] ack=new byte[1];var read=pipe.ReadAsync(ack,0,1);
                return read.Wait(1000) && read.Result==1 && ack[0]==1;
            }
        } catch(IOException) { return false; } catch(TimeoutException) { return false; } catch(UnauthorizedAccessException) { return false; } catch(AggregateException) { return false; }
    }
    internal static bool TryOpenFile(string root,string file) { return Send(root,new LeafnoteOpenRequest { Kind="file",Value=file }); }
    internal static void Open(string url,string root) {
        using(Mutex gate=new Mutex(false,"Local\\"+PipeName(root))) {
            bool owned;
            try { owned=gate.WaitOne(0); } catch(AbandonedMutexException) { owned=true; }
            if(!owned) {
                Stopwatch wait=Stopwatch.StartNew();
                do { if(Send(root,new LeafnoteOpenRequest { Kind="url",Value=url },75)) return;Thread.Sleep(20); } while(wait.ElapsedMilliseconds<3000);
                throw new Exception("Leafnote 창이 준비 중입니다. 잠시 후 다시 열어주세요.");
            }
            try {
                LeafnoteWindow.EnableDpiAwareness();Application.EnableVisualStyles();
                using(LeafnoteApp app=new LeafnoteApp(root,url)) Application.Run(app);
            } finally { gate.ReleaseMutex(); }
        }
    }
    void Listen() {
        PipeSecurity security=new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null),PipeAccessRights.FullControl,AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
        while(!stopping) {
            try {
                using(NamedPipeServerStream pipe=new NamedPipeServerStream(PipeName(root),PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,security)) {
                    lock(pipeGate) { if(stopping)return;waitingPipe=pipe; }
                    pipe.WaitForConnection();
                    LeafnoteOpenRequest request;
                    using(BinaryReader reader=new BinaryReader(pipe,Encoding.UTF8,true)) {
                        int length=reader.ReadInt32();if(length<1 || length>32768)continue;
                        byte[] bytes=reader.ReadBytes(length);if(bytes.Length!=length)continue;
                        request=new JavaScriptSerializer { MaxJsonLength=32768 }.Deserialize<LeafnoteOpenRequest>(Encoding.UTF8.GetString(bytes));
                    }
                    if(request==null || request.Version!=1 || !(request.Kind=="file" || request.Kind=="url"))continue;
                    dispatcher.BeginInvoke(new Action(delegate { Handle(request); }));
                    pipe.WriteByte(1);pipe.Flush();
                }
            } catch(IOException) {} catch(ObjectDisposedException) {} catch(InvalidOperationException) { if(stopping)return; } catch(ArgumentException) {}
            finally { lock(pipeGate) { waitingPipe=null; } }
        }
    }
    void Handle(LeafnoteOpenRequest request) {
        try {
            string url;
            if(request.Kind=="file") {
                string file=request.Value;
                if(file!=null && (!Path.IsPathRooted(file) || !File.Exists(file) || !(Path.GetExtension(file).Equals(".md",StringComparison.OrdinalIgnoreCase) || Path.GetExtension(file).Equals(".markdown",StringComparison.OrdinalIgnoreCase))))
                    throw new Exception("기존 마크다운 파일을 선택해주세요.");
                url=LeafnoteLauncher.OpenFileUrl(root,file);
            } else {
                Uri uri;
                if(!Uri.TryCreate(request.Value,UriKind.Absolute,out uri) || uri.Scheme!="http" || uri.Host!="127.0.0.1" || uri.AbsolutePath!="/" || !String.IsNullOrEmpty(uri.Fragment))throw new Exception("올바른 Leafnote 주소가 아닙니다.");
                string checkedUrl;
                if(!LeafnoteLauncher.TryOpenRunningServer(root,null,uri.Port,out checkedUrl))throw new Exception("Leafnote 서버를 다시 실행해주세요.");
                url=request.Value;
            }
            OpenUrl(url);
        } catch(Exception error) { MessageBox.Show(error.Message,"Leafnote",MessageBoxButtons.OK,MessageBoxIcon.Error); }
    }
    LeafnoteHost FindDocument(string id,LeafnoteHost except) {
        if(id==null) return null;
        foreach(LeafnoteHost host in active) if(host!=except && !host.IsDisposed && host.DocumentId==id) return host;
        return null;
    }
    bool FocusDocument(LeafnoteHost requester,string id) {
        LeafnoteHost existing=FindDocument(id,requester);
        if(existing==null) return false;
        existing.BringToUser();return true;
    }
    internal void OpenUrl(string url) {
        // A file that is already open keeps its single window.
        LeafnoteHost existing=FindDocument(LeafnoteHost.DocumentIdOf(url),null);
        if(existing!=null) { existing.BringToUser();return; }
        idle.Stop();
        bool reused=parked!=null && !parked.IsDisposed;
        LeafnoteHost host;
        if(reused) { host=parked;parked=null; }
        else { host=new LeafnoteHost(url,root,profile,LeafnoteWindow.Load(stateFile),stateFile);host.ClosedForReuse=OnClosed;host.FocusDocument=FocusDocument; }
        active.Add(host);
        if(HostOpened!=null)HostOpened(host,reused);
        if(reused)host.Reopen(url,LeafnoteWindow.Load(stateFile));else host.Show();
    }
    void OnClosed(LeafnoteHost host) {
        active.Remove(host);
        if(active.Count==0) {
            if(parked!=null && parked!=host)parked.Dispose();
            parked=host;host.Park();idle.Start();
            if(BecameIdle!=null)BecameIdle();
        } else dispatcher.BeginInvoke(new Action(host.Dispose));
    }
    protected override void ExitThreadCore() { stopping=true;base.ExitThreadCore(); }
    protected override void Dispose(bool disposing) {
        if(disposing) {
            stopping=true;lock(pipeGate) { if(waitingPipe!=null)waitingPipe.Dispose(); }
            idle.Dispose();foreach(LeafnoteHost host in active)host.Dispose();if(parked!=null)parked.Dispose();dispatcher.Dispose();
        }
        base.Dispose(disposing);
    }
}
