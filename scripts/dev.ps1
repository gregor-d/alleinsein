$ErrorActionPreference = "Stop"

$backend = Start-Process uv `
  -ArgumentList "run uvicorn backend.main:app --port 8000 --reload" `
  -PassThru -NoNewWindow

do {
    if ($backend.HasExited) { Write-Error "backend exited"; exit 1 }
    Start-Sleep -Seconds 1
    try { $r = Invoke-WebRequest -Uri http://127.0.0.1:8000/healthz -UseBasicParsing -ErrorAction Stop } catch { $r = $null }
} until ($r -and $r.StatusCode -eq 200)

& "$PSScriptRoot\smoke-test.ps1"

$frontend = Start-Process cmd `
  -ArgumentList "/c npx --yes browser-sync start --server frontend/static --files `"frontend/static/*.html`" `"frontend/static/*.css`" `"frontend/static/themes/*.css`" `"frontend/static/*.js`" --port 5173 --no-ui --no-open --host 127.0.0.1" `
  -PassThru -NoNewWindow

try {
    while (-not ($backend.HasExited -or $frontend.HasExited)) { Start-Sleep -Milliseconds 500 }
} finally {
    $backend, $frontend | Where-Object { $_ -and -not $_.HasExited } | ForEach-Object {
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
}
