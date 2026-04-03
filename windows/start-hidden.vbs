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

' Check if port 3000 is already in use
Dim portCheck
portCheck = WshShell.Run("cmd /c netstat -an | find ""0.0.0.0:3000""", 0, True)
If portCheck = 0 Then
    ' Port already in use — server may already be running
    WshShell.Run "http://localhost:3000", 1, False
    WScript.Quit 0
End If

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

Dim logFile
logFile = strPath & "\logs\server.log"

' Create logs directory if it doesn't exist
If Not fso.FolderExists(strPath & "\logs") Then
    fso.CreateFolder(strPath & "\logs")
End If

' Truncate log file if it exceeds 50MB
If fso.FileExists(logFile) Then
    Dim logSize
    logSize = fso.GetFile(logFile).Size
    If logSize > 52428800 Then
        Dim truncFile
        Set truncFile = fso.CreateTextFile(logFile, True)
        truncFile.WriteLine "[" & Now & "] Log truncated (was " & FormatNumber(logSize / 1048576, 1) & " MB)"
        truncFile.Close
    End If
End If

' Now start the server via PM2 (restart if exists, otherwise start fresh)
WshShell.Run "cmd /c cd /d """ & strPath & _
    """ && set NODE_ENV=production" & _
    " && if not exist dist\index.cjs (npx tsx script/build.ts)" & _
    " && (pm2 restart cashflow-ic 2>nul || pm2 start dist/index.cjs" & _
    " --name cashflow-ic --restart-delay 3000 --max-restarts 10" & _
    " --output """ & logFile & """ --error """ & logFile & """)", 0, True
WScript.Sleep 3000   ' initial wait for node to start

Dim attempts, serverUp
attempts = 0
serverUp = False
Do While attempts < 30 And Not serverUp
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    On Error Resume Next
    http.Open "GET", "http://localhost:3000/api/health", False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        serverUp = True
    End If
    On Error GoTo 0
    Set http = Nothing
    If Not serverUp Then
        attempts = attempts + 1
        WScript.Sleep 2000   ' poll every 2 seconds
    End If
Loop

' Opens browser only when server confirms ready (or after 60s timeout)
WshShell.Run "http://localhost:3000", 1, False
