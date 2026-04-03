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

' Try sync-db up to 5 times with 5-second waits (handles PG startup delay)
Dim retries, dbOk
retries = 0
dbOk = False
Do While retries < 5 And Not dbOk
    Dim exitCode
    exitCode = WshShell.Run("cmd /c cd /d """ & strPath & """ && node windows\sync-db.cjs", 0, True)
    If exitCode = 0 Then
        dbOk = True
    Else
        retries = retries + 1
        WScript.Sleep 5000
    End If
Loop

If Not dbOk Then
    MsgBox "Database connection failed after 5 attempts." & vbCrLf & _
           "Check that PostgreSQL is running." & vbCrLf & vbCrLf & _
           "Run windows\start.bat manually to see the error.", _
           vbCritical, "Cashflow IC Dashboard"
    WScript.Quit 1
End If

' Now start the server
WshShell.Run "cmd /c cd /d """ & strPath & _
    """ && set NODE_ENV=production && if not exist dist\index.cjs " & _
    "(npx tsx script/build.ts) && node dist/index.cjs", 0, False
WScript.Sleep 10000
WshShell.Run "http://localhost:3000", 1, False
