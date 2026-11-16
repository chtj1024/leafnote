using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
internal static class NativeVisibilityTests {
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window,int index);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,int message,IntPtr first,IntPtr second);
    static void Check(bool value,string message) { if(!value)throw new Exception(message); }
    static void CheckCloseShortcut(string root,string dir) {
        using(LeafnoteHost host=new LeafnoteHost("http://127.0.0.1:1",root,Path.Combine(dir,"profile"),null,Path.Combine(dir,"window-state.json")))
        using(LeafnoteHost other=new LeafnoteHost("http://127.0.0.1:1",root,Path.Combine(dir,"profile"),null,Path.Combine(dir,"window-state.json"))) {
            IntPtr handle=host.Handle;int closing=0;bool cancel=true;
            host.FormClosing+=delegate(object sender,FormClosingEventArgs e) { closing++;e.Cancel=cancel; };
            Message message=Message.Create(handle,0x100,new IntPtr((int)Keys.W),IntPtr.Zero);
            object[] parameters=new object[] {message,Keys.Control | Keys.W};
            bool handled=(bool)typeof(LeafnoteHost).GetMethod("ProcessCmdKey",BindingFlags.Instance|BindingFlags.NonPublic).Invoke(host,parameters);
            Check(handled && closing==0,"Ctrl+W was not deferred out of the keyboard callback");
            Application.DoEvents();Check(closing==1 && !host.IsDisposed,"Cancelling Ctrl+W lost the current window");
            WebView2 view=null;foreach(Control control in host.Controls)if(control is WebView2)view=(WebView2)control;
            MethodInfo keyDown=typeof(Control).GetMethod("OnKeyDown",BindingFlags.Instance|BindingFlags.NonPublic);
            foreach(Keys keys in new [] { Keys.W,Keys.Control|Keys.Shift|Keys.W,Keys.Control|Keys.Alt|Keys.W }) {
                KeyEventArgs ignored=new KeyEventArgs(keys);keyDown.Invoke(view,new object[] {ignored});Application.DoEvents();
                Check(!ignored.Handled && closing==1,"Another shortcut was treated as Ctrl+W");
            }
            KeyEventArgs fromEditor=new KeyEventArgs(Keys.Control|Keys.W);keyDown.Invoke(view,new object[] {fromEditor});Application.DoEvents();
            Check(fromEditor.Handled && closing==2 && !host.IsDisposed,"Editor Ctrl+W bypassed cancellation");
            cancel=false;keyDown.Invoke(view,new object[] {new KeyEventArgs(Keys.Control|Keys.W)});Application.DoEvents();
            Check(closing==3 && host.IsDisposed && !other.IsDisposed,"Ctrl+W did not close only the current window");
        }
    }
    [STAThread] static int Main(string[] args) {
        try {
            LeafnoteWindow.EnableDpiAwareness();Application.EnableVisualStyles();
            File.WriteAllText(Path.Combine(args[1],"theme.txt"),"dark");
            foreach(bool maximized in new [] { false,true }) {
                using(LeafnoteHost host=new LeafnoteHost("http://127.0.0.1:1",args[0],Path.Combine(args[1],"profile"),new LeafnoteWindowState {X=120,Y=150,Width=720,Height=480,Maximized=maximized},Path.Combine(args[1],"window-state.json"))) {
                    host.Show();
                    Check(host.IsHandleCreated && !host.Visible && !host.DocumentReady,"A blank startup form was shown before the editor initialized");
                    Check((GetWindowLong(host.Handle,-16)&0x10000000)==0,"The native startup HWND had WS_VISIBLE");
                    Check(host.StartupTransitionsDisabled,"DWM rejected disabling Leafnote's window transitions");
                    using(Bitmap bitmap=new Bitmap(64,64)) {
                        using(Graphics graphics=Graphics.FromImage(bitmap)) {
                            graphics.Clear(Color.White);IntPtr dc=graphics.GetHdc();
                            try { Check(SendMessage(host.Handle,0x14,dc,IntPtr.Zero)==new IntPtr(1),"The first background erase was not handled"); }
                            finally { graphics.ReleaseHdc(dc); }
                        }
                        Check(bitmap.GetPixel(0,0).ToArgb()==Color.FromArgb(32,37,31).ToArgb() && bitmap.GetPixel(63,63).ToArgb()==Color.FromArgb(32,37,31).ToArgb(),"The first native erase left a white surface");
                    }
                }
            }
            CheckCloseShortcut(args[0],args[1]);
            Console.WriteLine("OK: normal and maximized startup HWNDs hidden; transitions disabled; first native erase dark; Ctrl+W closes only the current window and honors cancellation");return 0;
        } catch(Exception error) { Console.Error.WriteLine(error);return 1; }
    }
}
