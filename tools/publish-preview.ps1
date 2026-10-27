param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $projectRoot
$owner = 'mapdude334'
$repoName = 'longleaf-atlas-preview'
$description = 'Isolated test builds of Longleaf Atlas. Production: mapdude334/longleaf-outdoors.'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'Never'

# Read the existing Git credential into memory; never write or print it.
$credentialLines = "protocol=https`nhost=github.com`nusername=$owner`n`n" | git credential fill 2>$null
$credentialFields = @{}
foreach ($line in $credentialLines) {
  $pair = $line -split '=', 2
  if ($pair.Length -eq 2) { $credentialFields[$pair[0]] = $pair[1] }
}
if (-not $credentialFields['password']) { throw 'No stored GitHub credential is available.' }
$headers = @{ Authorization = "Bearer $($credentialFields['password'])"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2022-11-28' }
function Invoke-PreviewApi($Method, $Path, $Body = $null) {
  $arguments = @{ Method = $Method; Uri = "https://api.github.com/$Path"; Headers = $headers }
  if ($null -ne $Body) { $arguments.Body = $Body | ConvertTo-Json -Depth 8; $arguments.ContentType = 'application/json' }
  Invoke-RestMethod @arguments
}
function Get-OptionalApi($Path) {
  try { Invoke-PreviewApi 'GET' $Path }
  catch { if ([int]$_.Exception.Response.StatusCode -ne 404) { throw } }
}
$profile = Invoke-PreviewApi 'GET' 'user'
if ($profile.login -ne $owner) { throw 'The authenticated account is not mapdude334.' }
$productionBefore = (Invoke-PreviewApi 'GET' "repos/$owner/longleaf-outdoors/commits/main").sha
npm.cmd run test:regions
if ($LASTEXITCODE -ne 0) { throw 'Region zoom tests failed; nothing was published.' }
npm.cmd run test:preview
if ($LASTEXITCODE -ne 0) { throw 'Preview isolation tests failed; nothing was published.' }

if (-not $SkipBuild) {
  $env:BASE_PATH = "/$repoName/"
  $env:VITE_PREVIEW = 'true'
  $env:VITE_TILE_BASE = "https://$owner.github.io/longleaf-outdoors/tiles/"
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'Preview build failed; nothing was published.' }
}
$manifest = Get-Content -Raw (Join-Path $projectRoot 'dist/manifest.webmanifest') | ConvertFrom-Json
if ($manifest.name -ne 'Longleaf Atlas Preview') { throw 'The output is not an isolated preview build.' }
$builtIndex = Get-Content -Raw (Join-Path $projectRoot 'dist/index.html')
if (-not $builtIndex.Contains("/$repoName/assets/")) { throw 'Preview assets use an incorrect deployment path.' }

$repoPath = "repos/$owner/$repoName"
$repo = Get-OptionalApi $repoPath
if (-not $repo) {
  $repo = Invoke-PreviewApi 'POST' 'user/repos' @{ name = $repoName; description = $description; private = $false; auto_init = $true; has_issues = $false; has_wiki = $false }
}
if ($repo.description -ne $description) { throw 'An existing repository uses this name but is not this preview repository.' }
$pages = Get-OptionalApi "$repoPath/pages"
if (-not $pages) { $pages = Invoke-PreviewApi 'POST' "$repoPath/pages" @{ build_type = 'workflow' } }

$publishing = Join-Path $projectRoot '.publishing'
New-Item -ItemType Directory -Path $publishing -Force | Out-Null
$checkout = Join-Path $publishing 'preview-repository'
$remote = "https://$owner@github.com/$owner/$repoName.git"
if (-not (Test-Path -LiteralPath $checkout)) {
  git clone $remote $checkout
  if ($LASTEXITCODE -ne 0) { throw 'Cloning the preview repository failed.' }
} else {
  $actualRemote = git -C $checkout remote get-url origin
  if ($actualRemote -ne $remote) { throw 'The preview checkout has an unexpected remote.' }
  git -C $checkout pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'The preview checkout could not be updated safely.' }
}
$sitePath = Join-Path $checkout 'site'
if (Test-Path -LiteralPath $sitePath) {
  $resolvedSite = (Resolve-Path -LiteralPath $sitePath).Path
  if ($resolvedSite -ne [System.IO.Path]::GetFullPath($sitePath) -or -not $resolvedSite.StartsWith($checkout + [System.IO.Path]::DirectorySeparatorChar)) { throw 'Unexpected generated-site path.' }
  Remove-Item -LiteralPath $resolvedSite -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $sitePath -Recurse
$workflowDir = Join-Path $checkout '.github/workflows'
New-Item -ItemType Directory -Path $workflowDir -Force | Out-Null
$workflow = @'
name: Deploy preview
on:
  push:
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: preview-pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: site
      - id: deploy
        uses: actions/deploy-pages@v4
'@
Set-Content -LiteralPath (Join-Path $workflowDir 'preview.yml') -Value $workflow -Encoding utf8
$sourceRevision = git -C $projectRoot rev-parse --short HEAD
$readme = "# Longleaf Atlas Preview`n`n[Open preview](https://$owner.github.io/$repoName/)`n`nTest build from the work-in-progress source based on $sourceRevision. Built $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm')) UTC.`n`nProduction remains at https://$owner.github.io/longleaf-outdoors/. Browser data and downloads are isolated from production.`n"
Set-Content -LiteralPath (Join-Path $checkout 'README.md') -Value $readme -Encoding utf8
git -C $checkout config user.name 'Longleaf Preview'
git -C $checkout config user.email 'mapdude334@users.noreply.github.com'
git -C $checkout add --all
git -C $checkout commit -m "Publish isolated preview based on $sourceRevision"
if ($LASTEXITCODE -ne 0) { throw 'Creating the preview deployment commit failed.' }
git -C $checkout push origin HEAD
if ($LASTEXITCODE -ne 0) { throw 'Pushing the preview deployment failed.' }
$productionAfter = (Invoke-PreviewApi 'GET' "repos/$owner/longleaf-outdoors/commits/main").sha
if ($productionBefore -ne $productionAfter) { throw 'Production changed during preview deployment; inspect the main repository.' }
Write-Output "Preview pushed: https://$owner.github.io/$repoName/"
Write-Output "Production main unchanged: $productionAfter"
