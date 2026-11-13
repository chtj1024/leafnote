param([Parameter(Mandatory=$true)][string]$RequestBase64)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$leafOptions = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($RequestBase64)) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.Application]::EnableVisualStyles()
$leafOwner = New-Object Windows.Forms.Form
$leafOwner.ShowInTaskbar = $false
$leafOwner.TopMost = $true
$leafOwner.Opacity = 0
$leafOwner.StartPosition = 'CenterScreen'
$leafOwner.Size = New-Object Drawing.Size(1,1)
$leafDialog = $null
try {
    if ($leafOptions.kind -eq 'save') {
        $leafDialog = New-Object Windows.Forms.SaveFileDialog
        $leafDialog.Title = 'Leafnote - 다른 이름으로 저장'
        $leafDialog.FileName = $leafOptions.name
        $leafDialog.OverwritePrompt = $true
        $leafDialog.DefaultExt = 'md'
        $leafDialog.AddExtension = $true
    } else {
        $leafDialog = New-Object Windows.Forms.OpenFileDialog
        $leafDialog.Title = 'Leafnote - 열기'
        $leafDialog.CheckFileExists = $true
        $leafDialog.Multiselect = $false
    }
    $leafDialog.Filter = 'Markdown (*.md;*.markdown)|*.md;*.markdown'
    $leafDialog.RestoreDirectory = $true
    if ($leafOptions.directory) { $leafDialog.InitialDirectory = $leafOptions.directory }
    else { $leafDialog.InitialDirectory = [Environment]::GetFolderPath('DesktopDirectory') }
    $leafOwner.Show()
    $leafOwner.Activate()
    if ($leafDialog.ShowDialog($leafOwner) -eq [Windows.Forms.DialogResult]::OK) {
        ConvertTo-Json -InputObject $leafDialog.FileName -Compress
    } else { 'null' }
} finally {
    if ($leafDialog) { $leafDialog.Dispose() }
    $leafOwner.Dispose()
}
