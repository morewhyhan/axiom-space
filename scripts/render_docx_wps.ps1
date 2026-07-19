param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputDir,

    [int]$Dpi = 144
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputDir)
New-Item -ItemType Directory -Path $resolvedOutput -Force | Out-Null

$stem = [System.IO.Path]::GetFileNameWithoutExtension($resolvedInput)
$pdfPath = Join-Path $resolvedOutput ($stem + '.pdf')
$app = $null
$doc = $null

try {
    $app = New-Object -ComObject 'kwps.Application'
    $app.Visible = $false
    $app.DisplayAlerts = 0
    $doc = $app.Documents.Open($resolvedInput, $false, $true)
    try { $doc.Fields.Update() | Out-Null } catch { }
    try { $doc.Repaginate() | Out-Null } catch { }
    # 17 is wdExportFormatPDF in the Word-compatible WPS COM API.
    $doc.ExportAsFixedFormat($pdfPath, 17)
}
finally {
    if ($null -ne $doc) {
        try { $doc.Close($false) } catch { }
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($doc) | Out-Null
    }
    if ($null -ne $app) {
        try { $app.Quit() } catch { }
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($app) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

if (-not (Test-Path -LiteralPath $pdfPath)) {
    throw "WPS PDF export did not create: $pdfPath"
}

$pdftoppm = 'C:\Users\why\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe'
& $pdftoppm -png -r $Dpi $pdfPath (Join-Path $resolvedOutput 'page')
if ($LASTEXITCODE -ne 0) {
    throw "pdftoppm failed with exit code $LASTEXITCODE"
}

$pages = Get-ChildItem -LiteralPath $resolvedOutput -Filter 'page-*.png' | Sort-Object Name
if ($pages.Count -eq 0) {
    throw "No rendered page PNGs were produced."
}

[pscustomobject]@{
    input = $resolvedInput
    pdf = $pdfPath
    pages = $pages.Count
    dpi = $Dpi
} | ConvertTo-Json -Compress
