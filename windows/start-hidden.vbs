Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

If Not fso.FileExists(strPath & "\.env") Then
    MsgBox "Error: .env file not found." & vbCrLf & vbCrLf & "Run windows\install.bat first to configure the database connection.", vbCritical, "Cashflow IC Dashboard"
    WScript.Quit 1
End If

Dim batContent
batContent = "@echo off" & vbCrLf
batContent = batContent & "cd /d """ & strPath & """" & vbCrLf

Set envFile = fso.OpenTextFile(strPath & "\.env", 1)
Do While Not envFile.AtEndOfStream
    line = Trim(envFile.ReadLine)
    If Len(line) > 0 And Left(line, 1) <> "#" Then
        eqPos = InStr(line, "=")
        If eqPos > 0 Then
            batContent = batContent & "set """ & line & """" & vbCrLf
        End If
    End If
Loop
envFile.Close

batContent = batContent & "node windows\sync-db.cjs 2>nul" & vbCrLf

If Not fso.FileExists(strPath & "\dist\public\index.html") Then
    batContent = batContent & "call npx vite build >nul 2>nul" & vbCrLf
End If

batContent = batContent & "set NODE_ENV=production" & vbCrLf
batContent = batContent & "npx tsx server/index.ts" & vbCrLf

Dim batFile
batFile = strPath & "\windows\.start-hidden-run.bat"
Set f = fso.CreateTextFile(batFile, True)
f.Write batContent
f.Close

WshShell.Run """" & batFile & """", 0, False
WScript.Sleep 10000
WshShell.Run "http://localhost:3000", 1, False
