param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('codex', 'claude', 'grok')]
    [string]$Agent,
    [Parameter(Mandatory = $true)]
    [string]$ProjectDirectory
)

$ErrorActionPreference = 'Stop'
if (-not [IO.Path]::IsPathRooted($ProjectDirectory)) { throw 'ProjectDirectory must be absolute.' }
$projectRoot = (Resolve-Path -LiteralPath $ProjectDirectory).Path
if (-not (Test-Path -LiteralPath $projectRoot -PathType Container)) { throw 'ProjectDirectory must be a directory.' }
$sourceRoot = Join-Path (Split-Path -Parent $PSScriptRoot) 'skills/relay-session'
$agentFolder = switch ($Agent) { 'codex' { '.agents' } 'claude' { '.claude' } 'grok' { '.grok' } }
$targetRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "$agentFolder/skills/relay-session"))
if (-not $targetRoot.StartsWith($projectRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Target must remain inside the selected project.'
}
function Test-Link([string]$ItemPath) {
    # Test-Path follows a link, so a dangling junction is recognised through its own attributes instead.
    try { return [bool]((Get-Item -LiteralPath $ItemPath -Force -ErrorAction Stop).Attributes -band [IO.FileAttributes]::ReparsePoint) }
    catch { return $false }
}
# Refuse junction/symlink ancestors so a project-scoped installation cannot escape the project.
$cursor = Split-Path -Parent $targetRoot
while ($cursor.Length -gt $projectRoot.Length) {
    if (Test-Link $cursor) { throw "Linked target not supported: $cursor" }
    $cursor = Split-Path -Parent $cursor
}
# A skill folder that is itself a link breaks once its target moves, so the link gives way to a real copy.
# Only the link entry is removed; whatever it pointed to is never touched.
$links = New-Object System.Collections.Generic.List[string]
if (Test-Link $targetRoot) { $links.Add($targetRoot) }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$skillText = [IO.File]::ReadAllText((Join-Path $sourceRoot 'SKILL.md'), $utf8)
# Claude Code and Grok read argument-hint from the frontmatter. Model invocation stays enabled so
# the agent can follow the project instruction to record a session without waiting for /relay-session.
if ($Agent -ne 'codex') {
    $skillText = $skillText -replace '^---\r?\n', "---`nargument-hint: codex|claude|grok`n"
}
$files = @{ 'SKILL.md' = $skillText }
if ($Agent -eq 'codex') { $files['agents/openai.yaml'] = [IO.File]::ReadAllText((Join-Path $sourceRoot 'agents/openai.yaml'), $utf8) }
# Preflight every target before writing anything; do not overwrite a user-edited skill.
foreach ($relative in $files.Keys) {
    if ($links.Contains($targetRoot)) { break }
    $target = Join-Path $targetRoot $relative
    $ancestor = Split-Path -Parent $target
    while ($ancestor.Length -gt $targetRoot.Length) {
        if (Test-Link $ancestor) { throw "Linked target not supported: $ancestor" }
        $ancestor = Split-Path -Parent $ancestor
    }
    if (Test-Link $target) { $links.Add($target); continue }
    if (Test-Path -LiteralPath $target) {
        if ([IO.File]::ReadAllText($target, $utf8) -cne $files[$relative]) { throw "Existing skill differs; review manually before replacing: $target" }
    }
}
foreach ($link in $links) {
    if ((Get-Item -LiteralPath $link -Force).PSIsContainer) { [IO.Directory]::Delete($link) } else { [IO.File]::Delete($link) }
    Write-Output "Replaced link with a real copy: $link"
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
