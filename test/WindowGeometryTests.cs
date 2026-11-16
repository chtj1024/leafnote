using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

internal static class WindowGeometryTests {
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int size);
    static void Check(bool condition,string message) { if (!condition) throw new Exception(message); }
    static LeafnoteWindowState State(int x=150,int y=100,int width=800,int height=600,bool maximized=false) {
        return new LeafnoteWindowState { X=x,Y=y,Width=width,Height=height,Maximized=maximized };
    }
    static Rectangle[] Monitors() { return new [] { new Rectangle(0,0,1920,1040),new Rectangle(-1600,0,1600,860) }; }
    [STAThread] static int Main(string[] args) {
        try {
            string file=Path.Combine(args[1],"window-state.json");
            switch (args[0]) {
                case "roundtrip":
                    LeafnoteWindowState state=State(-1500,30,900,700,true);LeafnoteWindow.Save(file,state);
                    Check(state.SameAs(LeafnoteWindow.Load(file)),"Saved position, size or maximization was lost");
                    Check(Directory.GetFiles(args[1],"*.tmp").Length==0,"Temporary preferences were left behind");break;
                case "negative-monitor":
                    state=State(-1500,80,900,700);Check(state.SameAs(LeafnoteWindow.Fit(state,Monitors())),"A valid secondary-monitor position was changed");break;
                case "removed-monitor":
                    state=LeafnoteWindow.Fit(State(-1500,80,900,700),new [] { new Rectangle(0,0,1920,1040) });
                    Check(state.X==0 && state.Y==80 && state.Width==900 && state.Height==700,"A removed monitor left the window off screen");break;
                case "small-screen":
                    state=LeafnoteWindow.Fit(State(1800,900,2000,1600,true),new [] { new Rectangle(0,40,1280,680) });
                    Check(state.X==0 && state.Y==40 && state.Width==1280 && state.Height==680 && state.Maximized,"Smaller screen or top taskbar was not handled");break;
                case "corrupt":
                    Check(LeafnoteWindow.Load(file)==null,"Missing settings should use default placement");
                    File.WriteAllText(file,"broken");Check(LeafnoteWindow.Load(file)==null,"Corrupt settings were accepted");
                    File.WriteAllText(file,"{\"Width\":-1,\"Height\":600}");Check(LeafnoteWindow.Load(file)==null,"Invalid dimensions were accepted");
                    File.WriteAllText(file,new string('x',5000));Check(LeafnoteWindow.Load(file)==null,"Oversized settings were accepted");break;
                case "last-close":
                    LeafnoteWindow.Save(file,State());state=State(250,180,1100,650,true);LeafnoteWindow.Save(file,state);
                    Check(state.SameAs(LeafnoteWindow.Load(file)),"The most recently closed window did not win");break;
                case "concurrent":
                    Thread[] writers=new Thread[4];
                    for (int i=0;i<writers.Length;i++) { int offset=i;writers[i]=new Thread(delegate() { for (int j=0;j<5;j++) LeafnoteWindow.Save(file,State(100+offset,100,800+offset,600)); });writers[i].Start(); }
                    foreach (Thread writer in writers) writer.Join();state=LeafnoteWindow.Load(file);
                    Check(state!=null && state.Width-state.X==700,"Concurrent windows corrupted settings");break;
                case "root-isolation":
                    Check(LeafnoteWindow.RootKey(args[1])==LeafnoteWindow.RootKey(args[1].ToUpperInvariant()),"Windows folder casing changed preference identity");
                    Check(LeafnoteWindow.RootKey(args[1])!=LeafnoteWindow.RootKey(Path.Combine(args[1],"other")),"Different installations share preferences");break;
                case "native":
                    LeafnoteWindow.EnableDpiAwareness();
                    Rectangle work=Screen.PrimaryScreen.WorkingArea;
                    using (Form form=new Form { Text="Leafnote window self-test",ShowInTaskbar=false,Opacity=0,StartPosition=FormStartPosition.Manual }) {
                        form.Bounds=new Rectangle(work.Left+50,work.Top+60,Math.Min(700,work.Width-100),Math.Min(500,work.Height-120));
                        form.Show();Application.DoEvents();
                        state=LeafnoteWindow.Capture(form.Handle);Check(state!=null && state.Valid,"Native window capture failed");
                        LeafnoteWindowState target=LeafnoteWindow.Fit(State(work.Left+90,work.Top+100,600,400),new [] { work });
                        LeafnoteWindow.Restore(form.Handle,target);Application.DoEvents();
                        Check(target.SameAs(LeafnoteWindow.Capture(form.Handle)),"Native size and position did not restore exactly");
                        form.WindowState=FormWindowState.Maximized;Application.DoEvents();
                        state=LeafnoteWindow.Capture(form.Handle);Check(state!=null && state.Maximized,"Native maximized state was lost");
                        form.WindowState=FormWindowState.Minimized;Application.DoEvents();Check(LeafnoteWindow.Capture(form.Handle)==null,"Minimization overwrote the saved size");
                        form.WindowState=FormWindowState.Normal;Application.DoEvents();LeafnoteWindow.Restore(form.Handle,state);Application.DoEvents();
                        Check(state.SameAs(LeafnoteWindow.Capture(form.Handle)),"Maximized window restore bounds were lost");form.Close();
                    }
                    break;
                default: throw new Exception("Unknown geometry test");
            }
            Console.WriteLine("OK: "+args[0]);return 0;
        } catch (Exception error) { Console.Error.WriteLine(error.ToString());return 1; }
    }
}
