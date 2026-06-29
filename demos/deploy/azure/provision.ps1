<#
.SYNOPSIS
  Idempotent Azure foundation for the agentic-SDLC demo's REAL Deployment gate (Tier-2).

.DESCRIPTION
  Creates, in the target subscription, everything deploy.yml needs to deploy the URL-shortener
  to Azure Container Apps with NO secrets (OIDC only):

    Resource group        rg-agentic-sdlc-demo            (Sweden Central)
    Log Analytics         log-agentic-sdlc                 (ACA requires a workspace)
    ACA environment       cae-agentic-sdlc
    Container registry    acragenticsdlcdemo               (Basic, private; AcrPush=CI, AcrPull=app MIs)
    App (staging)         ca-urlshortener-staging          ingress :3000, max-replicas 1, MI pull
    App (production)      ca-urlshortener-prod             ingress :3000, max-replicas 1, multiple-revision, MI pull
    Entra app reg         agentic-sdlc-demo-gha            + OIDC federated creds (env-scoped)
    Roles                 Container Apps Contributor (RG) + AcrPush (ACR) for CI; AcrPull (ACR) for app MIs
    Repo variables        AZURE_CLIENT_ID / TENANT_ID / SUBSCRIPTION_ID / RG / ACR / ACA_ENV / *_APP / LOCATION

  Honesty notes (load-bearing):
    * OIDC subjects are ENVIRONMENT-scoped (repo:OWNER/REPO:environment:staging|production) — NOT a
      branch ref and NOT pull_request (a fork-token would otherwise be trusted on a public repo).
    * Zero stored pull secret: each app pulls the private image via its system-assigned managed
      identity (AcrPull); CI pushes via OIDC (AcrPush). No registry password / PAT anywhere.
    * The role is Container Apps Contributor on the RG only (no role-assignment rights, no broad
      Contributor); AcrPush/AcrPull are scoped to the ACR only.
    * Azure IDs are written as repo VARIABLES (non-secret, public-safe), never secrets.

  Re-runnable: every step checks existence first, so running twice is a no-op. Pair with teardown.ps1.

.NOTES
  Prereqs: az CLI (logged in), the `containerapp` extension, and — for repo variables — gh CLI with a
  workflow-scoped token and the target repo already created (run D10 first). Use -SkipRepoVariables to
  provision Azure before the repo exists.
#>
[CmdletBinding()]
param(
  [string]$Subscription   = '<azure-subscription-id>',
  [string]$ResourceGroup  = 'rg-agentic-sdlc-demo',
  [string]$Location       = 'swedencentral',
  [string]$Repo           = '<your-org>/agentic-sdlc-demo-live',
  [string]$AppRegName     = 'agentic-sdlc-demo-gha',
  [string]$LogAnalytics   = 'log-agentic-sdlc',
  [string]$AcaEnv         = 'cae-agentic-sdlc',
  [string]$Acr            = 'acragenticsdlcdemo',
  [string]$StagingApp     = 'ca-urlshortener-staging',
  [string]$ProdApp        = 'ca-urlshortener-prod',
  [string]$SeedImage      = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest',
  [int]   $SeedPort       = 80,
  [int]   $TargetPort     = 3000,
  [switch]$SkipRepoVariables
)

$ErrorActionPreference = 'Stop'
function Info($m) { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Step($m) { Write-Host "`n=== $m ===" -ForegroundColor White }

# ---------------------------------------------------------------------------
Step "0. Context + extensions"
az account set -s $Subscription
$ctx = az account show --query "{name:name,id:id,tenant:tenantId}" -o json | ConvertFrom-Json
Ok "Subscription: $($ctx.name) ($($ctx.id))"
az extension add --name containerapp --upgrade --only-show-errors 2>$null | Out-Null
foreach ($p in @('Microsoft.App','Microsoft.OperationalInsights','Microsoft.ContainerRegistry')) {
  $state = az provider show -n $p --query registrationState -o tsv 2>$null
  if ($state -ne 'Registered') {
    Info "Registering $p ..."; az provider register --namespace $p | Out-Null
    # R-e — actually WAIT for registration; a not-yet-Registered provider fails the first create.
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Seconds 6
      if ((az provider show -n $p --query registrationState -o tsv 2>$null) -eq 'Registered') { break }
    }
  }
  $final = az provider show -n $p --query registrationState -o tsv 2>$null
  if ($final -ne 'Registered') { Warn "$p still '$final' — create steps may fail until it finishes." } else { Ok "$p registered." }
}
Ok "Providers checked; containerapp extension present."

# ---------------------------------------------------------------------------
Step "1. Resource group ($ResourceGroup, $Location)"
if ((az group exists -n $ResourceGroup) -eq 'true') { Ok "RG already exists." }
else { az group create -n $ResourceGroup -l $Location --only-show-errors | Out-Null; Ok "RG created." }
$rgId = az group show -n $ResourceGroup --query id -o tsv

# ---------------------------------------------------------------------------
Step "2. Log Analytics workspace ($LogAnalytics)"
$wsId = az monitor log-analytics workspace show -g $ResourceGroup -n $LogAnalytics --query customerId -o tsv 2>$null
if (-not $wsId) {
  az monitor log-analytics workspace create -g $ResourceGroup -n $LogAnalytics -l $Location --only-show-errors | Out-Null
  Ok "Workspace created."
} else { Ok "Workspace already exists." }
$wsCustomerId = az monitor log-analytics workspace show -g $ResourceGroup -n $LogAnalytics --query customerId -o tsv
$wsKey        = az monitor log-analytics workspace get-shared-keys -g $ResourceGroup -n $LogAnalytics --query primarySharedKey -o tsv

# ---------------------------------------------------------------------------
Step "3. Container Apps environment ($AcaEnv)"
$envExists = az containerapp env show -g $ResourceGroup -n $AcaEnv --query name -o tsv 2>$null
if (-not $envExists) {
  az containerapp env create -g $ResourceGroup -n $AcaEnv -l $Location `
    --logs-workspace-id $wsCustomerId --logs-workspace-key $wsKey --only-show-errors | Out-Null
  Ok "ACA environment created."
} else { Ok "ACA environment already exists." }

# ---------------------------------------------------------------------------
function Ensure-App($name, [bool]$multipleRevision) {
  $exists = az containerapp show -g $ResourceGroup -n $name --query name -o tsv 2>$null
  if ($exists) { Ok "App $name already exists."; return }
  Info "Creating $name (seed image on :$SeedPort; the pipeline retargets to :$TargetPort + swaps the image on first deploy) ..."
  # max-replicas 1: the URL-shortener store is in-memory / per-replica.
  # R-f — create on the SEED image's real port ($SeedPort). deploy.yml runs `ingress update --target-port
  # $TargetPort` before the first real deploy, so the seed never has to listen on a port it doesn't serve.
  az containerapp create -g $ResourceGroup -n $name --environment $AcaEnv `
    --image $SeedImage --ingress external --target-port $SeedPort `
    --min-replicas 0 --max-replicas 1 --only-show-errors | Out-Null
  if ($multipleRevision) {
    az containerapp revision set-mode -g $ResourceGroup -n $name --mode multiple --only-show-errors | Out-Null
    Ok "$name created (multiple-revision mode)."
  } else { Ok "$name created." }
}
Step "4. Container Apps (two apps — a bad candidate never takes prod traffic)"
Ensure-App $StagingApp $false
Ensure-App $ProdApp    $true
$stagingFqdn = az containerapp show -g $ResourceGroup -n $StagingApp --query properties.configuration.ingress.fqdn -o tsv 2>$null
$prodFqdn    = az containerapp show -g $ResourceGroup -n $ProdApp    --query properties.configuration.ingress.fqdn -o tsv 2>$null

# ---------------------------------------------------------------------------
Step "5. ACR (private) + per-app managed-identity pull (zero stored pull secret)"
# Private registry; images pushed by CI (AcrPush via OIDC) and pulled by each app's system-assigned
# managed identity (AcrPull). No registry password, no PAT — the secretless data plane.
$acrId = az acr show -n $Acr -g $ResourceGroup --query id -o tsv 2>$null
if (-not $acrId) {
  Info "Creating ACR $Acr (Basic) ..."
  az acr create -g $ResourceGroup -n $Acr --sku Basic --admin-enabled false --only-show-errors | Out-Null
  $acrId = az acr show -n $Acr -g $ResourceGroup --query id -o tsv
  Ok "ACR created ($Acr.azurecr.io)."
} else { Ok "ACR already exists ($Acr.azurecr.io)." }

function Enable-AcrPull($appName) {
  # 1) ensure the app has a system-assigned managed identity
  # NOTE: use $miPid, NOT $pid — $PID is a read-only PowerShell automatic variable (the process id).
  $miPid = az containerapp identity show -g $ResourceGroup -n $appName --query principalId -o tsv 2>$null
  if (-not $miPid) {
    az containerapp identity assign -g $ResourceGroup -n $appName --system-assigned --only-show-errors | Out-Null
    $miPid = az containerapp identity show -g $ResourceGroup -n $appName --query principalId -o tsv
  }
  # 2) grant that identity AcrPull on the registry
  $havePull = az role assignment list --assignee $miPid --scope $acrId --query "[?roleDefinitionName=='AcrPull'] | [0].id" -o tsv 2>$null
  if (-not $havePull) {
    for ($i = 0; $i -lt 6; $i++) {
      try { az role assignment create --assignee-object-id $miPid --assignee-principal-type ServicePrincipal --role AcrPull --scope $acrId --only-show-errors | Out-Null; break }
      catch { Start-Sleep -Seconds 5 }
    }
  }
  # 3) point the app at the ACR using that managed identity (retry while AcrPull propagates)
  for ($i = 0; $i -lt 6; $i++) {
    try { az containerapp registry set -g $ResourceGroup -n $appName --server "$Acr.azurecr.io" --identity system --only-show-errors | Out-Null; break }
    catch { Start-Sleep -Seconds 5 }
  }
  Ok "$appName → pulls from $Acr.azurecr.io via system managed identity (AcrPull)."
}
Enable-AcrPull $StagingApp
Enable-AcrPull $ProdApp

# ---------------------------------------------------------------------------
Step "6. Entra app registration + service principal ($AppRegName)"
$appId = az ad app list --display-name $AppRegName --query "[0].appId" -o tsv 2>$null
if (-not $appId) {
  $appId = az ad app create --display-name $AppRegName --query appId -o tsv
  Ok "App registration created (appId=$appId)."
} else { Ok "App registration already exists (appId=$appId)." }
$spId = az ad sp show --id $appId --query id -o tsv 2>$null
if (-not $spId) { $spId = az ad sp create --id $appId --query id -o tsv; Ok "Service principal created." }
else { Ok "Service principal already exists." }

# ---------------------------------------------------------------------------
Step "7. OIDC federated credentials (ENVIRONMENT-scoped — no branch, no pull_request)"
$subjects = @{
  "$AppRegName-env-staging"    = "repo:${Repo}:environment:staging"
  "$AppRegName-env-production" = "repo:${Repo}:environment:production"
}
$existing = az ad app federated-credential list --id $appId --query "[].subject" -o tsv 2>$null
foreach ($name in $subjects.Keys) {
  $subject = $subjects[$name]
  if ($existing -and ($existing -split "`n") -contains $subject) { Ok "Federated cred exists: $subject"; continue }
  $fc = @{
    name      = $name
    issuer    = 'https://token.actions.githubusercontent.com'
    subject   = $subject
    audiences = @('api://AzureADTokenExchange')
  } | ConvertTo-Json -Compress
  $tmp = New-TemporaryFile
  Set-Content -Path $tmp -Value $fc -Encoding ascii
  az ad app federated-credential create --id $appId --parameters "@$tmp" --only-show-errors | Out-Null
  Remove-Item $tmp -ErrorAction SilentlyContinue
  Ok "Federated cred created: $subject"
}

# ---------------------------------------------------------------------------
Step "8. Role assignments (least privilege)"
# (a) Container Apps Contributor on the RG — update apps / shift revision traffic. No role-assignment rights.
$role = 'Container Apps Contributor'
$have = az role assignment list --assignee $appId --scope $rgId --query "[?roleDefinitionName=='$role'] | [0].id" -o tsv 2>$null
if ($have) { Ok "Role '$role' already assigned." }
else {
  # The SP can take a few seconds to replicate before it is assignable.
  for ($i = 0; $i -lt 6; $i++) {
    try { az role assignment create --assignee $appId --role $role --scope $rgId --only-show-errors | Out-Null; break }
    catch { Start-Sleep -Seconds 5 }
  }
  Ok "Role '$role' assigned on the RG."
}
# (b) AcrPush on the ACR — the CI identity pushes images via OIDC (`az acr login`), no stored secret.
$havePush = az role assignment list --assignee $appId --scope $acrId --query "[?roleDefinitionName=='AcrPush'] | [0].id" -o tsv 2>$null
if ($havePush) { Ok "Role 'AcrPush' already assigned." }
else {
  for ($i = 0; $i -lt 6; $i++) {
    try { az role assignment create --assignee $appId --role AcrPush --scope $acrId --only-show-errors | Out-Null; break }
    catch { Start-Sleep -Seconds 5 }
  }
  Ok "Role 'AcrPush' assigned on the ACR (CI push identity)."
}

# ---------------------------------------------------------------------------
Step "9. Repo variables (non-secret) on $Repo"
$vars = [ordered]@{
  AZURE_CLIENT_ID       = $appId
  AZURE_TENANT_ID       = $ctx.tenant
  AZURE_SUBSCRIPTION_ID = $ctx.id
  AZURE_RG              = $ResourceGroup
  AZURE_LOCATION        = $Location
  AZURE_ACR             = $Acr
  ACA_ENV               = $AcaEnv
  STAGING_APP           = $StagingApp
  PROD_APP              = $ProdApp
}
if ($SkipRepoVariables) {
  Warn "Skipping repo variables (-SkipRepoVariables). Set them after the repo exists:"
  foreach ($k in $vars.Keys) { Write-Host "    gh variable set $k --repo $Repo --body `"$($vars[$k])`"" }
} else {
  # gh needs workflow scope; the host GH_TOKEN may lack it — fall back to the keyring token.
  $prev = $env:GH_TOKEN
  try {
    foreach ($k in $vars.Keys) {
      gh variable set $k --repo $Repo --body "$($vars[$k])" 2>$null
      if ($LASTEXITCODE -ne 0) { $env:GH_TOKEN=''; gh variable set $k --repo $Repo --body "$($vars[$k])" | Out-Null; $env:GH_TOKEN=$prev }
    }
    Ok "Repo variables set on $Repo."
  } catch { Warn "Could not set repo variables (is $Repo created and gh authed?). $_"; $env:GH_TOKEN=$prev }
}

# ---------------------------------------------------------------------------
Step "DONE — summary"
Write-Host ""
Write-Host "  AZURE_CLIENT_ID        $appId"
Write-Host "  AZURE_TENANT_ID        $($ctx.tenant)"
Write-Host "  AZURE_SUBSCRIPTION_ID  $($ctx.id)"
Write-Host "  Resource group         $ResourceGroup ($Location)"
Write-Host "  Container registry     $Acr.azurecr.io   (private; AcrPush=CI via OIDC, AcrPull=app MIs)"
Write-Host "  Staging app            $StagingApp   https://$stagingFqdn"
Write-Host "  Production app         $ProdApp      https://$prodFqdn"
Write-Host ""
Ok "Foundation ready. Next: create GitHub Environments (staging auto, production = required reviewer) and push deploy.yml."
Warn "Apps currently serve the SEED image on :$SeedPort; deploy.yml retargets to :$TargetPort + swaps in the URL-shortener (pulled from ACR via managed identity) on the FIRST pipeline deploy."
