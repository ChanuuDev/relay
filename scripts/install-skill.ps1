param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('codex', 'claude')]
    [string]$Agent,
    [Parameter(Mandatory = $true)]
    [string]$ProjectDirectory
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($ProjectDirectory)) { throw 'ProjectDirectory must be absolute.' }
$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw 'ProjectDirectory must be a directory.' }
$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'skills/relay-session'
$agentFolder = if ($Agent -eq 'codex') { '.agents' } else { '.claude' }
$targetRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "$agentFolder/skills/relay-session"))
if (-not $targetRoot.StartsWith($projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Target must remain inside the selected project.'
}
# Refuse junction/symlink ancestors so a project-scoped installation cannot escape the project.
$cursor = $targetRoot
while ($cursor.Length -gt $projectRoot.Length) {
    if (Test-Path -LiteralPath $cursor) {
        if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked target not supported: $cursor" }
    }
    $cursor = Split-Path -Parent $cursor
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
$skillText = [IO.File]::ReadAllText((Join-Path $sourceRoot 'SKILL.md'), $utf8)
if ($Agent -eq 'claude') {
    $skillText = $skillText -replace '^---\r?\n', "---`ndisable-model-invocation: true`nargument-hint: codex|claude|grok`n"
}
$files = @{ 'SKILL.md' = $skillText }
if ($Agent -eq 'codex') { $files['agents/openai.yaml'] = [IO.File]::ReadAllText((Join-Path $sourceRoot 'agents/openai.yaml'), $utf8) }
# Preflight every target before writing anything; do not overwrite a user-edited skill.
foreach ($relative in $files.Keys) {
    $target = Join-Path $targetRoot $relative
    $ancestor = Split-Path -Parent $target
    while ($ancestor.Length -gt $projectRoot.Length) {
        if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Linked target not supported: $ancestor"
        }
        $ancestor = Split-Path -Parent $ancestor
    }
    if (Test-Path -LiteralPath $target) {
        $item = Get-Item -LiteralPath $target -Force
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked target not supported: $target" }
        if ([IO.File]::ReadAllText($target, $utf8) -cne $files[$relative]) { throw "Existing skill differs; review manually before replacing: $target" }
    }
}
foreach ($relative in $files.Keys) {
    $target = Join-Path $targetRoot $relative
    if (-not (Test-Path -LiteralPath $target)) {
        [IO.Directory]::CreateDirectory((Split-Path -Parent $target)) | Out-Null
        [IO.File]::WriteAllText($target, $files[$relative], $utf8)
    }
}
Write-Output "Skill installed: $targetRoot"
Write-Output 'No user-global settings or PATH were changed. Reopen the agent if the skill is not listed.'
