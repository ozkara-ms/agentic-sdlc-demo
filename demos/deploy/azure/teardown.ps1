<#
.SYNOPSIS
  Idempotent teardown — leaves ZERO residual spend and ZERO residual trust.

.DESCRIPTION
  Reverses provision.ps1:
    * Deletes the resource group (all Azure resources — incl. the private ACR + its images — and the
      RG-/ACR-scoped role assignments).
    * Deletes the Entra app registration (removes its service principal + every federated credential).
    * Deletes the repo variables and the staging/production GitHub Environments.
    * Runs a post-teardown VERIFICATION query and prints PASS/leftover for each surface.

  Re-runnable: every delete tolerates "already gone".

.NOTES
  gh operations need a workflow/admin-scoped token; the script falls back to the keyring token if the
  host GH_TOKEN lacks scope. Use -KeepRepoSide to tear down Azure only.
#>
[CmdletBinding()]
param(
  [string]$Subscription  = '',
  [string]$ResourceGroup = 'rg-agentic-sdlc-demo',
  [string]$Repo          = '<your-org>/agentic-sdlc-demo-live',
  [string]$AppRegName    = 'agentic-sdlc-demo-gha',
  [switch]$KeepRepoSide,
  [switch]$NoWait
)

$ErrorActionPreference = 'Continue'
function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor White }

# Run a gh command, falling back to the keyring token if the host token lacks scope.
function Gh-Fallback([string[]]$ghArgs) {
  & gh @ghArgs 2>$null
  if ($LASTEXITCODE -ne 0) { $prev=$env:GH_TOKEN; $env:GH_TOKEN=''; & gh @ghArgs 2>$null; $env:GH_TOKEN=$prev }
}

# Default to the currently logged-in subscription when -Subscription is not supplied.
if (-not $Subscription) { $Subscription = (az account show --query id -o tsv) }
az account set -s $Subscription 2>$null

Step "1. Resource group ($ResourceGroup)"
if ((az group exists -n $ResourceGroup) -eq 'true') {
  if ($NoWait) { az group delete -n $ResourceGroup --yes --no-wait | Out-Null; Ok "RG delete started (--no-wait)." }
  else { Info "Deleting RG (this can take a few minutes) ..."; az group delete -n $ResourceGroup --yes | Out-Null; Ok "RG deleted." }
} else { Ok "RG already gone." }

Step "2. Entra app registration ($AppRegName)"
$appId = az ad app list --display-name $AppRegName --query "[0].appId" -o tsv 2>$null
if ($appId) { az ad app delete --id $appId 2>$null | Out-Null; Ok "App registration deleted (SP + federated creds removed)." }
else { Ok "App registration already gone." }

if (-not $KeepRepoSide) {
  Step "3. Repo variables on $Repo"
  foreach ($v in @('AZURE_CLIENT_ID','AZURE_TENANT_ID','AZURE_SUBSCRIPTION_ID','AZURE_RG','AZURE_LOCATION','AZURE_ACR','ACA_ENV','STAGING_APP','PROD_APP')) {
    Gh-Fallback @('variable','delete',$v,'--repo',$Repo)
  }
  Ok "Repo variables removed (if any)."

  Step "4. GitHub Environments (staging, production)"
  foreach ($e in @('staging','production')) {
    Gh-Fallback @('api','-X','DELETE',"repos/$Repo/environments/$e")
  }
  Ok "Environments removed (if any)."
}

# ---------------------------------------------------------------------------
Step "VERIFY — residual spend & trust"
$leftover = 0
$rg = az group exists -n $ResourceGroup
if ($rg -eq 'true') { Warn "RG still present (delete may be in progress if --NoWait)."; $leftover++ } else { Ok "RG: gone." }
$app = az ad app list --display-name $AppRegName --query "length(@)" -o tsv 2>$null
if ([int]$app -gt 0) { Warn "App registration still present."; $leftover++ } else { Ok "App registration: gone." }
if (-not $KeepRepoSide) {
  $vars = Gh-Fallback @('variable','list','--repo',$Repo)
  if ($vars -and ($vars -match 'AZURE_|ACA_ENV|STAGING_APP|PROD_APP')) { Warn "Some repo variables (AZURE_*/ACA_ENV/*_APP) still present."; $leftover++ } else { Ok "Repo variables: clean." }
}
Write-Host ""
if ($leftover -eq 0) { Ok "TEARDOWN VERIFIED — zero residual spend, zero residual trust." }
else { Warn "$leftover surface(s) still present — re-run after Azure async deletes finish." }
