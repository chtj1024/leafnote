using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class FirstPaintTests {
    static void Check(bool value,string message) { if(!value)throw new Exception(message); }
    [STAThread] static int Main(string[] args) {
        if(args.Length==0)args=File.ReadAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"paint-test-args.txt"));
        string report=Path.Combine(args[2],"paint-report.json");
        try {
            LeafnoteWindow.EnableDpiAwareness();Application.EnableVisualStyles();
            List<object> results=new List<object>();Exception failure=null;int rounds=0;
            Stopwatch clock=Stopwatch.StartNew();LeafnoteHost first=null;
            using(LeafnoteApp app=new LeafnoteApp(args[1],args[0]+"/seed",350,Path.Combine(args[2],"window-state.json"),Path.Combine(args[2],"profile")))
            using(System.Windows.Forms.Timer reopen=new System.Windows.Forms.Timer { Interval=50 })
            using(System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer { Interval=20000 }) {
                Action<Exception> fail=delegate(Exception error) { failure=error;app.ExitThread(); };
                app.HostOpened+=delegate(LeafnoteHost host,bool reused) {
                    if(first!=null) { if(first!=host || !reused)fail(new Exception("Warm open did not reuse the editor"));return; }
                    first=host;WebView2 view=null;Panel cover=null;List<string> colors=new List<string>();bool revealed=false;
                    foreach(Control control in host.Controls) { if(control is WebView2)view=(WebView2)control;if(control is Panel)cover=(Panel)control; }
                    host.VisibleChanged+=delegate {
                        if(host.Visible) {
                            try {
                                Check(host.DocumentReady,"A startup/loading window appeared before the document was ready");
                                Check(!cover.Visible,"The first visible window still showed a loading placeholder");
                                Check(host.StartupTransitionsDisabled,"DWM startup transitions were enabled");
                            } catch(Exception error) { fail(error); }
                        }
                    };
                    view.CoreWebView2InitializationCompleted+=delegate(object sender,CoreWebView2InitializationCompletedEventArgs e) {
                        if(!e.IsSuccess) { fail(e.InitializationException);return; }
                        view.CoreWebView2.WebMessageReceived+=delegate(object source,CoreWebView2WebMessageReceivedEventArgs message) {
                            try {
                                string text=message.TryGetWebMessageAsString();
                                if(!text.StartsWith("probe-color:"))return;
                                if(revealed && host.Visible) {
                                    colors.Add(text.Substring(12));
                                    Check(text.Substring(12)=="rgb(32, 37, 31)|dark","First visible page flashed another theme: "+text);
                                    if(colors.Count==2) {
                                        results.Add(new { warm=rounds>0,elapsedMs=clock.ElapsedMilliseconds,initialFrames=colors.Count,allDark=true,noEarlyWindow=true });
                                        revealed=false;rounds++;host.BeginInvoke(new Action(host.Close));
                                    }
                                }
                            } catch(Exception error) { fail(error); }
                        };
                    };
                    host.ContentReady+=delegate {
                        try {
                            revealed=true;Check(!cover.Visible,"Painted editor remained covered");
                            Check(host.Visible && host.DocumentReady,"The prepared editor did not appear");colors.Clear();
                        } catch(Exception error) { fail(error); }
                    };
                };
                app.BecameIdle+=delegate { if(rounds==1)reopen.Start();else timeout.Stop(); };
                reopen.Tick+=delegate { reopen.Stop();clock.Restart();app.OpenUrl(args[0]); };
                timeout.Tick+=delegate { fail(new Exception("First-paint check timed out")); };
                timeout.Start();Application.Run(app);
                if(failure!=null)throw failure;Check(rounds==2,"Cold and warm first-paint checks did not complete");
            }
            File.WriteAllText(report,new JavaScriptSerializer().Serialize(new { ok=true,results=results }));return 0;
        } catch(Exception error) { File.WriteAllText(report,new JavaScriptSerializer().Serialize(new { ok=false,error=error.ToString() }));return 1; }
    }
}
