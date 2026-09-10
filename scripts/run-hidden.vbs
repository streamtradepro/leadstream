' Launches one scanner pass with no console window (used by the 'LeadStream Reddit scanner' scheduled task).
' Output goes to logs\scanner.log; the log is trimmed by scripts\run-local.js when it grows past ~2 MB.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\dev\leadstream"
sh.Run "cmd /c """"C:\Program Files\nodejs\node.exe"" scripts\run-local.js --once >> logs\scanner.log 2>&1""", 0, False
