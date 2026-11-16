using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows.Forms;

internal static class LeafnoteBootstrap {
    [STAThread] static int Main(string[] args) {
        try {
            string app = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "app", "Leafnote.exe");
            if (!File.Exists(app))
                throw new Exception("Leafnote 파일이 모두 있는 폴더에서 실행해주세요.\n압축 프로그램 안에서 바로 실행하지 말고, 압축을 완전히 푼 뒤 Leafnote 폴더의 Leafnote.exe를 실행해주세요.");
            StringBuilder arguments = new StringBuilder();
            foreach (string argument in args) {
                if (arguments.Length > 0) arguments.Append(' ');
                arguments.Append('"').Append(argument.Replace("\"", "\\\"")).Append('"');
            }
            Process.Start(new ProcessStartInfo(app, arguments.ToString()) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(app) });
            return 0;
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Leafnote", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
