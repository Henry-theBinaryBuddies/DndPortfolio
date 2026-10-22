# Starts the Creature Cauldron server for real use, and starts it again if it ever stops.
#
#   powershell -ExecutionPolicy Bypass -File deploy\run-server.ps1
#
# The API key and the production settings are read from a secrets file that lives OUTSIDE the project (default C:\cauldron\secrets.env,
# see deploy\secrets.env.example). They are put into this process's environment only: nothing is printed, nothing is written into the
# project, and nothing is passed on the command line where other programs could see it.
#
# The server's output goes to one log file per day in the log folder. Files older than two weeks are deleted, and a day's file stops
# growing at 50 MB, so a flood of requests cannot fill the disk.

param(
    [string]$SecretsFile = "C:\cauldron\secrets.env",
    [string]$LogDir = "C:\cauldron\logs",
    [string]$Python = "",
    [string[]]$ServerArguments = @("-m", "cauldron.service")
)

$project = Split-Path -Parent $PSScriptRoot  # the creature-cauldron folder
if (-not $Python) { $Python = Join-Path $project "backend\.venv\Scripts\python.exe" }

if (-not (Test-Path $SecretsFile)) { throw "Secrets file not found: $SecretsFile (see docs/DEPLOYMENT.md)" }
if (-not (Test-Path $Python)) { throw "The Python environment is missing: $Python (see backend/README.md)" }

# KEY=VALUE lines; blank lines and lines starting with # are ignored. One pair of matching quotes around a value is removed.
Get-Content $SecretsFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { return }
    $name, $value = $line -split "=", 2
    $value = $value.Trim()
    if ($value.Length -ge 2 -and ($value[0] -eq '"' -or $value[0] -eq "'") -and $value[$value.Length - 1] -eq $value[0]) {
        $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name.Trim().TrimStart([char]0xFEFF).Trim(), $value, "Process")  # a byte-order mark may start the file
}

# A mistyped key would only show up later as failed calls that still use up the day's allowance, so say so now (the key is never printed).
$key = [Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "Process")
if ($key -and -not $key.StartsWith("sk-ant-")) {
    Write-Warning "ANTHROPIC_API_KEY does not look like an Anthropic key (they start with sk-ant-). Check C:\cauldron\secrets.env."
} elseif (-not $key) {
    Write-Warning "ANTHROPIC_API_KEY is empty: the library works, but nothing can be generated."
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
$ErrorActionPreference = "Continue"  # the server writes its log lines to stderr; they are not errors
$maxBytes = 50MB
$script:today = ""

while ($true) {
    & $Python @ServerArguments 2>&1 | ForEach-Object {
        $day = Get-Date -Format "yyyy-MM-dd"
        $file = Join-Path $LogDir "server-$day.log"
        if ($day -ne $script:today) {
            $script:today = $day
            Get-ChildItem $LogDir -Filter "server-*.log" | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item
        }
        if (-not (Test-Path $file) -or (Get-Item $file).Length -lt $maxBytes) {
            Add-Content -Path $file -Value ([string]$_)
        }
    }
    Start-Sleep -Seconds 5
}
