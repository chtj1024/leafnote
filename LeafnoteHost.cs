using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// Own the top-level window from creation; the browser only creates child controls.
internal sealed class LeafnoteHost : Form {
    string url;
    readonly string profile, stateFile, themeFile, themeScript;
    readonly WebView2 editor;
    readonly Label loading;
    readonly Panel loadingCover;
    readonly System.Windows.Forms.Timer startupTimeout=new System.Windows.Forms.Timer { Interval=15000 };
    bool ready, closePending, allowClose, initializationStarted, showFailure, shortcutCloseQueued;
    LeafnoteWindowState lastPlacement;
    internal Action<LeafnoteHost> ClosedForReuse;
    internal event Action ContentReady;
    internal bool DocumentReady { get { return ready; } }
    internal bool StartupTransitionsDisabled { get; private set; }
    bool parked;
    internal static bool LoadDark(string file) {
        try { return !File.Exists(file) || File.ReadAllText(file).Trim()!="light"; } catch { return true; }
    }
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
    void ApplyTheme(bool dark,bool persist) {
        Color background=dark ? Color.FromArgb(32,37,31) : Color.White;
        BackColor=background;
        if (loadingCover != null) loadingCover.BackColor=background;
        if (loading != null) { loading.BackColor=background;loading.ForeColor=dark ? Color.FromArgb(154,163,148) : Color.Gray; }
        if (editor != null && editor.DefaultBackgroundColor!=background) editor.DefaultBackgroundColor=background;
        if(IsHandleCreated) {
            try {
                // Avoid DWM animating a newly allocated, not-yet-painted window surface.
                int noTransition=1;StartupTransitionsDisabled=DwmSetWindowAttribute(Handle,3,ref noTransition,sizeof(int))==0;
                int value=dark ? 1 : 0;if(DwmSetWindowAttribute(Handle,20,ref value,sizeof(int))!=0)DwmSetWindowAttribute(Handle,19,ref value,sizeof(int));
            }
            catch(DllNotFoundException) {} catch(EntryPointNotFoundException) {}
        }
        if (persist) {
            try { Directory.CreateDirectory(Path.GetDirectoryName(themeFile));File.WriteAllText(themeFile,dark ? "dark" : "light"); } catch {}
        }
    }
    internal LeafnoteHost(string url,string root,string profile,LeafnoteWindowState saved,string stateFile=null) {
        this.url=url;this.profile=profile;
        this.stateFile=stateFile ?? LeafnoteWindow.StatePath(root);
        themeFile=Path.Combine(Path.GetDirectoryName(this.stateFile),"theme.txt");
        themeScript=Path.Combine(root,"public","theme.js");
        Text="Leafnote";StartPosition=FormStartPosition.Manual;
        DoubleBuffered=true;
        AutoScaleMode=AutoScaleMode.None;
        MinimumSize=new Size(200,120);
        bool dark=LoadDark(themeFile);
        BackColor=dark ? Color.FromArgb(32,37,31) : Color.White;
        Rectangle work=Screen.PrimaryScreen.WorkingArea;
        Bounds=new Rectangle(work.Left+Math.Max(0,(work.Width-1000)/2),work.Top+Math.Max(0,(work.Height-760)/2),Math.Min(1000,work.Width),Math.Min(760,work.Height));
        saved=LeafnoteWindow.Fit(saved,WorkAreas());
        if (saved != null) {
            Bounds=new Rectangle(saved.X,saved.Y,saved.Width,saved.Height);
            if (saved.Maximized) WindowState=FormWindowState.Maximized;
        }
        string icon=Path.Combine(root,"Leafnote.ico");
        if (File.Exists(icon)) Icon=new Icon(icon);
        editor=new WebView2 { Dock=DockStyle.Fill,DefaultBackgroundColor=BackColor };
        // WebView2 forwards native accelerator keys through its KeyDown event.
        editor.KeyDown+=delegate(object sender,KeyEventArgs args) {
            if(args.KeyCode==Keys.W && (args.Modifiers | ModifierKeys)==Keys.Control) {
                args.Handled=true;args.SuppressKeyPress=true;QueueShortcutClose();
            }
        };
        loading=new Label { Text="문서를 여는 중…",Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter };
        // Keep an opaque native sibling above WebView2 until the page has painted.
        loadingCover=new Panel { Dock=DockStyle.Fill,BackColor=BackColor };
        loadingCover.Controls.Add(loading);
        Controls.Add(editor);Controls.Add(loadingCover);loadingCover.BringToFront();
        startupTimeout.Tick+=delegate { ShowError("문서를 준비하지 못했습니다. 창을 닫고 다시 열어주세요."); };
        ApplyTheme(dark,false);
    }
    static Rectangle[] WorkAreas() {
        Screen[] screens=Screen.AllScreens;
        Rectangle[] areas=new Rectangle[screens.Length];
        for (int i=0;i<screens.Length;i++) areas[i]=screens[i].WorkingArea;
        return areas;
    }
    internal static void Open(string url,string root) {
        LeafnoteApp.Open(url,root);
    }
    protected override void SetVisibleCore(bool value) {
        if(value && !ready && !showFailure) {
            // Create HWNDs without WS_VISIBLE. No loading form, transparent form,
            // or off-screen placeholder is ever shown before the document is ready.
            if(!initializationStarted) {
                initializationStarted=true;
                startupTimeout.Start();
                IntPtr window=Handle;
                IntPtr child=editor.Handle;
                BeginInvoke(new Action(InitializeEditor));
            }
            return;
        }
        base.SetVisibleCore(value);
    }
    async void InitializeEditor() {
        try {
            editor.CreationProperties=new CoreWebView2CreationProperties { UserDataFolder=profile };
            await editor.EnsureCoreWebView2Async(null);
            if(IsDisposed)return;
            ConfigureEditor();
            // Run before HTML/CSS parsing, including when an empty controller is reused.
            await editor.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(themeScript));
            if(!IsDisposed)editor.CoreWebView2.Navigate(url);
        } catch(Exception error) {
            ShowError("편집기를 시작하지 못했습니다.\n"+error.Message);
        }
    }
    void ShowError(string message) {
        if(IsDisposed || parked)return;
        startupTimeout.Stop();
        showFailure=true;loading.Text=message;loadingCover.Visible=true;loadingCover.BringToFront();Show();Activate();
    }
    void ConfigureEditor() {
        try {
            if (IsDisposed) return;
            editor.CoreWebView2.DocumentTitleChanged+=delegate {
                string title=editor.CoreWebView2.DocumentTitle;
                Text=String.IsNullOrEmpty(title) ? "Leafnote" : title;
            };
            editor.CoreWebView2.WebMessageReceived+=delegate(object sender,CoreWebView2WebMessageReceivedEventArgs args) {
                Uri source;
                if (!Uri.TryCreate(args.Source,UriKind.Absolute,out source) || source.GetLeftPart(UriPartial.Authority)!=new Uri(url).GetLeftPart(UriPartial.Authority)) return;
                string message;
                try { message=args.TryGetWebMessageAsString(); } catch { return; }
                if (message=="leafnote-theme:dark" || message=="leafnote-theme:light") { ApplyTheme(message.EndsWith(":dark"),true);return; }
                if(message.StartsWith("leafnote-open-error:") && !parked) { ShowError("문서를 열지 못했습니다.\n"+message.Substring("leafnote-open-error:".Length));return; }
                if (message=="leafnote-ready" && !parked) {
                    startupTimeout.Stop();ready=true;showFailure=false;loadingCover.Visible=false;Show();Activate();editor.Focus();
                    if(ContentReady!=null) ContentReady();return;
                }
                if (!closePending) return;
                if (message=="leafnote-close-ok") { allowClose=true;Close(); }
                else if (message=="leafnote-close-cancel") closePending=false;
            };
            editor.CoreWebView2.NavigationStarting+=delegate(object sender,CoreWebView2NavigationStartingEventArgs args) {
                Uri target;
                if (parked && args.Uri=="about:blank") return;
                if (!Uri.TryCreate(args.Uri,UriKind.Absolute,out target) || target.GetLeftPart(UriPartial.Authority)!=new Uri(url).GetLeftPart(UriPartial.Authority)) {
                    args.Cancel=true;OpenExternal(args.Uri);
                }
            };
            editor.CoreWebView2.NewWindowRequested+=delegate(object sender,CoreWebView2NewWindowRequestedEventArgs args) { args.Handled=true;OpenExternal(args.Uri); };
            editor.CoreWebView2.NavigationCompleted+=delegate(object sender,CoreWebView2NavigationCompletedEventArgs args) {
                if (!args.IsSuccess && !parked && args.WebErrorStatus!=CoreWebView2WebErrorStatus.OperationCanceled) ShowError("문서를 열지 못했습니다. 창을 닫고 다시 열어주세요.");
            };
        } catch (Exception error) {
            ShowError("편집기를 시작하지 못했습니다.\n"+error.Message);
        }
    }
    static void OpenExternal(string uri) {
        Uri parsed;
        if (!Uri.TryCreate(uri,UriKind.Absolute,out parsed) || !(parsed.Scheme=="http" || parsed.Scheme=="https" || parsed.Scheme=="mailto")) return;
        Process.Start(new ProcessStartInfo(uri) { UseShellExecute=true });
    }
    void QueueShortcutClose() {
        if(IsDisposed || parked || shortcutCloseQueued)return;
        shortcutCloseQueued=true;
        // Leave the WebView2 accelerator callback before starting the save/close handshake.
        BeginInvoke(new Action(delegate {
            shortcutCloseQueued=false;
            if(!IsDisposed && !parked)Close();
        }));
    }
    protected override bool ProcessCmdKey(ref Message message,Keys keyData) {
        if(keyData==(Keys.Control | Keys.W)) { QueueShortcutClose();return true; }
        return base.ProcessCmdKey(ref message,keyData);
    }
    protected override void OnFormClosing(FormClosingEventArgs e) {
        if (ready && !allowClose) {
            e.Cancel=true;
            if (!closePending) {
                closePending=true;
                editor.CoreWebView2.PostWebMessageAsString("leafnote-close");
            }
        }
        base.OnFormClosing(e);
        if (!e.Cancel) {
            SamplePlacement();LeafnoteWindow.Save(stateFile,lastPlacement);
            if (ClosedForReuse!=null) { e.Cancel=true;Hide();parked=true;ready=false;ClosedForReuse(this); }
        }
    }
    internal void Park() {
        startupTimeout.Stop();
        parked=true;ready=false;closePending=false;allowClose=false;showFailure=false;loadingCover.Visible=true;loadingCover.BringToFront();
        // Drop the closed document while retaining just one browser controller.
        if (editor.CoreWebView2!=null) editor.CoreWebView2.Navigate("about:blank");
    }
    internal void Reopen(string nextUrl,LeafnoteWindowState saved) {
        url=nextUrl;parked=false;ready=false;closePending=false;allowClose=false;showFailure=false;
        Text="Leafnote";loading.Text="문서를 여는 중…";loadingCover.Visible=true;loadingCover.BringToFront();
        ApplyTheme(LoadDark(themeFile),false);
        saved=LeafnoteWindow.Fit(saved,WorkAreas());
        WindowState=FormWindowState.Normal;
        if(saved!=null) { Bounds=new Rectangle(saved.X,saved.Y,saved.Width,saved.Height);if(saved.Maximized)WindowState=FormWindowState.Maximized; }
        startupTimeout.Start();
        editor.CoreWebView2.Navigate(url);Show();
    }
    void SamplePlacement() {
        if (!IsHandleCreated || IsDisposed) return;
        LeafnoteWindowState current=LeafnoteWindow.Capture(Handle);
        if (current != null && current.Valid) lastPlacement=current;
    }
    protected override void WndProc(ref Message message) {
        if(message.Msg==0x14 && message.WParam!=IntPtr.Zero) {
            // Fill the first native erase immediately, before buffered WM_PAINT.
            using(Graphics graphics=Graphics.FromHdc(message.WParam))graphics.Clear(BackColor);
            message.Result=new IntPtr(1);return;
        }
        base.WndProc(ref message);
    }
    protected override void OnShown(EventArgs e) { base.OnShown(e);SamplePlacement(); }
    protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e);ApplyTheme(LoadDark(themeFile),false); }
    protected override void OnMove(EventArgs e) { base.OnMove(e);SamplePlacement(); }
    protected override void OnResize(EventArgs e) { base.OnResize(e);SamplePlacement(); }
    protected override void Dispose(bool disposing) {
        if (disposing) { startupTimeout.Dispose();editor.Dispose();loadingCover.Dispose(); }
        base.Dispose(disposing);
    }
}
