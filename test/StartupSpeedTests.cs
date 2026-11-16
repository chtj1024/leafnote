using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class StartupSpeedTests {
    static void Check(bool value,string error) { if(!value)throw new Exception(error); }
    [STAThread] static int Main(string[] args) {
        if(args.Length==0)args=File.ReadAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"speed-test-args.txt"));
        string file=Path.Combine(args[2],"speed-report.json");
        try {
            LeafnoteWindow.EnableDpiAwareness();Application.EnableVisualStyles();
            List<object> measurements=new List<object>();
            Exception failure=null;Stopwatch clock=Stopwatch.StartNew();
#if BASELINE
            using(LeafnoteHost host=new LeafnoteHost(args[0],args[1],Path.Combine(args[2],"profile"),null,Path.Combine(args[2],"window-state.json"))) {
                bool loaded=false;
                WebView2 view=null;foreach(Control control in host.Controls)if(control is WebView2)view=(WebView2)control;
                view.CoreWebView2InitializationCompleted+=delegate(object sender,CoreWebView2InitializationCompletedEventArgs e) {
                    if(!e.IsSuccess)throw e.InitializationException;
                    view.CoreWebView2.WebMessageReceived+=delegate(object source,CoreWebView2WebMessageReceivedEventArgs message) {
                        if(message.TryGetWebMessageAsString()=="probe-ready") { loaded=true;measurements.Add(new { elapsedMs=clock.ElapsedMilliseconds,reused=false,darkLoading=false });host.BeginInvoke(new Action(host.Close)); }
                    };
                };
                Application.Run(host);Check(loaded,"Baseline editor did not load");
            }
#else
            string stateFile=Path.Combine(args[2],"window-state.json");
            using(LeafnoteApp app=new LeafnoteApp(args[1],args[0],350,stateFile,Path.Combine(args[2],"profile")))
            using(System.Windows.Forms.Timer reopen=new System.Windows.Forms.Timer { Interval=50 })
            using(System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer { Interval=15000 }) {
                int rounds=0,cancels=0;LeafnoteHost first=null;bool parkedEmpty=false;long secondClosed=0;
                Action<Exception> fail=delegate(Exception error) { failure=error;app.ExitThread(); };
                app.HostOpened+=delegate(LeafnoteHost host,bool reused) {
                    try {
                        if(first==null)first=host;else Check(Object.ReferenceEquals(first,host) && reused,"Reopening created another browser controller");
                        Color dark=Color.FromArgb(32,37,31);
                        Check(host.BackColor==dark,"Native loading background flashed white");
                        WebView2 view=null;foreach(Control control in host.Controls)if(control is WebView2)view=(WebView2)control;
                        Check(view.DefaultBackgroundColor==dark,"Browser loading background flashed white");
                        if(!reused) {
                            view.CoreWebView2InitializationCompleted+=delegate(object sender,CoreWebView2InitializationCompletedEventArgs e) {
                                if(!e.IsSuccess) { fail(e.InitializationException);return; }
                                view.CoreWebView2.WebMessageReceived+=async delegate(object source,CoreWebView2WebMessageReceivedEventArgs message) {
                                    try {
                                        if(message.TryGetWebMessageAsString()=="probe-ready") {
                                            measurements.Add(new { elapsedMs=clock.ElapsedMilliseconds,reused=rounds>0,darkLoading=true });rounds++;
                                            if(rounds==1)await view.ExecuteScriptAsync("globalThis.cancelNext=true");
                                            host.BeginInvoke(new Action(host.Close));
                                        } else if(message.TryGetWebMessageAsString()=="leafnote-close-cancel") {
                                            cancels++;
                                            Check(host.Visible && !host.IsDisposed,"Cancel-close hid the editor");
                                            host.BeginInvoke(new Action(host.Close));
                                        }
                                    } catch(Exception error) { fail(error); }
                                };
                            };
                        }
                    } catch(Exception error) { fail(error); }
                };
                app.BecameIdle+=delegate {
                    try {
                        Check(!first.Visible,"Closed editor remains visible");
                        Check(File.ReadAllText(Path.Combine(args[2],"theme.txt")).Trim()=="dark","Selected theme was not remembered for the next native window");
                        if(rounds==1)reopen.Start();
                        else { secondClosed=Stopwatch.GetTimestamp();timeout.Stop(); }
                    } catch(Exception error) { fail(error); }
                };
                reopen.Tick+=async delegate {
                    reopen.Stop();
                    try {
                        WebView2 view=null;foreach(Control control in first.Controls)if(control is WebView2)view=(WebView2)control;
                        parkedEmpty=(await view.ExecuteScriptAsync("location.href"))=="\"about:blank\"";
                        Check(parkedEmpty,"The closed document was retained in the warm editor");
                        clock.Restart();app.OpenUrl(args[0]);
                    } catch(Exception error) { fail(error); }
                };
                timeout.Tick+=delegate { fail(new Exception("Startup speed check timed out")); };
                timeout.Start();Application.Run(app);
                if(failure!=null)throw failure;
                Check(rounds==2 && parkedEmpty && cancels==1,"Cold/warm opening, close cancellation, and parking did not complete");
                Check(secondClosed>0 && (Stopwatch.GetTimestamp()-secondClosed)*1000/Stopwatch.Frequency>=300,"Idle editor did not honor the bounded retention period");
            }
#endif
            File.WriteAllText(file,new JavaScriptSerializer().Serialize(new { ok=true,measurements=measurements }));return 0;
        } catch(Exception error) { File.WriteAllText(file,new JavaScriptSerializer().Serialize(new { ok=false,error=error.ToString() }));return 1; }
    }
}
