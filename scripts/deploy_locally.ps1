$ErrorActionPreference = "Stop"

$frontend = $null
$backend = $null

$frontendArgs = @(
    "/c npx --yes browser-sync start"
    "--server frontend/static"
    "--files frontend/static/*.html frontend/static/*.css frontend/static/themes/*.css frontend/static/*.js"
    "--port 5173"
    "--no-ui"
    "--host 127.0.0.1"
) -join " "

$backends = @(
    @{ Exe = "uvicorn"; Args = "backend.main:app --port 8000 --reload" }
    @{ Exe = "uv"; Args = "run uvicorn backend.main:app --port 8000 --reload" }
)

try {
    for ($i = 0; $i -lt $backends.Count; $i++) {
        $command = $backends[$i]
        $isFallback = $i -gt 0

        try {
            $backend = Start-Process $command["Exe"] -ArgumentList $command["Args"] -PassThru -NoNewWindow
            Start-Sleep -Seconds 1
        } catch {
            if ($isFallback) { throw }
            Write-Warning "uvicorn failed to start, retrying via 'uv run'..."
            continue
        }

        if (-not $backend.HasExited) { break }

        if ($isFallback) { break }
        Write-Warning "uvicorn exited with code $($backend.ExitCode), retrying via 'uv run'..."
        $backend = $null
    }

    if (-not $backend -or $backend.HasExited) {
        throw "Backend failed to start with code $($backend.ExitCode)."
    }

    # & "$PSScriptRoot\smoke-test.ps1"

    $frontend = Start-Process cmd.exe -ArgumentList $frontendArgs -PassThru -NoNewWindow

    while (-not ($backend.HasExited -or $frontend.HasExited)) {
        Start-Sleep -Milliseconds 500
    }

    if ($backend.HasExited -and $backend.ExitCode -ne 0) {
        Write-Warning "Backend exited with code $($backend.ExitCode)."
    }
} finally {
    foreach ($process in @($frontend, $backend)) {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}
