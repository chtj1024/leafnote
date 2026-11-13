# Leafnote

**A lightweight, offline, block-based Markdown editor for Windows.**
Edit the `.md` files already on your PC in a Notion-style block editor. No account, no cloud, no internet connection required.

- Edits your original files directly (no hidden database, no copies)
- Block editing with `/` slash commands, drag-and-drop reordering, tables, checklists, and highlights
- Autosave, light/dark theme, and raw Markdown view
- Zero npm dependencies: just Node.js 18+ and plain HTML/CSS/JS

## Quick start

**Requirements:** Windows 10/11, [Node.js](https://nodejs.org/) 18 or later.

```bash
git clone https://github.com/chtj1024/leafnote.git
cd leafnote
powershell -ExecutionPolicy Bypass -File build-launcher.ps1
```

`build-launcher.ps1` compiles `LeafnoteLauncher.cs` into `Leafnote.exe` with the .NET Framework compiler (`csc.exe`) that ships with Windows. Then run `Leafnote.exe` (or `start.cmd`). The launcher automatically finds an installed Node.js runtime.

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

- Documents linked to a file autosave about 0.65 seconds after your last edit.
- If you have unsaved changes, you can choose Save, Don't save, or Cancel.
- The full path of the open file is shown under its name. Rename files in Explorer or use Save as.
- Existing files are updated in place rather than replaced, so desktop icon positions and file attributes are kept.
- The light/dark toggle is in the top right. Only the theme choice is stored in the browser.

**Conflict protection:** if the file is changed by another window or program, Leafnote will not overwrite it. Use **Save as** to keep your version, then reopen the original. If the original is deleted or moved, Leafnote will not silently recreate it.

**Encodings:** UTF-8, UTF-8 with BOM, UTF-16 LE, and UTF-16 BE. The original encoding, BOM, and line endings are kept. Files up to 4 MB are supported.

## Editing

- Type `/` in an empty block to insert text, headings, lists, checklists, quotes, code, dividers, or tables.
- Drag the handle on the left of a block to reorder it, or click it to change the block type.
- Bold `Ctrl+B`, italic `Ctrl+I`, underline `Ctrl+U`, and strikethrough.
- Select text to show 7 soft highlight colors and a clear-highlight tool. The **A** button in the toolbar does the same.
- Tables size to their content. Click a cell to add or remove rows and columns, delete the table, or continue writing below it. Supports Tab/Enter navigation and pasting TSV data.
- `Ctrl+Z` / `Ctrl+Shift+Z`: undo / redo block edits.
- **Markdown view** lets you edit the raw source. Underline and highlight colors are saved as a small set of HTML tags. Use Markdown view when you need to keep syntax the block editor does not support.

## Open `.md` files with Leafnote (Windows)

Right-click a `.md` file → **Open with → Choose another app → Choose an app on your PC**, then select `Leafnote.exe` in this folder. The file opens and is edited directly.

- `register-md.cmd`: registers Leafnote as an "Open with" option for the current user and opens Windows Default Apps settings.
- `unregister-md.cmd`: removes that registration.

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
build-launcher.ps1     Builds Leafnote.exe
launch.ps1, stop.ps1   Start / stop helpers
file-picker.ps1        Windows file picker bridge
register-md.cmd        "Open with" registration
```

## Development

```bash
npm test
```

## Contributing

Issues and pull requests are welcome. If you find Leafnote useful, a ⭐ on the repository helps others find it.

## License

[MIT](LICENSE)
