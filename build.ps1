$ErrorActionPreference = 'Stop'
$gitPath = (Get-Command git -ErrorAction Stop).Source
$bashPath = Join-Path (Split-Path (Split-Path $gitPath -Parent) -Parent) 'bin\bash.exe'
if (-not (Test-Path -LiteralPath $bashPath)) { throw 'Git Bash was not found. Run bash build.sh from Git Bash or WSL.' }
Push-Location $PSScriptRoot
try {
    & $bashPath './build.sh'
    if ($LASTEXITCODE -ne 0) { throw "Deployment failed (exit $LASTEXITCODE)" }
} finally { Pop-Location }
