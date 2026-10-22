# Starts the Creature Cauldron server for real use, and starts it again if it ever stops.
#
#   powershell -ExecutionPolicy Bypass -File deploy\run-server.ps1
#
# The API key and the production settings are read from a secrets file that lives OUTSIDE the project (default C:\cauldron\secrets.env,
# see deploy\secrets.env.example). They are put into this process's environment only: nothing is printed, nothing is written into the
# project, and nothing is passed on the command line where other programs could see it.

param(
    [string]$SecretsFile = "C:\cauldron\secrets.env",
    [string]$LogDir = "C:\cauldron\logs"
)

$project = Split-Path -Parent $PSScriptRoot  # the creature-cauldron folder
$python = Join-Path $project "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $SecretsFile)) { throw "Secrets file not found: $SecretsFile (see docs/DEPLOYMENT.md)" }
if (-not (Test-Path $python)) { throw "The Python environment is missing: $python (see backend/README.md)" }

# KEY=VALUE lines; blank lines and lines starting with # are ignored.
Get-Content $SecretsFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $name, $value = $line -split "=", 2
    [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), "Process")
}

# Production settings that are not secret. The secrets file may set any of them to something else.
$defaults = @{
    CAULDRON_ALLOWED_ORIGINS      = "https://creaturecauldron.com"
    CAULDRON_TRUSTED_PROXY_HEADER = "CF-Connecting-IP"
    CAULDRON_DAILY_CAP            = "100"
}
foreach ($name in $defaults.Keys) {
    if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
        [Environment]::SetEnvironmentVariable($name, $defaults[$name], "Process")
    }
}

New-Item -ItemType Directory -Force $LogDir | Out-Null
Set-Location (Join-Path $project "backend")

while ($true) {
    $log = Join-Path $LogDir ("server-{0:yyyy-MM-dd}.log" -f (Get-Date))
    # cmd does the redirection: the server writes its log lines to stderr, which PowerShell 5 would treat as errors.
    cmd /c "`"$python`" -m cauldron.service >> `"$log`" 2>&1"
    # Keep two weeks of logs.
    Get-ChildItem $LogDir -Filter "server-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
    Start-Sleep -Seconds 5
}
