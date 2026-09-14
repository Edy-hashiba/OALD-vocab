# Rebuilds _local/ from extension/src and serves it, so review.html can be
# opened in a normal browser tab (chrome.storage is faked by _local/shim.js).
param([int]$Port = 8777)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'extension\src'
$out = Join-Path $root '_local'

foreach ($f in 'review.html', 'review.css', 'review.js', 'db.js') {
    Copy-Item (Join-Path $src $f) (Join-Path $out $f) -Force
}
$page = Join-Path $out 'review.html'
$html = Get-Content $page -Raw -Encoding UTF8
$html = $html -replace '<script src="db.js"></script>', '<script src="shim.js"></script><script src="db.js"></script>'
Set-Content $page $html -Encoding UTF8 -NoNewline

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Output "http://localhost:$Port/review.html  (Ctrl+C to stop)"
$types = @{ '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8' }
while ($listener.IsListening) {
    try { $ctx = $listener.GetContext() } catch { break }
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '') { $rel = 'review.html' }
    $path = Join-Path $out $rel
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $ext = [System.IO.Path]::GetExtension($path).ToLower()
        $ct = $types[$ext]; if (-not $ct) { $ct = 'application/octet-stream' }
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $ctx.Response.Headers.Add('Cache-Control', 'no-store')
        $ctx.Response.ContentType = $ct
        $ctx.Response.ContentLength64 = $bytes.Length
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $ctx.Response.StatusCode = 404 }
    $ctx.Response.Close()
}
