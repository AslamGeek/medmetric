@echo off
setlocal
title MedMetric - Commit and Push
set "MEDMETRIC_PUBLISHER=%~f0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$text = [IO.File]::ReadAllText($env:MEDMETRIC_PUBLISHER); $payload = ($text -split '(?m)^# POWERSHELL_PAYLOAD\r?$', 2)[1]; & ([ScriptBlock]::Create($payload))"
set "PUBLISH_EXIT=%ERRORLEVEL%"
echo.
echo Closing in 3 seconds. Details are saved in MedMetric-publish.log.
timeout /t 3 /nobreak >nul 2>&1
exit /b %PUBLISH_EXIT%
# POWERSHELL_PAYLOAD
$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/AslamGeek/medmetric.git'
$publisherPath = $env:MEDMETRIC_PUBLISHER
$sourceDir = Split-Path -Parent $publisherPath
$checkoutDir = $sourceDir
$logPath = Join-Path $sourceDir 'MedMetric-publish.log'
$appFiles = @(
    'package.json',
    'package-lock.json',
    'vercel.json',
    'next.config.mjs',
    '.gitignore',
    '.env.example',
    'README.md',
    'app/layout.jsx',
    'app/page.jsx',
    'app/globals.css',
    'app/daily-reports.css',
    'app/api/config/route.js',
    'app/api/dashboard/route.js',
    'app/api/drilldown/route.js',
    'app/api/snapshot/route.js',
    'app/api/fields/route.js',
    'components/Dashboard.jsx',
    'components/DailyReports.jsx',
    'components/FieldWorkspace.jsx',
    'components/DoctorDirectory.jsx',
    'components/DoctorProfile.jsx',
    'components/ChartPanel.jsx',
    'components/ProductView.jsx',
    'components/ProductCatalog.jsx',
    'components/ProductRankings.jsx',
    'components/ReportFilters.jsx',
    'components/LiquidityBadge.jsx',
    'lib/analytics.js',
    'lib/daily-reports.js',
    'lib/chart-scales.js',
    'lib/product-rankings.js',
    'lib/product-explorer.js',
    'lib/product-liquidity.js',
    'lib/report-filters.js',
    'lib/api.js',
    'lib/sheets.js',
    'lib/field-tracking.js',
    'lib/doctor-directory.js',
    'lib/field-server.js',
    'lib/field-session.js',
    'lib/dashboard-session.js',
    'scripts/check-deployment.js',
    'scripts/build-field-backend.js',
    'tests/api.test.js',
    'tests/backend.test.js',
    'tests/field-tracking.test.js',
    'tests/doctor-directory.test.js',
    'tests/field-session.test.js',
    'tests/dashboard-session.test.js',
    'tests/product-detail.test.js',
    'tests/chart-scales.test.js',
    'tests/product-rankings.test.js',
    'tests/product-explorer.test.js',
    'tests/product-liquidity.test.js',
    'tests/report-filters.test.js',
    'apps-script/Code.gs',
    'apps-script/appsscript.json'
)
$publishFiles = $appFiles + @('Commit-and-Push.cmd')
$legacyFiles = @('Code.gs', 'Index.html', 'Scripts.html', 'Styles.html', 'appsscript.json')
$transcriptStarted = $false
$resultCode = 1

function Invoke-Git {
    param([string[]]$GitArgs)
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw ('Git failed: git ' + ($GitArgs -join ' ') + '. Check the details above. No force push was attempted.')
    }
}

try {
    Start-Transcript -LiteralPath $logPath -Force | Out-Null
    $transcriptStarted = $true
    Write-Host 'MedMetric publisher' -ForegroundColor Cyan
    Write-Host ('Repository: ' + $repoUrl)
    Write-Host 'Uploads only the approved Next.js source files and this launcher.'
    Write-Host 'Your Google Sheet data, local snapshots, setup documents and logs are not uploaded.'
    Write-Host ''
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw 'Git is not installed or is not on PATH. Install Git for Windows, then double-click again.'
    }
    foreach ($name in $appFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $sourceDir $name) -PathType Leaf)) {
            throw ('Missing ' + $name + '. Keep this CMD in the MedMetric project folder with its source files.')
        }
    }

    # This project is the checkout. Never create another copy.
    if (-not (Test-Path -LiteralPath (Join-Path $sourceDir '.git'))) {
        throw 'The MedMetric project Git metadata is missing. Restore it before publishing.'
    }

    Set-Location -LiteralPath $checkoutDir
    Write-Host 'Checking deployment files and publisher dependencies.'
    & node 'scripts/check-deployment.js'
    if ($LASTEXITCODE -ne 0) {
        throw 'Deployment validation failed. Resolve the missing source files or publisher entries before retrying.'
    }
    $remote = & git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $remote.TrimEnd('/') -ne $repoUrl) {
        throw 'The checkout origin does not match the configured MedMetric repository. No files have been staged or pushed.'
    }
    $branch = & git symbolic-ref --quiet --short HEAD
    if ($LASTEXITCODE -ne 0 -or -not $branch) {
        throw 'The checkout has a detached HEAD. Switch to a branch before publishing.'
    }
    foreach ($marker in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $markerPath = & git rev-parse --git-path $marker
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect Git operation state.' }
        if (Test-Path -LiteralPath $markerPath) { throw 'An unfinished Git merge, rebase or other operation exists. Complete it before publishing.' }
    }

    $staged = @(& git diff --cached --name-only)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged changes.' }
    $otherStaged = @($staged | Where-Object { $_ -notin ($publishFiles + $legacyFiles) })
    if ($otherStaged.Count -gt 0) {
        throw ('Other files are already staged. Unstage or commit them separately before using this source-only publisher: ' + ($otherStaged -join ', '))
    }

    Write-Host ('Checking remote branch: ' + $branch)
    Invoke-Git -GitArgs @('fetch', 'origin')
    & git show-ref --verify --quiet ('refs/remotes/origin/' + $branch)
    if ($LASTEXITCODE -eq 0) {
        # A fast-forward cannot discard history. Git stops if local edits conflict.
        Invoke-Git -GitArgs @('merge', '--ff-only', ('origin/' + $branch))
    } elseif ($LASTEXITCODE -ne 1) {
        throw 'Cannot inspect the remote branch.'
    }

    # Include removal of the retired local implementation on the next publish.
    $trackedLegacy = @(& git ls-files -- $legacyFiles)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect retired source files.' }
    foreach ($name in $trackedLegacy) {
        if (Test-Path -LiteralPath (Join-Path $sourceDir $name)) {
            throw ('Retired source file has reappeared: ' + $name + '. Review it before publishing.')
        }
    }
    $publishPaths = $publishFiles + $trackedLegacy
    # No sheet snapshots, .env values, node_modules or build output are staged.
    Write-Host ''
    Write-Host 'Files to publish:' -ForegroundColor Cyan
    Invoke-Git -GitArgs (@('status', '--short', '--') + $publishPaths)
    Invoke-Git -GitArgs (@('diff', '--stat', '--') + $publishPaths)
    Invoke-Git -GitArgs (@('add', '-A', '--') + $publishPaths)
    & git diff --cached --quiet
    $diffCode = $LASTEXITCODE
    if ($diffCode -eq 1) {
        $commitMessage = 'Update MedMetric app - ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        Write-Host ''
        Write-Host ('Committing: ' + $commitMessage)
        Write-Host 'If Git reports a missing identity, configure git config --global user.name and user.email, then retry.'
        Invoke-Git -GitArgs @('commit', '-m', $commitMessage)
    } elseif ($diffCode -eq 0) {
        Write-Host 'No new file changes to commit. Checking for pending commits to push.'
    } else {
        throw 'Cannot inspect staged changes for the commit.'
    }

    Write-Host ''
    Write-Host 'Pushing to GitHub. Git may open its sign-in prompt on first use.'
    Invoke-Git -GitArgs @('push', '--set-upstream', 'origin', ('HEAD:refs/heads/' + $branch))
    Write-Host ''
    Write-Host 'SUCCESS - MedMetric changes are committed and pushed.' -ForegroundColor Green
    $resultCode = 0
} catch {
    Write-Host ''
    Write-Host ('FAILED - ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'Review MedMetric-publish.log. Any local changes or commits have been preserved for retry.'
    Write-Host 'For GitHub authentication, sign in through Git Credential Manager; no token belongs in this file.'
} finally {
    if ($transcriptStarted) { Stop-Transcript | Out-Null }
}
exit $resultCode
