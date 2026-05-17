$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot
$BuildRoot = Join-Path $ProjectRoot ".build"
$BuildTemp = Join-Path $BuildRoot "tmp"
$SupportedPython = $null

New-Item -ItemType Directory -Force -Path $BuildTemp | Out-Null
$env:TEMP = $BuildTemp
$env:TMP = $BuildTemp

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
  }
}

$candidateCommands = @(
  @("py", "-3.12"),
  @("py", "-3.13"),
  @("python", "")
)

foreach ($candidate in $candidateCommands) {
  $command = $candidate[0]
  $arg = $candidate[1]
  try {
    $versionArgs = @()
    if ($arg) { $versionArgs += $arg }
    $versionArgs += "-c"
    $versionArgs += "import sys; raise SystemExit(0 if (3, 12) <= sys.version_info[:2] <= (3, 13) else 1)"
    & $command @versionArgs 2>$null
    if ($LASTEXITCODE -eq 0) {
      $SupportedPython = @{ Command = $command; Arg = $arg }
      break
    }
  } catch {
    continue
  }
}

if (-not $SupportedPython) {
  throw "PyInstaller no soporta el Python 3.14 de este equipo. Instala Python 3.12 o 3.13 solo para build y vuelve a ejecutar npm run build:backend."
}

$pythonArgs = @()
if ($SupportedPython.Arg) { $pythonArgs += $SupportedPython.Arg }

Invoke-Checked $SupportedPython.Command ($pythonArgs + @("-m", "pip", "install", "--upgrade", "pip"))
Invoke-Checked $SupportedPython.Command ($pythonArgs + @("-m", "pip", "install", "-r", (Join-Path $ProjectRoot "requirements.txt"), "-r", (Join-Path $ProjectRoot "requirements-build.txt")))
Invoke-Checked $SupportedPython.Command ($pythonArgs + @("-m", "PyInstaller", "--noconfirm", "--clean", (Join-Path $ProjectRoot "backend.spec")))
