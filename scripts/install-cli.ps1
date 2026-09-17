param(
    [string]$InstallDirectory = (Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local\bin'),
    [string]$ExecutablePath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist\relay.exe'),
    [switch]$NoPath,
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

$copyNeeded = $true
if (Test-Path -LiteralPath $target) {
    if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { throw "Target is not a file: $target" }
    $copyNeeded = (Get-ExecutableHash $source) -ne (Get-ExecutableHash $target)
    if ($copyNeeded -and -not $Force) { throw "Existing executable differs. Use -Force to replace it: $target" }
}
if ($copyNeeded) {
    [IO.Directory]::CreateDirectory($installRoot) | Out-Null
    Copy-Item -LiteralPath $source -Destination $target -Force:$Force
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
try {
    $hook = & $target install-hooks
    if ($LASTEXITCODE -eq 0) { Write-Output $hook }
    else { Write-Output 'Hook registration skipped. Run: relay install-hooks' }
} catch {
    Write-Output 'Hook registration skipped. Run: relay install-hooks'
}
if ($NoPath) { Write-Output 'PATH was not changed.' }
else { Write-Output 'Ready: relay --codex. Reopen other terminals if the command is not found.' }
