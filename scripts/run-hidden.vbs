' Launches one scanner pass with no console window (used by the 'LeadStream Reddit scanner' scheduled task).
' Output goes to logs\scanner.log (trimmed by scripts\run-local.js when it grows past ~2 MB).
CreateObject("WScript.Shell").Run "C:\dev\leadstream\scripts\run-once.cmd", 0, False
