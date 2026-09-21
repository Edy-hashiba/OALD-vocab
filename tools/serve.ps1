# Static file server for local checking, e.g.
#   powershell -ExecutionPolicy Bypass -File tools\serve.ps1 -Root docs
#
# Cache-Control: no-store on everything. Without it the browser caches the very
# files being edited and the page keeps running the previous version - which has
# already wasted an afternoon once.

param(
    [string]$Root = 'docs',
    [int]$Port = 8080
)

$ErrorActionPreference = 'Stop'
if (-not [System.IO.Path]::IsPathRooted($Root)) {
    $Root = Join-Path (Split-Path -Parent $PSScriptRoot) $Root
}
if (-not (Test-Path $Root)) { throw "no such folder: $Root" }

$types = @{
    '.html'        = 'text/html; charset=utf-8'
    '.css'         = 'text/css; charset=utf-8'
    '.js'          = 'text/javascript; charset=utf-8'
    '.json'        = 'application/json; charset=utf-8'
    '.webmanifest' = 'application/manifest+json; charset=utf-8'
    '.png'         = 'image/png'
    '.svg'         = 'image/svg+xml'
    '.mp3'         = 'audio/mpeg'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "serving $Root on http://localhost:$Port/  (Ctrl+C to stop)"

while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }

    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') {
        $rel = if (Test-Path (Join-Path $Root 'index.html')) { 'index.html' } else { 'review.html' }
    }
    $path = Join-Path $Root $rel

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($path).ToLower()
        $ct = $types[$ext]
        if (-not $ct) { $ct = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.ContentType = $ct
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
        $msg = [System.Text.Encoding]::UTF8.GetBytes('not found: ' + $rel)
        $ctx.Response.OutputStream.Write($msg, 0, $msg.Length)
    }
    $ctx.Response.Close()
}
