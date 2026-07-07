# Package Twine Peeks for Firefox (.xpi = zip with manifest.json at root)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $root "extension\manifest.json"))) {
    $root = Split-Path -Parent $PSScriptRoot
}

$extensionDir = Join-Path $root "extension"
$manifestPath = Join-Path $extensionDir "manifest.json"
$version = (Get-Content $manifestPath -Raw | ConvertFrom-Json).version
$distDir = Join-Path $root "dist"
$xpiPath = Join-Path $distDir "twine-peeks-$version-firefox.xpi"
$zipPath = Join-Path $distDir "twine-peeks-$version-firefox.zip"

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
foreach ($path in @($xpiPath, $zipPath)) {
    if (Test-Path $path) { Remove-Item $path -Force }
}

Compress-Archive -Path (Join-Path $extensionDir "*") -DestinationPath $zipPath -Force
Move-Item -Path $zipPath -Destination $xpiPath -Force

Write-Host "Created $xpiPath"
