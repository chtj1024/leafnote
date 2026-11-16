using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class LeafnoteWindowState {
    public int Version = 1;
    public int X, Y, Width, Height;
    public bool Maximized;
    [ScriptIgnore] public bool Valid { get { return Version == 1 && Width >= 200 && Height >= 120 && Width <= 32768 && Height <= 32768 && Math.Abs((long)X) <= 100000 && Math.Abs((long)Y) <= 100000; } }
    public bool SameAs(LeafnoteWindowState other) {
        return other != null && X == other.X && Y == other.Y && Width == other.Width && Height == other.Height && Maximized == other.Maximized;
    }
}

internal static class LeafnoteWindow {
    internal static string RootKey(string root) {
        using (SHA256 hash = SHA256.Create()) {
            return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(root).TrimEnd('\\').ToLowerInvariant()))).Replace("-", "").Substring(0,20);
        }
    }
    internal static string StatePath(string root) {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Leafnote", RootKey(root), "window-state.json");
    }
    internal static LeafnoteWindowState Load(string file) {
        try {
            if (!File.Exists(file) || new FileInfo(file).Length > 4096) return null;
            LeafnoteWindowState state = new JavaScriptSerializer().Deserialize<LeafnoteWindowState>(File.ReadAllText(file,Encoding.UTF8));
            return state != null && state.Valid ? state : null;
        } catch { return null; }
    }
    internal static void Save(string file, LeafnoteWindowState state) {
        if (state == null || !state.Valid) return;
        string temporary = null;
        try {
            using (Mutex gate = new Mutex(false, @"Local\Leafnote-Window-Store-" + RootKey(file))) {
                bool locked = false;
                try {
                    try { locked = gate.WaitOne(2000); } catch (AbandonedMutexException) { locked = true; }
                    if (!locked) return;
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
                    File.WriteAllText(temporary,new JavaScriptSerializer().Serialize(state),new UTF8Encoding(false));
                    if (File.Exists(file)) File.Replace(temporary,file,null);
                    else File.Move(temporary,file);
                    temporary = null;
                } finally { if (locked) gate.ReleaseMutex(); }
            }
        } catch { /* A preference error must never interrupt editing. */ }
        finally { if (temporary != null) { try { File.Delete(temporary); } catch {} } }
    }
    internal static LeafnoteWindowState Fit(LeafnoteWindowState state, Rectangle[] workAreas) {
        if (state == null || !state.Valid || workAreas.Length == 0) return null;
        Rectangle saved = new Rectangle(state.X,state.Y,state.Width,state.Height), chosen = workAreas[0];
        long bestArea = -1, bestDistance = Int64.MaxValue;
        foreach (Rectangle area in workAreas) {
            Rectangle overlap = Rectangle.Intersect(saved,area);
            long visible = (long)Math.Max(0,overlap.Width) * Math.Max(0,overlap.Height);
            long dx = (long)saved.Left + saved.Width / 2 - (area.Left + area.Width / 2);
            long dy = (long)saved.Top + saved.Height / 2 - (area.Top + area.Height / 2);
            long distance = dx * dx + dy * dy;
            if (visible > bestArea || (visible == bestArea && distance < bestDistance)) { chosen = area; bestArea = visible; bestDistance = distance; }
        }
        int width = Math.Min(state.Width,chosen.Width), height = Math.Min(state.Height,chosen.Height);
        return new LeafnoteWindowState {
            X = Math.Max(chosen.Left,Math.Min(state.X,chosen.Right-width)),
            Y = Math.Max(chosen.Top,Math.Min(state.Y,chosen.Bottom-height)),
            Width = width, Height = height, Maximized = state.Maximized
        };
    }
    static Rectangle[] WorkAreas() {
        Screen[] screens = Screen.AllScreens;
        Rectangle[] result = new Rectangle[screens.Length];
        for (int i = 0; i < screens.Length; i++) result[i] = screens[i].WorkingArea;
        return result;
    }
    internal static void EnableDpiAwareness() {
        try { if (Native.SetProcessDpiAwarenessContext(new IntPtr(-4))) return; } catch (EntryPointNotFoundException) {}
        try { Native.SetProcessDPIAware(); } catch (EntryPointNotFoundException) {}
    }
    internal static LeafnoteWindowState Capture(IntPtr window) {
        if (!Native.IsWindow(window) || Native.IsIconic(window)) return null;
        Native.Placement placement = new Native.Placement(); placement.Length = Marshal.SizeOf(typeof(Native.Placement));
        if (!Native.GetWindowPlacement(window,ref placement)) return null;
        Native.Rect bounds;
        bool maximized = Native.IsZoomed(window);
        if (!maximized && Native.GetWindowRect(window,out bounds)) {
            return new LeafnoteWindowState { X=bounds.Left,Y=bounds.Top,Width=bounds.Right-bounds.Left,Height=bounds.Bottom-bounds.Top,Maximized=false };
        }
        bounds = placement.Normal;
        Screen screen = Screen.FromHandle(window);
        return new LeafnoteWindowState {
            X=bounds.Left+screen.WorkingArea.Left-screen.Bounds.Left,
            Y=bounds.Top+screen.WorkingArea.Top-screen.Bounds.Top,
            Width=bounds.Right-bounds.Left,Height=bounds.Bottom-bounds.Top,Maximized=maximized
        };
    }
    internal static void Restore(IntPtr window, LeafnoteWindowState state) {
        state = Fit(state,WorkAreas());
        if (state == null) return;
        ApplyPlacement(window,state,state.Maximized ? 3 : 1);
    }
    static void ApplyPlacement(IntPtr window, LeafnoteWindowState state, int show) {
        Screen screen = Screen.FromRectangle(new Rectangle(state.X,state.Y,state.Width,state.Height));
        int x = state.X-screen.WorkingArea.Left+screen.Bounds.Left, y = state.Y-screen.WorkingArea.Top+screen.Bounds.Top;
        Native.Placement placement = new Native.Placement {
            Length=Marshal.SizeOf(typeof(Native.Placement)), Show=show,
            Minimum=new Native.Point { X=-1,Y=-1 },Maximum=new Native.Point { X=-1,Y=-1 },
            Normal=new Native.Rect { Left=x,Top=y,Right=x+state.Width,Bottom=y+state.Height }
        };
        Native.SetWindowPlacement(window,ref placement);
    }
    static class Native {
        [StructLayout(LayoutKind.Sequential)] internal struct Rect { internal int Left,Top,Right,Bottom; }
        [StructLayout(LayoutKind.Sequential)] internal struct Point { internal int X,Y; }
        [StructLayout(LayoutKind.Sequential)] internal struct Placement { internal int Length,Flags,Show;internal Point Minimum,Maximum;internal Rect Normal; }
        [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr context);
        [DllImport("user32.dll")] internal static extern bool SetProcessDPIAware();
        [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool IsZoomed(IntPtr window);
        [DllImport("user32.dll")] internal static extern bool GetWindowPlacement(IntPtr window,ref Placement placement);
        [DllImport("user32.dll")] internal static extern bool SetWindowPlacement(IntPtr window,ref Placement placement);
        [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window,out Rect bounds);
    }
}
