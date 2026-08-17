$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$templates = Get-ChildItem -LiteralPath $projectRoot -Recurse -Force -Filter '.env.example'

foreach ($template in $templates) {
    $target = Join-Path $template.DirectoryName '.env'
    if (Test-Path -LiteralPath $target) {
        Write-Host "Keeping existing $target"
        continue
    }

    Copy-Item -LiteralPath $template.FullName -Destination $target
    Write-Host "Created $target"
}

Write-Host 'Fill in secrets in the root .env before starting Docker Compose.'
