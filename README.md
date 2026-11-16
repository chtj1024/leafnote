# Leafnote

**A lightweight, offline, block-based Markdown editor for Windows.**
Edit the `.md` files already on your PC in a Notion-style block editor. No account, no cloud, no internet connection required.

- Edits your original files directly (no hidden database, no copies)
- Block editing with `/` slash commands, drag-and-drop reordering, tables, checklists, and highlights
- Autosave, light/dark theme, and raw Markdown view
- Zero npm dependencies: just Node.js 18+ and plain HTML/CSS/JS

## Quick start

### Download (no build needed)

1. Download `Leafnote-vX.Y.Z-win-x64.zip` from the [Releases](https://github.com/chtj1024/leafnote/releases/latest) page and extract it completely (do not run it from inside the zip viewer).
2. Run `Leafnote.exe`. Node.js is bundled, so nothing else needs to be installed. On the first launch it asks whether to make Leafnote your default app for `.md` files.

Windows SmartScreen may warn about an unsigned app on first run; choose **More info → Run anyway**. The Microsoft Edge WebView2 Runtime is required (included with Windows 11 and current Windows 10).

Maintainers: `powershell -ExecutionPolicy Bypass -File package-release.ps1 -Version X.Y.Z` builds the exe and creates the release zip (with a SHA-256-verified Node.js) in `dist/`.

### Build from source

**Requirements:** Windows 10/11 x64, [Node.js](https://nodejs.org/) 18 or later, and the Microsoft Edge WebView2 Runtime (included on this PC).

```bash
git clone https://github.com/chtj1024/leafnote.git
cd leafnote
powershell -ExecutionPolicy Bypass -File build-launcher.ps1
```

`build-launcher.ps1` builds the native window and launcher into `Leafnote.exe` with the .NET Framework compiler (`csc.exe`) that ships with Windows. Keep the included WebView2 SDK DLLs beside the executable. Then run `Leafnote.exe` (or `start.cmd`). The launcher automatically finds an installed Node.js runtime.

Run `stop.cmd` to stop the local server. Make sure your work is saved first.

You can also run the server without the launcher:

```bash
npm start
```

## Opening and saving files

| Action | How |
| --- | --- |
| New document | **New** button or `Ctrl+N`. Lives in memory until you save. |
| Open | **Open** button or `Ctrl+O` (Windows file picker) |
| Save | **Save** button or `Ctrl+S` |
| Save as | **⋯ → Save as** or `Ctrl+Shift+S` |
| Close window | `Ctrl+W`. Uses the same save and unsaved-changes checks as the window's Close button. |

- Documents linked to a file autosave about 0.65 seconds after your last edit.
- If you have unsaved changes, you can choose Save, Don't save, or Cancel.
- The full path of the open file is shown under its name. Rename files in Explorer or use Save as.
- Existing files are updated in place rather than replaced, so desktop icon positions and file attributes are kept.
- The launcher and editor check that the running server actually uses in-place saves. If an older server is still running after an update, save all documents, run `stop.cmd`, and reopen your Markdown file before continuing.
- The light/dark toggle is in the top right. Theme and editor font size are remembered in the browser.

**Conflict protection:** if the file is changed by another window or program, Leafnote will not overwrite it. Use **Save as** to keep your version, then reopen the original. If the original is deleted or moved, Leafnote will not silently recreate it.

**Encodings:** UTF-8, UTF-8 with BOM, UTF-16 LE, and UTF-16 BE. The original encoding, BOM, and line endings are kept. Files up to 4 MB are supported.

## Editing

- Use the font-size selector in the toolbar to change the editor text size (10–36 px). Headings, tables, code, and Markdown view scale with it. The setting is remembered across windows and does not change file contents.
- Type `/` in an empty block to insert text, headings, lists, checklists, quotes, code, dividers, or tables.
- Drag the handle on the left of a block to reorder it, or click it to change the block type.
- Bold `Ctrl+B`, italic `Ctrl+I`, underline `Ctrl+U`, and strikethrough.
- Select text to show 7 soft highlight colors and a clear-highlight tool. The **A** button in the toolbar does the same.
- Tables size to their content. Click a cell to add or remove rows and columns, delete the table, or continue writing below it. A final table always has a blank paragraph below it.
- In a table, Up/Down moves to the same column in the previous/next row. Left/Right moves to the neighboring cell at the start/end of its text; inside text it moves the caret. Up from the first row and Down from the last row moves outside the table. Shift+arrows keeps selecting text. Tab/Enter navigation and pasting TSV data are also supported.
- `Ctrl+Z` / `Ctrl+Shift+Z`: undo / redo block edits.
- **Markdown view** lets you edit the raw source. Underline and highlight colors are saved as a small set of HTML tags. Use Markdown view when you need to keep syntax the block editor does not support.

## Open `.md` files with Leafnote (Windows)

`Leafnote.exe` opens files directly and starts Node.js itself when the server is stopped, without starting PowerShell. `launch.ps1` remains available as a manual startup helper.

While windows are open, one native UI process handles new file requests. After the last window closes, it clears that document and retains one empty WebView2 controller for up to two minutes. Reopening during that period reuses the controller; after two minutes the UI process exits. The first open still needs to initialize WebView2.

The UI broker is scoped to the executable build, so newly opened windows use an updated executable immediately even while an older version still has an open window.

Leafnote remembers the position, size and maximized state of the last window you close. New app windows restore that placement. Minimized windows reopen normally, and windows are kept on an available display if your monitor setup changes. This applies to windows opened with the updated launcher.

Leafnote creates its own native window with the saved bounds before its first display. The editor runs inside that window through WebView2; no separate Edge app window is created or moved after appearing.

Window preferences are stored in `%LOCALAPPDATA%\Leafnote\<installation hash>\window-state.json`. The WebView2 profile in the neighboring `webview/` folder remembers UI preferences, including font size and theme. `theme.txt` also remembers the theme for the native background and title bar. The native window stays hidden until the requested document is ready; startup failures reveal a themed error screen. Each installation keeps separate settings. Closing the native window first asks the editor to save changes or show its existing unsaved-changes dialog.

The native host injects `public/theme.js` before HTML parsing so the first web frame uses the saved theme. It creates the native window and embedded editor while hidden, and only shows the window once the requested document has been installed. No startup/loading window is shown first. DWM show/hide transitions are disabled for Leafnote's own window, and its first native background erase uses the selected theme. Warm opens follow the same sequence.

Right-click a `.md` file → **Open with → Choose another app → Choose an app on your PC**, then select `Leafnote.exe` in this folder. The file opens and is edited directly.

- `register-md.cmd`: registers Leafnote as an "Open with" option for the current user and opens Windows Default Apps settings.
- `unregister-md.cmd`: removes that registration.

The first time you run `Leafnote.exe`, it asks once whether to make Leafnote the default app for `.md` files. Choosing **Yes** registers Leafnote for the current user and opens Windows Default Apps, where you pick Leafnote for `.md` (Windows requires you to confirm this step yourself). Choosing **No** never asks again; run `register-md.cmd` later to set it up. If you move the Leafnote folder after registering, the registration is repaired automatically the next time you open Leafnote.

Leafnote never changes protected Windows default-app settings on its own.

## Data and backups

Leafnote does not keep its own copies, backups, or trash, and does not store a list of recent files on disk. Back up important files yourself. New documents that were never saved are lost if you close or reload the window.

Runtime logs are written only to the Windows temp folder under `Leafnote/<hash of program path>/`.

Older versions stored pages in a `data/` folder. That folder is never deleted on upgrade, and you can open the old `.md` files in `data/pages` with **Open**. `data/index.json` maps old page names to file IDs.

## Security

- The server listens only on `127.0.0.1`.
- Write requests require an app session token, and the Host header, Origin, and JSON format are checked.
- Open and Save as use the native Windows file picker.

## Project structure

```
server.js              Local HTTP server (Node.js, no dependencies)
public/                Editor UI (index.html, app.js, markdown.js, style.css)
test/                  Tests (node:test)
LeafnoteLauncher.cs    Source for Leafnote.exe launcher
LeafnoteWindow.cs      Window placement persistence and restore
LeafnoteHost.cs        Native window with an embedded WebView2 editor
LeafnoteApp.cs         File-open broker and bounded empty editor reuse
server-runner.cjs      Direct native-launcher server startup and temp logs
build-launcher.ps1     Builds Leafnote.exe
launch.ps1, stop.ps1   Start / stop helpers
file-picker.ps1        Windows file picker bridge
register-md.cmd        "Open with" registration
```

## Development

```bash
npm test
```

The native browser integration tests are opt-in because they open app windows. In a normal Windows terminal, run `$env:LEAFNOTE_NATIVE_UI_TESTS='1'; npm test`. They check the first visible placement, embedded editor loading, cancelled closing, final placement persistence for normal/maximized/default windows, hidden startup, initial paint under the app's content security policy, empty controller reuse, and idle expiry. The default suite also checks concurrent native cold launches against an isolated server and verifies the native startup HWND stays hidden, its first erase is dark, and its DWM transitions are disabled for normal and maximized windows.

## Contributing

Issues and pull requests are welcome. If you find Leafnote useful, a ⭐ on the repository helps others find it.

## License

[MIT](LICENSE)
