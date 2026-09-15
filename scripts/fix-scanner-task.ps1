# Make the "LeadStream Reddit scanner" scheduled task survive reboots and logouts.
#
# WHY (measured 2026-09-15): every multi-hour lead gap traced to this task being
# unable to run - it was set to run ONLY while micky is interactively signed in,
# had no at-startup trigger, and never retried a failed run. After the 1:31 AM
# Windows Update reboot nothing scanned until the 7 AM login (5.9 h blind).
#
# WHAT THIS CHANGES (and nothing else):
#   1. Runs as the built-in SYSTEM account, so it runs whether or not anyone is
#      logged in. (S4U was tried first and cannot work here: micky is a
#      Microsoft account, and Windows cannot mint an S4U logon for those.)
#      Everything the task touches - C:\dev\leadstream, node.exe, logs\ -
#      is readable/writable by SYSTEM and nothing depends on the user profile.
#   2. Adds an "at startup" trigger, keeping the existing every-10-minutes one.
#   3. Retries a failed run 3 times, 5 minutes apart.
#   4. Only one scan at a time (a slow run can't pile up behind itself).
#
# The action is untouched: wscript.exe run-hidden.vbs -> run-once.cmd -> node
# (absolute path, so it needs nothing from the user's PATH).
#
# Run from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\dev\leadstream\scripts\fix-scanner-task.ps1
# Preview only:   ... -WhatIf

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$TaskName = 'LeadStream Reddit scanner'

$isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host 'ERROR: run this from an elevated (Administrator) PowerShell.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

$task = Get-ScheduledTask -TaskName $TaskName
$info = $task | Get-ScheduledTaskInfo

Write-Host "BEFORE" -ForegroundColor Cyan
Write-Host "  LogonType : $($task.Principal.LogonType)   (Interactive = dead at the lock screen)"
Write-Host "  Triggers  : $($task.Triggers.Count)"
Write-Host "  Retries   : $($task.Settings.RestartCount)"
Write-Host "  Last run  : $($info.LastRunTime)  result $($info.LastTaskResult)"
Write-Host ''

# Keep the existing repeating trigger exactly as it is, add a boot trigger.
$existing = $task.Triggers | Where-Object { $_.Repetition.Interval }
if (-not $existing) { throw "Could not find the existing every-10-min trigger; aborting so nothing is lost." }
$atBoot = New-ScheduledTaskTrigger -AtStartup
$atBoot.Delay = 'PT2M'   # let the network come up first

$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 25) `
    -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

if ($PSCmdlet.ShouldProcess($TaskName, 'Re-register as SYSTEM with startup trigger and retries')) {
    Set-ScheduledTask -TaskName $TaskName `
        -Trigger @($existing + $atBoot) `
        -Principal $principal `
        -Settings $settings | Out-Null

    $after = Get-ScheduledTask -TaskName $TaskName
    Write-Host "AFTER" -ForegroundColor Green
    Write-Host "  LogonType : $($after.Principal.LogonType)"
    Write-Host "  Triggers  : $($after.Triggers.Count)   (10-min repeat + at startup)"
    Write-Host "  Retries   : $($after.Settings.RestartCount) x every $($after.Settings.RestartInterval)"
    Write-Host ''

    # Prove it can actually launch under the new principal.
    Write-Host 'Test-firing one scan now...'
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 8
    $st = (Get-ScheduledTask -TaskName $TaskName).State
    $li = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
    Write-Host "  State: $st   LastRun: $($li.LastRunTime)   LastResult: $($li.LastTaskResult)"
    if ($li.LastTaskResult -ne 0 -and $st -ne 'Running') {
        Write-Host '  WARNING: non-zero result. Check C:\dev\leadstream\logs\scanner.log' -ForegroundColor Yellow
    } else {
        Write-Host '  OK - the scanner launched under the new settings.' -ForegroundColor Green
        Write-Host '  Watch C:\dev\leadstream\logs\scanner.log for the finished pass (~3 min).'
    }
}

Write-Host ''
Read-Host 'Press Enter to close'
