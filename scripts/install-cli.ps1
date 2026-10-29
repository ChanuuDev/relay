param(
    [string]$InstallDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local\bin'),
    [string]$ExecutablePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\relay.exe'),
    [switch]$NoPath,
    [switch]$NoProtocol,
    [string]$ProtocolKey = 'HKCU:\Software\Classes\relay',
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($InstallDirectory)) { throw 'InstallDirectory must be absolute.' }
if ($InstallDirectory.IndexOfAny([char[]]';"') -ge 0) { throw 'InstallDirectory cannot contain PATH separators or quotes.' }
$installRoot = [IO.Path]::GetFullPath($InstallDirectory)
$source = (Resolve-Path -LiteralPath $ExecutablePath).Path
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Build dist/relay.exe before installing.' }
$target = Join-Path $installRoot 'relay.exe'

function Get-ExecutableHash([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToBase64String($algorithm.ComputeHash($stream)) }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

# Never replace a linked executable or write through a linked installation directory.
$cursor = $target
while ($cursor) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw "Linked installation target not supported: $cursor"
    }
    $cursor = Split-Path -Parent $cursor
}

# A running relay.exe cannot be overwritten, but it can be renamed. Replaced copies keep this suffix until their process exits.
function Remove-StaleCopies([string]$Directory) {
    Get-ChildItem -LiteralPath $Directory -Filter 'relay.exe.*.old' -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
}
# Web servers started from the installed executable; they are restarted from the new one with `relay web --reload`.
function Get-WebServers([string]$Executable) {
    @(Get-CimInstance Win32_Process -Filter "Name='relay.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $Executable) -and ($_.CommandLine -match '(^|\s)web(\s|$)') })
}
function Format-Argument([string]$Value) {
    if ($Value -match '[\s"]') { return '"' + $Value.Replace('"', '\"') + '"' }
    return $Value
}

$copyNeeded = $true
$servers = @()
if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Target is not a file: $target" }
    $copyNeeded = (Get-ExecutableHash $source) -ne (Get-ExecutableHash $target)
    if ($copyNeeded -and -not $Force) { throw "Existing executable differs. Use -Force to replace it: $target" }
}
if ($copyNeeded) {
    [IO.Directory]::CreateDirectory($installRoot) | Out-Null
    Remove-StaleCopies $installRoot
    try { Copy-Item -LiteralPath $source -Destination $target -Force:$Force -ErrorAction Stop }
    catch {
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw }
        # The executable is in use (usually by `relay web`): move it aside, then put the new one in place.
        # A function returns a one-item array unrolled, so wrap it again.
        $servers = @(Get-WebServers $target)
        $aside = '{0}.{1}.old' -f $target, (Get-Date -Format 'yyyyMMddHHmmssfff')
        Move-Item -LiteralPath $target -Destination $aside
        try { Copy-Item -LiteralPath $source -Destination $target -ErrorAction Stop }
        catch { Move-Item -LiteralPath $aside -Destination $target; throw }
        Write-Output "Replaced the running executable; the old copy is removed once it exits: $aside"
    }
}

function Test-PathEntry([string]$PathValue, [string]$Directory) {
    $expected = $Directory.Replace('/', '\').TrimEnd('\')
    foreach ($entry in ($PathValue -split ';')) {
        $expanded = [Environment]::ExpandEnvironmentVariables($entry.Trim().Trim('"')).Replace('/', '\').TrimEnd('\')
        if ($expanded -ieq $expected) { return $true }
    }
    return $false
}

if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Test-PathEntry $userPath $installRoot)) {
        $updatedPath = if ([string]::IsNullOrEmpty($userPath)) { $installRoot } else { $userPath.TrimEnd(';') + ';' + $installRoot }
        [Environment]::SetEnvironmentVariable('Path', $updatedPath, 'User')
    }
    if (-not (Test-PathEntry $env:Path $installRoot)) { $env:Path = $env:Path.TrimEnd(';') + ';' + $installRoot }
}
Write-Output "Installed: $target"
# The installed app (PWA) opens relay://web?port=N when it cannot reach the server; Windows hands the link to relay.exe, which starts a background server.
# wscript runs it without a console window; FriendlyAppName makes the browser ask to open "Relay" instead of naming the script host.
function Register-Protocol([string]$Key, [string]$Executable, [string]$Directory) {
    $launcher = Join-Path $Directory 'relay-url.vbs'
    $script = @(
        "' Relay: hands a relay:// link from the browser to relay.exe without opening a console window.",
        'If WScript.Arguments.Count < 1 Then WScript.Quit 0',
        'Dim link: link = WScript.Arguments(0)',
        'If LCase(Left(link, 8)) <> "relay://" Or InStr(link, """") > 0 Then WScript.Quit 0',
        ('CreateObject("WScript.Shell").Run """{0}"" open-url """ & link & """", 0, False' -f $Executable)
    )
    [IO.File]::WriteAllLines($launcher, $script)
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    $command = if (Test-Path -LiteralPath $wscript) { '"{0}" //B //Nologo "{1}" "%1"' -f $wscript, $launcher } else { '"{0}" open-url "%1"' -f $Executable }
    foreach ($sub in @('', 'DefaultIcon', 'shell\open\command', 'Application')) {
        $path = if ($sub) { Join-Path $Key $sub } else { $Key }
        if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
    }
    Set-ItemProperty -LiteralPath $Key -Name '(default)' -Value 'URL:Relay'
    Set-ItemProperty -LiteralPath $Key -Name 'URL Protocol' -Value ''
    Set-ItemProperty -LiteralPath (Join-Path $Key 'DefaultIcon') -Name '(default)' -Value ('"{0}",0' -f $Executable)
    Set-ItemProperty -LiteralPath (Join-Path $Key 'shell\open') -Name 'FriendlyAppName' -Value 'Relay'
    Set-ItemProperty -LiteralPath (Join-Path $Key 'shell\open\command') -Name '(default)' -Value $command
    Set-ItemProperty -LiteralPath (Join-Path $Key 'Application') -Name 'ApplicationName' -Value 'Relay'
    return $command
}
if (-not $NoProtocol) {
    try { Write-Output "Protocol registered: relay:// -> $(Register-Protocol $ProtocolKey $target $installRoot)" }
    catch { Write-Output "Protocol registration skipped: $($_.Exception.Message)" }
}
try {
    $hook = & $target install-hooks
    if ($LASTEXITCODE -eq 0) { Write-Output $hook }
    else { Write-Output 'Hook registration skipped. Run: relay install-hooks' }
} catch {
    Write-Output 'Hook registration skipped. Run: relay install-hooks'
}
# The skill goes to each agent's user skill folder as a real copy; -Force also refreshes a copy whose content changed.
try {
    $skillArguments = @('install-skills')
    if ($Force) { $skillArguments += '--force' }
    $skill = & $target @skillArguments
    if ($LASTEXITCODE -eq 0) { Write-Output $skill }
    else { Write-Output 'Skill installation skipped. Run: relay install-skills' }
} catch {
    Write-Output 'Skill installation skipped. Run: relay install-skills'
}
# Restart the web servers that ran the old executable, keeping their port and store.
# Start-Process uses ShellExecute, which passes no handles, so the restarted server never holds this script's output pipe open.
foreach ($server in $servers) {
    $arguments = @('web', '--reload')
    if ($server.CommandLine -match '--port[= ]+(\d+)') { $arguments += @('--port', $Matches[1]) }
    if ($server.CommandLine -match '--data-dir[= ]+(?:"([^"]+)"|(\S+))') { $arguments += @('--data-dir', $(if ($Matches[1]) { $Matches[1] } else { $Matches[2] })) }
    $line = ($arguments | ForEach-Object { Format-Argument $_ }) -join ' '
    try {
        $process = Start-Process -FilePath $target -ArgumentList $line -WindowStyle Hidden -PassThru
        $null = $process.Handle
        $process.WaitForExit()
        if ($process.ExitCode -eq 0) { Write-Output "Web server restarted: relay $line" }
        else { Write-Output "Web server restart failed. Run: relay $line" }
    } catch {
        Write-Output "Web server restart failed. Run: relay $line"
    }
}
if ($servers.Count -gt 0) {
    # The old process exits shortly after the reload stops it; a copy still in use is removed by the next install.
    for ($attempt = 0; $attempt -lt 25 -and (Get-ChildItem -LiteralPath $installRoot -Filter 'relay.exe.*.old' -File -ErrorAction SilentlyContinue); $attempt++) {
        Start-Sleep -Milliseconds 200
        Remove-StaleCopies $installRoot
    }
}
if ($NoPath) { Write-Output 'PATH was not changed.' }
else { Write-Output 'Ready: relay --codex. Reopen other terminals if the command is not found.' }
