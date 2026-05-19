param(
  [string]$SourceBranch = "main",
  [string]$PublicBranch = "public",
  [string]$GiteaRemote = "origin",
  [string]$GitHubRemote = "github",
  [string]$GitHubTargetBranch = "main",
  [switch]$Push
)

$ErrorActionPreference = "Stop"

function Invoke-Git {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  & git @Args
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Args -join ' ') failed with exit code $LASTEXITCODE"
  }
}

function Assert-CleanWorktree {
  $status = git status --porcelain
  if ($status) {
    throw "Worktree is not clean. Commit or stash changes before syncing public branch.`n$status"
  }
}

function Test-LocalBranch {
  param([string]$Name)
  git show-ref --verify --quiet "refs/heads/$Name"
  return $LASTEXITCODE -eq 0
}

function Remove-PathIfExists {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Replace-InFile {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Replacement
  )
  if (-not (Test-Path $Path)) {
    return
  }
  $text = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $next = $text -replace $Pattern, $Replacement
  if ($next -ne $text) {
    Set-Content -LiteralPath $Path -Value $next -Encoding UTF8 -NoNewline
  }
}

Assert-CleanWorktree

Invoke-Git rev-parse --verify $SourceBranch

if (Test-LocalBranch $PublicBranch) {
  Invoke-Git switch $PublicBranch
} else {
  Invoke-Git switch --orphan $PublicBranch
}

$tracked = git ls-files
if ($tracked) {
  Invoke-Git rm -r --cached .
}

Invoke-Git checkout $SourceBranch -- .

Remove-PathIfExists "docs/archive"
Remove-PathIfExists "docs/releases/claude-code-workbench-mvp/demo-script.md"
Remove-PathIfExists "docs/releases/claude-code-workbench-mvp/release-checklist.md"
Invoke-Git rm -r --quiet --ignore-unmatch docs/archive
Invoke-Git rm --quiet --ignore-unmatch `
  docs/releases/claude-code-workbench-mvp/demo-script.md `
  docs/releases/claude-code-workbench-mvp/release-checklist.md

Replace-InFile "docs/production-deployment.md" `
  "https://hooks\.slack\.com/services/XXX" `
  "<SLACK_WEBHOOK_URL>"

Replace-InFile "docs/README.md" `
  "\r?\n## 历史归档\r?\n\r?\n- \[归档目录\]\(archive/README\.md\)：不再作为当前事实的 PRD、阶段设计、JD mapping 和非功能路线记录。\r?\n- \[Claude Code Workbench MVP 发布材料\]\(releases/claude-code-workbench-mvp/README\.md\)：MVP 里程碑的 release notes、demo script、checklist 和 acceptance record。\r?\n" `
  "`r`n## 发布材料`r`n`r`n- [Claude Code Workbench MVP 发布材料](releases/claude-code-workbench-mvp/README.md)：MVP 里程碑的 release notes 和 acceptance record。`r`n"

Replace-InFile "docs/README.en.md" `
  "\r?\n## Historical Archive\r?\n\r?\n- \[Archive index\]\(archive/README\.md\): PRDs, phase designs, JD mapping, and non-functional roadmap records that are no longer current implementation truth.\r?\n- \[Claude Code Workbench MVP release materials\]\(releases/claude-code-workbench-mvp/README\.md\): release notes, demo script, checklist, and acceptance record for the MVP milestone.\r?\n" `
  "`r`n## Release Materials`r`n`r`n- [Claude Code Workbench MVP release materials](releases/claude-code-workbench-mvp/README.md): release notes and acceptance record for the MVP milestone.`r`n"

Replace-InFile "docs/releases/claude-code-workbench-mvp/README.md" `
  "\r?\n- \[Demo script\]\(demo-script\.md\)\r?\n- \[Release checklist\]\(release-checklist\.md\)" `
  ""

$scanPattern = "岗位 JD|目标岗位|JD Mapping|真实服务器|E:\\agent-ui|OPENAI_API_KEY=sk-|TELEGRAM_BOT_TOKEN=bot|WEBHOOK_SECRET=abc123|hooks\.slack\.com/services/XXX"
if (Get-Command rg -ErrorAction SilentlyContinue) {
  & rg -n $scanPattern . --glob "!scripts/sync-public.ps1"
  if ($LASTEXITCODE -eq 0) {
    throw "Public safety scan found matches. Review and sanitize the output above."
  }
  if ($LASTEXITCODE -gt 1) {
    throw "Public safety scan failed with exit code $LASTEXITCODE"
  }
} else {
  Write-Warning "ripgrep is not available; skipped public safety scan."
}

Invoke-Git add -u

$pending = git status --porcelain
if ($pending) {
  Invoke-Git commit -m "sync: public snapshot from $SourceBranch"
} else {
  Write-Host "No public branch changes to commit."
}

Invoke-Git clean -fd

Invoke-Git push -u $GiteaRemote $PublicBranch

if ($Push) {
  $hasGithubRemote = git remote | Where-Object { $_ -eq $GitHubRemote }
  if (-not $hasGithubRemote) {
    throw "Remote '$GitHubRemote' is not configured. Add it with: git remote add $GitHubRemote https://github.com/<user>/<repo>.git"
  }
  Invoke-Git push -u $GitHubRemote "${PublicBranch}:${GitHubTargetBranch}"
}
