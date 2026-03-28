Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' Navigate to project root (parent of windows folder)
strWinDir = fso.GetParentFolderName(WScript.ScriptFullName)
strAppDir = fso.GetParentFolderName(strWinDir)
pidFile = strAppDir & "\windows\server.pid"

If fso.FileExists(pidFile) Then
    Set f = fso.OpenTextFile(pidFile, 1)
    pid = Trim(f.ReadAll)
    f.Close
    
    If pid <> "" Then
        WshShell.Run "cmd /c taskkill /F /PID " & pid & " /T >nul 2>&1", 0, True
    End If
    
    fso.DeleteFile pidFile
End If

' Also kill any process on port 3000
WshShell.Run "cmd /c for /f ""tokens=5"" %a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %a >nul 2>&1", 0, True

Set WshShell = Nothing
Set fso = Nothing
