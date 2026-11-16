using System;
internal static class LauncherServerTests {
    static int Main(string[] args) {
        try { Console.WriteLine(LeafnoteLauncher.OpenFileUrl(args[0],args[1]=="-" ? null : args[1],Int32.Parse(args[2])));return 0; }
        catch(Exception error) { Console.Error.WriteLine(error.Message);return 1; }
    }
}
