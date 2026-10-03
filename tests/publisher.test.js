import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('publisher previews never open a Git pager and still report command failures',{skip:process.platform!=='win32'},()=>{
  const script=String.raw`
    $ErrorActionPreference='Stop'
    $source=[IO.File]::ReadAllText($env:MEDMETRIC_PUBLISHER_TEST_FILE)
    $payload=($source -split '(?m)^# POWERSHELL_PAYLOAD\r?$',2)[1]
    $tokens=$null; $parseErrors=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($payload,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw 'The publisher PowerShell payload does not parse.'}
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-Git'},$true)
    if(-not $function){throw 'The publisher Git command wrapper is missing.'}
    Invoke-Expression $function.Extent.Text
    $script:MockExitCode=0
    function git {
      if($args[0] -ne '--no-pager'){throw 'Publisher can open an interactive pager and stall before committing.'}
      if($args[1] -ne 'diff' -or $args[2] -ne '--stat'){throw 'Publisher changed the requested Git arguments.'}
      Write-Output 'Publisher preview completed without keyboard input.'
      $global:LASTEXITCODE=$script:MockExitCode
    }
    Invoke-Git -GitArgs @('diff','--stat')
    $script:MockExitCode=7
    $failed=$false
    try {Invoke-Git -GitArgs @('diff','--stat')} catch {
      if($_.Exception.Message -notlike 'Git failed:*'){throw}
      $failed=$true
    }
    if(-not $failed){throw 'Publisher silently accepted a failed Git command.'}
    Write-Output 'Publisher failure reporting preserved.'
  `;
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,MEDMETRIC_PUBLISHER_TEST_FILE:fileURLToPath(new URL('../Commit-and-Push.cmd',import.meta.url))}});
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/Publisher preview completed without keyboard input/);
  assert.match(result.stdout,/Publisher failure reporting preserved/);
});

test('publisher retries temporary remote failures, preserves push arguments and stops on permanent errors',{skip:process.platform!=='win32'},()=>{
  const script=String.raw`
    $ErrorActionPreference='Stop'
    $source=[IO.File]::ReadAllText($env:MEDMETRIC_PUBLISHER_TEST_FILE)
    $payload=($source -split '(?m)^# POWERSHELL_PAYLOAD\r?$',2)[1]
    $tokens=$null; $parseErrors=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($payload,[ref]$tokens,[ref]$parseErrors)
    if($parseErrors.Count){throw 'The publisher PowerShell payload does not parse.'}
    $function=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-GitRemote'},$true)
    if(-not $function){throw 'Publisher has no bounded connection retry.'}
    Invoke-Expression $function.Extent.Text
    $script:Attempts=0; $script:Mode='temporary'; $script:Command='fetch'; $script:Sleeps=0
    function Start-Sleep {param($Seconds) $script:Sleeps++}
    function git {
      $script:Attempts++
      if($args[0] -ne '--no-pager' -or $args[1] -ne '-c' -or $args[2] -ne 'http.version=HTTP/1.1'){throw 'Publisher did not use scoped HTTP/1.1.'}
      if($args[3] -ne $script:Command -or $args[4] -ne 'origin'){throw 'Publisher changed its remote command.'}
      if($script:Command -eq 'push' -and $args[5] -ne 'HEAD:refs/heads/main'){throw 'Publisher changed its push destination.'}
      if($args -contains '--force'){throw 'Publisher used force push.'}
      if($script:Mode -eq 'temporary' -and $script:Attempts -eq 1){Write-Output 'fatal: Empty reply from server';$global:LASTEXITCODE=128}
      elseif($script:Mode -eq 'permanent'){Write-Output 'fatal: Authentication failed';$global:LASTEXITCODE=128}
      elseif($script:Mode -eq 'exhausted'){Write-Output 'fatal: Connection reset by peer';$global:LASTEXITCODE=128}
      else{Write-Output 'Remote command completed';$global:LASTEXITCODE=0}
    }
    Invoke-GitRemote -GitArgs @('fetch','origin')
    if($script:Attempts -ne 2 -or $script:Sleeps -ne 1){throw 'Transient fetch did not retry once.'}
    $script:Attempts=0; $script:Command='push'
    Invoke-GitRemote -GitArgs @('push','origin','HEAD:refs/heads/main')
    if($script:Attempts -ne 2){throw 'Transient push did not retry.'}
    $script:Attempts=0; $script:Mode='permanent'; $failed=$false
    try {Invoke-GitRemote -GitArgs @('push','origin','HEAD:refs/heads/main')} catch {if($_.Exception.Message -notlike 'Git failed:*'){throw};$failed=$true}
    if(-not $failed -or $script:Attempts -ne 1){throw 'Permanent failure was retried or swallowed.'}
    $script:Attempts=0; $script:Mode='exhausted'; $failed=$false
    try {Invoke-GitRemote -GitArgs @('push','origin','HEAD:refs/heads/main')} catch {if($_.Exception.Message -notlike 'Git failed:*'){throw};$failed=$true}
    if(-not $failed -or $script:Attempts -ne 3){throw 'Connection retries are not bounded.'}
    Write-Output 'Remote retry checks passed.'
  `;
  const result=spawnSync('powershell.exe',['-NoLogo','-NoProfile','-Command',script],{encoding:'utf8',timeout:10000,windowsHide:true,env:{...process.env,MEDMETRIC_PUBLISHER_TEST_FILE:fileURLToPath(new URL('../Commit-and-Push.cmd',import.meta.url))}});
  assert.equal(result.error,undefined);
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/Remote retry checks passed/);
});
