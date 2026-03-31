Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
WshShell.CurrentDirectory = strPath

If Not fso.FileExists(strPath & "\.env") Then
    MsgBox "Error: .env file not found." & vbCrLf & vbCrLf & "Run windows\install.bat first to configure the database connection.", vbCritical, "Cashflow IC Dashboard"
    WScript.Quit 1
End If

Set envFile = fso.OpenTextFile(strPath & "\.env", 1)
Do While Not envFile.AtEndOfStream
    line = Trim(envFile.ReadLine)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
        eqPos = InStr(line, "=")
        If eqPos > 0 Then
            key = Left(line, eqPos - 1)
            val = Mid(line, eqPos + 1)
            WshShell.Environment("Process")(key) = val
        End If
    End If
Loop
envFile.Close

Dim cmd
cmd = "cmd /c cd /d """ & strPath & """ & node windows\sync-db.cjs 2>nul"

If Not fso.FileExists(strPath & "\dist\public\index.html") Then
    cmd = cmd & " & npx vite build >nul 2>nul"
End If

cmd = cmd & " & set NODE_ENV=development & npx tsx server/index.ts"

WshShell.Run cmd, 0, False
WScript.Sleep 8000
WshShell.Run "http://localhost:3000", 1, False
