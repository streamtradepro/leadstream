' Runs one reddit-daily pass with no console window (used by the 'LeadStream Reddit daily' scheduled task).
CreateObject("WScript.Shell").Run "C:\dev\leadstream\scripts\reddit-daily.cmd", 0, False
