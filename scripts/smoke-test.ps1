param(
    [string]$BaseUrl = $env:BASE_URL
)

if (-not $BaseUrl) { $BaseUrl = "http://127.0.0.1:8000" }
$BaseUrl = $BaseUrl.TrimEnd("/")

$urls = @(
    "$BaseUrl/healthz"
    "$BaseUrl/tiles/WebMercatorQuad/0/0/0?raster=test_raster.tif"
    "$BaseUrl/tiles/WebMercatorQuad/0/0/0?raster=germany_raster_v3.tif"
)

foreach ($url in $urls) {
    try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -ErrorAction Stop
        $status = $response.StatusCode
    } catch {
        $status = $_.Exception.Response.StatusCode.value__
        if (-not $status) { $status = 0 }
    }

    if ($status -ne 200) {
        Write-Error "FAIL $url returned HTTP $status"
        exit 1
    }

    Write-Host "OK $url returned HTTP 200"
}

Write-Host "smoke test passed"
