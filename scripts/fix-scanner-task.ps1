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
#   2. Adds an "at startup" trigger, keeping the every-10-minutes one.
#   3. Retries a failed run 3 times, 5 minutes apart.
#   4. Only one scan at a time (a slow run can't pile up behind itself).
#
# Every object is built fresh rather than reusing the old task's trigger/action
# objects - re-registering with the old CIM objects is a known way to get
# "task XML contains a value which is incorrectly formatted" (0x80041318).
#
# Everything printed is also written to C:\dev\leadstream\logs\fix-scanner-task.log
# and the window ALWAYS pauses at the end, even on error.
#
# Run from an elevated PowerShell:
#   powershell -ExecutionPolicy Bypass -File C:\dev\leadstream\scripts\fix-scanner-task.ps1
# Preview only (no admin needed):   ... -WhatIf

[CmdletBinding(SupportsShouldProcess)]
param()

$TaskName = 'LeadStream Reddit scanner'
$LogFile  = 'C:\dev\leadstream\logs\fix-scanner-task.log'
$exitCode = 0

try { Start-Transcript -Path $LogFile -Append | Out-Null } catch {}

try {
    $ErrorActionPreference = 'Stop'
    Write-Host "=== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') fix-scanner-task ===" -ForegroundColor Cyan

    $isAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
    ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin -and -not $WhatIfPreference) {
        throw 'Not running as Administrator. Re-run so the UAC prompt appears.'
    }

    $task = Get-ScheduledTask -TaskName $TaskName
    $info = $task | Get-ScheduledTaskInfo

    Write-Host 'BEFORE' -ForegroundColor Cyan
    Write-Host "  LogonType : $($task.Principal.LogonType)   (Interactive = dead at the lock screen)"
    Write-Host "  Triggers  : $($task.Triggers.Count)"
    Write-Host "  Retries   : $($task.Settings.RestartCount)"
    Write-Host "  Last run  : $($info.LastRunTime)  result $($info.LastTaskResult)"
    Write-Host ''

    # --- rebuild everything fresh -------------------------------------------
    $oldRepeat = $task.Triggers | Where-Object { $_.Repetition -and $_.Repetition.Interval } | Select-Object -First 1
    if (-not $oldRepeat) { throw 'Could not find the existing every-10-min trigger; aborting so nothing is lost.' }

    $startAt  = [datetime]::Parse($oldRepeat.StartBoundary)
    $interval = [System.Xml.XmlConvert]::ToTimeSpan($oldRepeat.Repetition.Interval)   # PT10M -> 00:10:00
    Write-Host "  keeping repeat trigger: every $($interval.TotalMinutes) min, anchored $startAt"

    $repeat = New-ScheduledTaskTrigger -Once -At $startAt `
        -RepetitionInterval $interval `
        -RepetitionDuration (New-TimeSpan -Days 3650)

    $atBoot = New-ScheduledTaskTrigger -AtStartup
    $atBoot.Delay = 'PT2M'   # let the network come up first

    # Same action as today, rebuilt rather than reused.
    $action = New-ScheduledTaskAction `
        -Execute 'C:\Windows\System32\wscript.exe' `
        -Argument '"C:\dev\leadstream\scripts\run-hidden.vbs"' `
        -WorkingDirectory 'C:\dev\leadstream'

    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Limited

    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 5) `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 25) `
        -MultipleInstances IgnoreNew `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries

    Write-Host '  objects built OK (trigger x2, action, SYSTEM principal, settings)'

    if ($PSCmdlet.ShouldProcess($TaskName, 'Re-register as SYSTEM with startup trigger and retries')) {
        Register-ScheduledTask -TaskName $TaskName `
            -Action $action `
            -Trigger @($repeat, $atBoot) `
            -Principal $principal `
            -Settings $settings `
            -Force | Out-Null

        $after = Get-ScheduledTask -TaskName $TaskName
        Write-Host ''
        Write-Host 'AFTER' -ForegroundColor Green
        Write-Host "  LogonType : $($after.Principal.LogonType)   user $($after.Principal.UserId)"
        Write-Host "  Triggers  : $($after.Triggers.Count)   (10-min repeat + at startup)"
        Write-Host "  Retries   : $($after.Settings.RestartCount) x every $($after.Settings.RestartInterval)"
        Write-Host ''

        Write-Host 'Test-firing one scan now...'
        Start-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 8
        $st = (Get-ScheduledTask -TaskName $TaskName).State
        $li = Get-ScheduledTask -TaskName $TaskName | Get-ScheduledTaskInfo
        Write-Host "  State: $st   LastRun: $($li.LastRunTime)   LastResult: $($li.LastTaskResult)"
        if ($st -eq 'Running' -or $li.LastTaskResult -in 0, 267009) {
            Write-Host '  OK - the scanner launched under the new settings.' -ForegroundColor Green
            Write-Host '  Watch C:\dev\leadstream\logs\scanner.log for the finished pass (~13 min locally).'
        } else {
            Write-Host "  WARNING: result $($li.LastTaskResult). Check C:\dev\leadstream\logs\scanner.log" -ForegroundColor Yellow
            $exitCode = 2
        }
    }
}
catch {
    $exitCode = 1
    Write-Host ''
    Write-Host 'FAILED:' -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
    if ($_.InvocationInfo) { Write-Host "  at line $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray }
    Write-Host '  Nothing was changed.' -ForegroundColor Yellow
}
finally {
    try { Stop-Transcript | Out-Null } catch {}
    Write-Host ''
    Write-Host "(full log: $LogFile)"
    Read-Host 'Press Enter to close'
}
exit $exitCode
