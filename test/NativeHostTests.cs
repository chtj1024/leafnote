using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

internal static class NativeHostTests {
    static void Check(bool condition,string message) { if (!condition) throw new Exception(message); }
    [STAThread] static int Main(string[] args) {
        if(args.Length==0) args=File.ReadAllLines(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"native-test-args.txt"));
        try {
            LeafnoteWindow.EnableDpiAwareness();Application.EnableVisualStyles();
            Rectangle area=Screen.PrimaryScreen.WorkingArea;
            LeafnoteWindowState saved=args[0]=="default" ? null : new LeafnoteWindowState { X=area.Left+95,Y=area.Top+115,Width=710,Height=460,Maximized=args[0]=="maximized" };
            Exception failure=null;int shows=0,cancels=0;bool loaded=false,closed=false;
            LeafnoteWindowState first=null;
            using (LeafnoteHost host=new LeafnoteHost(args[1],args[2],Path.Combine(args[3],"profile"),saved,Path.Combine(args[3],"window-state.json")))
            using (System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer { Interval=20000 }) {
                WebView2 view=null;
                foreach(Control control in host.Controls) if(control is WebView2) view=(WebView2)control;
                Check(view!=null && view.Parent==host,"Editor is not embedded in the app's own window");
                Action<Exception> fail=delegate(Exception error) { Console.Error.WriteLine(error);Console.Error.Flush();failure=error;timeout.Stop();host.Dispose();Application.ExitThread(); };
                host.Shown+=delegate {
                    Console.WriteLine("shown; view="+view.Visible+"; size="+view.ClientSize+"; handle="+view.IsHandleCreated);Console.Out.Flush();
                    try {
                        shows++;first=LeafnoteWindow.Capture(host.Handle);
                        Check(first!=null && first.Valid,"The first visible frame has no valid placement");
                        Check(saved==null || LeafnoteWindow.Fit(saved,new [] { area }).SameAs(first),"The first visible frame used the browser's old position");
                    } catch(Exception error) { fail(error); }
                };
                host.FormClosed+=delegate { closed=true;timeout.Stop(); };
                view.CoreWebView2InitializationCompleted+=delegate(object sender,CoreWebView2InitializationCompletedEventArgs e) {
                    Console.WriteLine("initialized "+e.IsSuccess);Console.Out.Flush();
                    if(!e.IsSuccess) { fail(e.InitializationException);return; }
                    view.CoreWebView2.WebMessageReceived+=delegate(object source,CoreWebView2WebMessageReceivedEventArgs message) {
                        try {
                            string value=message.TryGetWebMessageAsString();
                            Console.WriteLine("message "+value);Console.Out.Flush();
                            if(value=="probe-ready") {
                                loaded=true;
                                Check(first.SameAs(LeafnoteWindow.Capture(host.Handle)),"The app moved or resized after the editor loaded");
                                Check(shows==1,"The app was hidden and shown again during startup");
                                host.BeginInvoke(new Action(host.Close));
                            } else if(value=="leafnote-close-cancel") {
                                cancels++;
                                // Allow the host's close-result listener to complete before trying again.
                                host.BeginInvoke(new Action(delegate {
                                    try { Check(!host.IsDisposed && host.Visible,"Cancelling lost the open document");host.Close(); }
                                    catch(Exception error) { fail(error); }
                                }));
                            }
                        } catch(Exception error) { fail(error); }
                    };
                };
                timeout.Tick+=delegate { fail(new Exception("Native editor startup or close handshake timed out")); };
                timeout.Start();Console.WriteLine("running");Console.Out.Flush();Application.Run(host);
                if(failure!=null) throw failure;
                Check(loaded && closed && cancels==1,"Editor load, cancel-close and confirmed-close did not complete");
                Check(first.SameAs(LeafnoteWindow.Load(Path.Combine(args[3],"window-state.json"))),"The native window lost its final size and position");
            }
            string result="OK: native "+args[0]+"; first visible frame preserved; document loaded; close cancelled and confirmed";
            File.WriteAllText(Path.Combine(args[3],"native-test-result.txt"),result);Console.WriteLine(result);return 0;
        } catch(Exception error) { File.WriteAllText(Path.Combine(args[3],"native-test-result.txt"),error.ToString());Console.Error.WriteLine(error);return 1; }
    }
}
