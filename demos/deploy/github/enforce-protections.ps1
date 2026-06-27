<#
.SYNOPSIS
  Idempotently configure the GitHub-native enforcement primitives for the live demo repo (R11).

.DESCRIPTION
  The GitHub-side counterpart to demos/deploy/azure/provision.ps1. Configures the 🟩 NATIVE gates
  the harness claims:
    * `staging` + `production` Environments (production = required reviewer = the human release gate).
    * A repository ruleset on the default branch that requires:
        - a pull request with **1 approving review** + **CODEOWNERS review** (the human PR gate), and
        - the PR-safe **required status checks** (tests / evals / path-scope / security) — NEVER the
          deploy jobs (production deploy is a post-merge Environment gate, not a pre-merge check).
    * (opt-in) a **merge queue** rule, with an honest graceful-degrade if the account/repo can't do it.

  ENFORCEMENT-BOOTSTRAP ORDER IS LOAD-BEARING (gap-review #4 — a required ruleset can self-lock the
  repo). The safe, documented order this script assumes:
     (a) push all harness + workflows to the repo,
     (b) trigger the workflows once (open a throwaway PR) so the check-run NAMES register,
     (c) THEN run THIS script — it VERIFIES each required check name already appears in recent
         check-runs and REFUSES to require a name that has never run (unless -Force), so you can't
         brick every future PR with a typo'd or not-yet-existing context,
     (d) verify a deliberately-failing PR is blocked.

  Secretless: uses your local `gh` auth only. Idempotent: re-running converges (PUT environments,
  upsert the named ruleset). `-Remove` tears the GitHub-side enforcement back down (for teardown).

.EXAMPLE
  pwsh ./enforce-protections.ps1 -Repo ozgurkarahan/agentic-sdlc-demo-live -Reviewer ozgurkarahan
.EXAMPLE
  pwsh ./enforce-protections.ps1 -Repo ... -Reviewer ... -DryRun          # show, don't mutate
.EXAMPLE
  pwsh ./enforce-protections.ps1 -Repo ... -Reviewer ... -WithMergeQueue  # also add merge-queue rule
.EXAMPLE
  pwsh ./enforce-protections.ps1 -Repo ... -Remove                        # tear GitHub enforcement down
#>
[CmdletBinding()]
param(
  [string]   $Repo      = 'ozgurkarahan/agentic-sdlc-demo-live',
  [string]   $Reviewer  = 'ozgurkarahan',
  [string]   $Branch    = 'master',
  [string]   $RulesetName = 'agentic-harness-protections',
  [string[]] $RequiredChecks = @(
    'Tests (unit)',
    'Tests (e2e)',
    'Evals (trajectory + rubric)',
    'Path-scope (fleet lane check)',
    'Dependency review (supply-chain)',
    'CodeQL (code scanning)',
    'Hallucinated-dependency / slopsquatting check'
  ),
  [switch]   $WithMergeQueue,
  [switch]   $Force,
  [switch]   $DryRun,
  [switch]   $Remove
)

$ErrorActionPreference = 'Stop'

function Info($m) { Write-Host "  $m" }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor Cyan }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }

function Invoke-GhApi {
  param([string]$Method, [string]$Path, [string]$JsonBody)
  if ($DryRun) { Info "[dry-run] gh api -X $Method $Path"; if ($JsonBody) { Info "[dry-run] body: $JsonBody" }; return $null }
  if ($JsonBody) {
    $tmp = [System.IO.Path]::GetTempFileName()
    try { $JsonBody | Set-Content -Path $tmp -Encoding utf8; return (gh api -X $Method $Path --input $tmp) }
    finally { Remove-Item $tmp -ErrorAction SilentlyContinue }
  } else {
    return (gh api -X $Method $Path)
  }
}

# -- preflight ------------------------------------------------------------------
Step "Preflight"
gh auth status 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { throw "gh is not authenticated. Run: gh auth login" }
gh repo view $Repo 1>$null 2>$null
if ($LASTEXITCODE -ne 0) { throw "Repo '$Repo' not reachable. Create it + push the harness first (S1)." }
Info "gh authenticated; repo $Repo reachable."

# -- teardown path --------------------------------------------------------------
if ($Remove) {
  Step "Removing GitHub-side enforcement (teardown)"
  $rid = (gh api "repos/$Repo/rulesets" --jq ".[] | select(.name==`"$RulesetName`") | .id" 2>$null | Select-Object -First 1)
  if ($rid) { Invoke-GhApi -Method DELETE -Path "repos/$Repo/rulesets/$rid"; Info "deleted ruleset '$RulesetName' (id=$rid)" }
  else { Info "no ruleset named '$RulesetName' to delete" }
  foreach ($env in @('staging','production')) {
    if ($DryRun) { Info "[dry-run] delete environment $env" }
    else { gh api -X DELETE "repos/$Repo/environments/$env" 2>$null; Info "deleted environment '$env' (if it existed)" }
  }
  Step "Done (removed)"
  return
}

# -- 1. Environments ------------------------------------------------------------
Step "1. Environments (staging auto - production = required reviewer)"
Invoke-GhApi -Method PUT -Path "repos/$Repo/environments/staging" | Out-Null
Info "staging environment ensured (no reviewer - auto-deploy)."

$reviewerId = gh api "users/$Reviewer" --jq '.id' 2>$null
if (-not $reviewerId) { throw "Could not resolve GitHub user id for '$Reviewer'." }
$prodBody = @{
  wait_timer               = 0
  prevent_self_review      = $false
  reviewers                = @(@{ type = 'User'; id = [int]$reviewerId })
  deployment_branch_policy = $null
} | ConvertTo-Json -Depth 6
Invoke-GhApi -Method PUT -Path "repos/$Repo/environments/production" -JsonBody $prodBody | Out-Null
Info "production environment ensured (required reviewer = $Reviewer, id=$reviewerId). NATIVE human release gate."

# -- 2. Verify required-check NAMES exist before requiring them (#4 self-lock guard) --
Step "2. Verifying required-check names have registered (anti-self-lock, gap-review #4)"
$seen = @()
try {
  $seen = gh api "repos/$Repo/commits/$Branch/check-runs" --jq '.check_runs[].name' 2>$null | Sort-Object -Unique
} catch { $seen = @() }
$present = @(); $missing = @()
foreach ($c in $RequiredChecks) { if ($seen -contains $c) { $present += $c } else { $missing += $c } }
foreach ($c in $present) { Info "  [ok] registered: $c" }
foreach ($c in $missing) { Warn "  [!] NOT yet seen on $Branch : $c" }

$checksToRequire = $present
if ($missing.Count -gt 0) {
  if ($Force) {
    Warn "-Force set: requiring ALL listed checks incl. $($missing.Count) not-yet-seen - PRs will block until each first runs."
    $checksToRequire = $RequiredChecks
  } else {
    Warn "Requiring only the $($present.Count) already-registered checks. Re-run after the missing ones have run once,"
    Warn "or pass -Force to require them now (only if you're sure the names are exact)."
  }
}
if ($checksToRequire.Count -eq 0 -and -not $DryRun) {
  throw "No required-check names have registered yet. Do step (b): open a throwaway PR so the workflows run, then re-run this script."
}

# -- 3. Ruleset: PR + CODEOWNERS review + required status checks (+ opt-in merge queue) --
Step "3. Branch ruleset on '$Branch' (PR + CODEOWNERS review + required checks)"
$rules = @(
  @{ type = 'pull_request'; parameters = @{
      required_approving_review_count    = 1
      require_code_owner_review          = $true
      dismiss_stale_reviews_on_push      = $true
      require_last_push_approval         = $false
      required_review_thread_resolution  = $false
  }},
  @{ type = 'required_status_checks'; parameters = @{
      strict_required_status_checks_policy = $true
      do_not_enforce_on_create             = $false
      required_status_checks               = @($checksToRequire | ForEach-Object { @{ context = $_ } })
  }}
)
if ($WithMergeQueue) {
  $rules += @{ type = 'merge_queue'; parameters = @{
      check_response_timeout_minutes    = 60
      grouping_strategy                 = 'ALLGREEN'
      max_entries_to_build              = 5
      max_entries_to_merge              = 5
      merge_method                      = 'SQUASH'
      min_entries_to_merge              = 1
      min_entries_to_merge_wait_minutes = 5
  }}
}
$rulesetBody = @{
  name        = $RulesetName
  target      = 'branch'
  enforcement = 'active'
  conditions  = @{ ref_name = @{ include = @("refs/heads/$Branch"); exclude = @() } }
  rules       = $rules
} | ConvertTo-Json -Depth 12

$rid = (gh api "repos/$Repo/rulesets" --jq ".[] | select(.name==`"$RulesetName`") | .id" 2>$null | Select-Object -First 1)
try {
  if ($rid) { Invoke-GhApi -Method PUT  -Path "repos/$Repo/rulesets/$rid" -JsonBody $rulesetBody | Out-Null; Info "updated ruleset '$RulesetName' (id=$rid)" }
  else      { Invoke-GhApi -Method POST -Path "repos/$Repo/rulesets"      -JsonBody $rulesetBody | Out-Null; Info "created ruleset '$RulesetName'" }
  Info "required: 1 review + CODEOWNERS; $($checksToRequire.Count) status checks; merge-queue=$([bool]$WithMergeQueue)."
} catch {
  if ($WithMergeQueue) {
    Warn "Ruleset with merge_queue failed ($($_.Exception.Message.Split([Environment]::NewLine)[0]))."
    Warn "Degrading gracefully: retrying WITHOUT the merge-queue rule (honest fallback - merge queue may be unavailable on this repo/plan)."
    $rulesNoMq = $rules | Where-Object { $_.type -ne 'merge_queue' }
    $bodyNoMq  = @{ name=$RulesetName; target='branch'; enforcement='active'; conditions=@{ ref_name=@{ include=@("refs/heads/$Branch"); exclude=@() } }; rules=$rulesNoMq } | ConvertTo-Json -Depth 12
    if ($rid) { Invoke-GhApi -Method PUT -Path "repos/$Repo/rulesets/$rid" -JsonBody $bodyNoMq | Out-Null }
    else      { Invoke-GhApi -Method POST -Path "repos/$Repo/rulesets"     -JsonBody $bodyNoMq | Out-Null }
    Warn "Ruleset applied WITHOUT merge queue. Document this in the demo as 'merge queue unavailable - degraded'."
  } else { throw }
}

# -- 4. Next step (manual verification - #4 step d) -----------------------------
Step "Next: verify the gate actually bites (gap-review #4 step d)"
Info "Open a deliberately-failing PR (e.g. break a unit test) and confirm GitHub BLOCKS merge:"
Info "  - the failing required check shows 'Required' + red, and"
Info "  - 'Merge' is disabled until a CODEOWNER approves AND all required checks pass."
Info "Then a clean PR should merge. That is the live proof the NATIVE gate enforces."
Step "Done (enforced)"
