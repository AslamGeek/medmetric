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
