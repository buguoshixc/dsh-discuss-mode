# Push the current branch through GitHub's Git Data API.
#
# WHY THIS EXISTS
#   On some networks `github.com:443` — the endpoint `git push` uses — is
#   unreachable or resets mid-transfer, while `gh`'s HTTPS calls to
#   api.github.com succeed. When that happens `git push` cannot work at all,
#   and this script pushes the same objects over the API path instead.
#
# WHY THE RESULT IS NOT A COPY
#   Git's object ids are a pure function of content, so uploading the same
#   blobs, tree, author, committer, dates and message produces the same SHA.
#   The script refuses to move the ref if the remote computes anything else, so
#   local and remote cannot silently diverge, `git status` stays accurate, and
#   a later `git push` has nothing left to do.
#
# REQUIREMENTS
#   * `gh`, authenticated with the `repo` scope.
#   * The remote repository already has at least one commit. GitHub refuses
#     blob/tree creation on a repository with no commits at all (HTTP 409
#     "Git Repository is empty"); create the first one with
#     `gh repo create --add-readme` or the Contents API.
#
# USAGE
#   powershell -ExecutionPolicy Bypass -File tools\push-via-api.ps1
#   powershell -ExecutionPolicy Bypass -File tools\push-via-api.ps1 -Branch main
#
# Written for Windows PowerShell 5.1 as well as PowerShell 7. Binary objects
# are extracted through a `cmd` redirection rather than a PowerShell pipeline,
# because the pipeline decodes native-command output as text and would corrupt
# them; every extraction is verified against git's own hash before upload.

[CmdletBinding()]
param(
  [string]$Branch = '',
  [string]$Remote = 'origin'
)

$ErrorActionPreference = 'Stop'

function Fail([string]$Message) {
  Write-Host "error: $Message" -ForegroundColor Red
  exit 1
}

# ------------------------------------------------------------- discovery ---
$root = (git rev-parse --show-toplevel 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $root) { Fail 'not inside a git repository' }
$root = $root.Trim()
Set-Location $root

if ($Branch -eq '') { $Branch = (git rev-parse --abbrev-ref HEAD).Trim() }
if ($Branch -eq 'HEAD') { Fail 'detached HEAD; pass -Branch explicitly' }
if ($Branch -notmatch '^[A-Za-z0-9._/-]+$') { Fail "refusing to use suspicious branch name '$Branch'" }

$remoteUrl = (git config "remote.$Remote.url" 2>$null | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $remoteUrl) { Fail "remote '$Remote' has no URL" }
$remoteUrl = $remoteUrl.Trim()
if ($remoteUrl -notmatch 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(\.git)?$') {
  Fail "cannot derive owner/repo from remote URL '$remoteUrl'"
}
$slug = "$($Matches.owner)/$($Matches.repo)"

Write-Host "repository : $slug"
Write-Host "branch     : $Branch"

$head = (git rev-parse $Branch).Trim()

# --------------------------------------------------------------- helpers ---
$script:blobCache = @{}
$script:bodyFile = Join-Path $root '.git\api-push-body.json'
$script:blobFile = Join-Path $root '.git\api-push-blob.bin'

function Invoke-Api {
  param([string]$Method, [string]$Path, $Body = $null)
  if ($null -ne $Body) {
    [System.IO.File]::WriteAllText($script:bodyFile, ($Body | ConvertTo-Json -Depth 10 -Compress))
    $out = gh api -X $Method $Path --input $script:bodyFile 2>&1
  } else {
    $out = gh api -X $Method $Path 2>&1
  }
  $code = $LASTEXITCODE
  Remove-Item $script:bodyFile -Force -ErrorAction SilentlyContinue
  if ($code -ne 0) { return $null }
  return ($out | Out-String | ConvertFrom-Json)
}

function Test-RemoteCommit([string]$Sha) {
  return ($null -ne (Invoke-Api -Method GET -Path "repos/$slug/git/commits/$Sha"))
}

function ConvertTo-Iso8601([string]$UnixSeconds, [string]$Zone) {
  $instant = [DateTimeOffset]::FromUnixTimeSeconds([long]$UnixSeconds)
  $sign = 1
  if ($Zone.Substring(0, 1) -eq '-') { $sign = -1 }
  $offset = [TimeSpan]::FromHours($sign * [int]$Zone.Substring(1, 2)) +
            [TimeSpan]::FromMinutes($sign * [int]$Zone.Substring(3, 2))
  return $instant.ToOffset($offset).ToString('yyyy-MM-ddTHH:mm:sszzz')
}

# Read one commit object and split it into the pieces the API wants.
function Read-LocalCommit([string]$Sha) {
  $lines = @(git cat-file commit $Sha)
  if ($LASTEXITCODE -ne 0) { Fail "cannot read commit $Sha" }

  $separator = [array]::IndexOf($lines, '')
  if ($separator -lt 0) { Fail "commit $Sha has no header/body separator" }

  $header = @($lines[0..($separator - 1)])
  $tree = (($header | Where-Object { $_ -like 'tree *' } | Select-Object -First 1) -replace '^tree ', '')
  $parents = @($header | Where-Object { $_ -like 'parent *' } | ForEach-Object { $_ -replace '^parent ', '' })

  $identity = @{}
  foreach ($kind in @('author', 'committer')) {
    $line = ($header | Where-Object { $_ -like "$kind *" } | Select-Object -First 1)
    if ($line -notmatch "^$kind (?<name>.*) <(?<email>[^>]*)> (?<ts>-?\d+) (?<tz>[+-]\d{4})$") {
      Fail "cannot parse the $kind line of commit $Sha"
    }
    $identity[$kind] = @{
      name  = $Matches.name
      email = $Matches.email
      date  = (ConvertTo-Iso8601 $Matches.ts $Matches.tz)
    }
  }

  # Everything after the separator, rejoined verbatim, so a trailing newline
  # survives and the resulting object id matches git's.
  $message = ($lines[($separator + 1)..($lines.Count - 1)] -join "`n")

  return @{
    sha       = $Sha
    tree      = $tree
    parents   = $parents
    message   = $message
    author    = $identity['author']
    committer = $identity['committer']
  }
}

function Send-Blob([string]$Sha) {
  if ($script:blobCache.ContainsKey($Sha)) { return $script:blobCache[$Sha] }

  # `cmd` redirection keeps the bytes intact; a PowerShell pipeline would not.
  & cmd /c ('git cat-file blob ' + $Sha + ' > "' + $script:blobFile + '"') | Out-Null
  $actual = (git hash-object $script:blobFile).Trim()
  if ($actual -ne $Sha) { Fail "blob $Sha extracted as $actual; refusing to upload corrupt bytes" }

  $base64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($script:blobFile))
  Remove-Item $script:blobFile -Force

  $blob = Invoke-Api -Method POST -Path "repos/$slug/git/blobs" -Body @{ content = $base64; encoding = 'base64' }
  if ($null -eq $blob) { Fail "uploading blob $Sha failed" }
  if ($blob.sha -ne $Sha) { Fail "blob $Sha uploaded as $($blob.sha)" }

  $script:blobCache[$Sha] = $blob.sha
  return $blob.sha
}

function Send-Tree([string]$TreeSha) {
  $entries = New-Object System.Collections.ArrayList
  foreach ($line in @(git ls-tree -r $TreeSha)) {
    if ($line -notmatch '^(?<mode>\d+) (?<type>\w+) (?<sha>[0-9a-f]+)\t(?<path>.+)$') { continue }
    [void]$entries.Add(@{
      path = $Matches.path
      mode = $Matches.mode
      type = $Matches.type
      sha  = (Send-Blob $Matches.sha)
    })
  }

  $tree = Invoke-Api -Method POST -Path "repos/$slug/git/trees" -Body @{ tree = @($entries) }
  if ($null -eq $tree) { Fail "creating tree $TreeSha failed" }
  if ($tree.sha -ne $TreeSha) {
    Fail "remote tree is $($tree.sha) but the local tree is $TreeSha; refusing to continue"
  }
  return $tree.sha
}

# ------------------------------------------------------------------ push ---
# Walk history oldest-first, creating every commit the remote is missing.
$chain = @(git rev-list --reverse $Branch)
$created = 0
$skipped = 0

foreach ($sha in $chain) {
  if (Test-RemoteCommit $sha) { $skipped++; continue }

  Write-Host "  creating $sha"
  $local = Read-LocalCommit $sha
  $treeSha = Send-Tree $local.tree

  foreach ($parent in $local.parents) {
    if (-not (Test-RemoteCommit $parent)) {
      Fail "parent $parent of $sha is missing on the remote; push its branch first"
    }
  }

  $body = @{
    message   = $local.message
    tree      = $treeSha
    author    = $local.author
    committer = $local.committer
  }
  if ($local.parents.Count -gt 0) { $body['parents'] = @($local.parents) }

  $commit = Invoke-Api -Method POST -Path "repos/$slug/git/commits" -Body $body
  if ($null -eq $commit) { Fail "creating commit $sha failed" }
  if ($commit.sha -ne $sha) {
    Fail "remote produced $($commit.sha) where the local commit is $sha; refusing to move the ref"
  }
  $created++
}

Write-Host "commits    : created $created, already present $skipped"

# ------------------------------------------------------------------- ref ---
$refPath = "repos/$slug/git/refs/heads/$Branch"
$existing = Invoke-Api -Method GET -Path $refPath

if ($null -eq $existing) {
  $ref = Invoke-Api -Method POST -Path "repos/$slug/git/refs" -Body @{ ref = "refs/heads/$Branch"; sha = $head }
  if ($null -eq $ref) { Fail "creating refs/heads/$Branch failed" }
} elseif ($existing.object.sha -ne $head) {
  $ref = Invoke-Api -Method PATCH -Path $refPath -Body @{ sha = $head; force = $true }
  if ($null -eq $ref) { Fail "updating refs/heads/$Branch failed" }
} else {
  $ref = $existing
}

Write-Host "remote     : $Branch -> $($ref.object.sha)"

# Keep the local remote-tracking ref truthful without needing a fetch.
git update-ref "refs/remotes/$Remote/$Branch" $head
Write-Host "done       : local and $Remote/$Branch both at $head"
