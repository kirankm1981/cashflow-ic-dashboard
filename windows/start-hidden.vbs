On Error Resume Next

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
WshShell.CurrentDirectory = strPath

Dim logFolder, logFilePath, log
logFolder = strPath & "\windows\logs"
If Not fso.FolderExists(logFolder) Then
    fso.CreateFolder(logFolder)
End If

logFilePath = logFolder & "\start-hidden.log"

If fso.FileExists(logFilePath) Then
    Dim existingSize
    existingSize = fso.GetFile(logFilePath).Size
    If existingSize > 10485760 Then
        Dim truncF
        Set truncF = fso.CreateTextFile(logFilePath, True)
        truncF.WriteLine "[" & Now & "] Log truncated (was " & FormatNumber(existingSize / 1048576, 1) & " MB)"
        truncF.Close
    End If
End If

Set log = fso.OpenTextFile(logFilePath, 8, True)
log.WriteLine ""
log.WriteLine "================================================================"
log.WriteLine "[" & Now & "] start-hidden.vbs triggered"
log.WriteLine "[" & Now & "] Script location: " & WScript.ScriptFullName
log.WriteLine "[" & Now & "] Project root: " & strPath
log.WriteLine "================================================================"

If Not fso.FolderExists(strPath) Then
    log.WriteLine "[" & Now & "] ERROR - Project folder not found: " & strPath
    log.Close
    MsgBox "Error: Project folder not found at:" & vbCrLf & strPath, vbCritical, "Assetz Strata"
    WScript.Quit 1
End If
log.WriteLine "[" & Now & "] OK - Project folder exists"

If Not fso.FileExists(strPath & "\.env") Then
    log.WriteLine "[" & Now & "] ERROR - .env file not found at: " & strPath & "\.env"
    log.Close
    MsgBox "Error: .env file not found." & vbCrLf & vbCrLf & "Run windows\install.bat first.", vbCritical, "Assetz Strata"
    WScript.Quit 1
End If
log.WriteLine "[" & Now & "] OK - .env file found"

Dim envLine, eqPos, envKey, envCount
Set envFile = fso.OpenTextFile(strPath & "\.env", 1)
envCount = 0
Do While Not envFile.AtEndOfStream
    envLine = Trim(envFile.ReadLine)
    If Len(envLine) > 0 And Left(envLine, 1) <> "#" Then
        eqPos = InStr(envLine, "=")
        If eqPos > 0 Then
            envKey = Left(envLine, eqPos - 1)
            WshShell.Environment("Process")(envKey) = Mid(envLine, eqPos + 1)
            envCount = envCount + 1
        End If
    End If
Loop
envFile.Close
log.WriteLine "[" & Now & "] OK - Loaded " & envCount & " environment variables"

Dim portCheck
portCheck = WshShell.Run("cmd /c netstat -an | find ""0.0.0.0:3000""", 0, True)
If portCheck = 0 Then
    log.WriteLine "[" & Now & "] Port 3000 already in use - server is already running"
    log.WriteLine "[" & Now & "] Opening browser to http://localhost:3000"
    log.Close
    WshShell.Run "http://localhost:3000", 1, False
    WScript.Quit 0
End If
log.WriteLine "[" & Now & "] Port 3000 is free - will start server"

' Check database connection before starting server
Dim dbRetries, dbReady
dbRetries = 0
dbReady = False
log.WriteLine "[" & Now & "] Checking database connection..."
Do While dbRetries < 12 And Not dbReady
    Dim dbExitCode
    dbExitCode = WshShell.Run("cmd /c cd /d """ & strPath & """ && node windows\sync-db.cjs", 0, True)
    If dbExitCode = 0 Then
        dbReady = True
        log.WriteLine "[" & Now & "] Database connected on attempt " & (dbRetries + 1)
    Else
        dbRetries = dbRetries + 1
        log.WriteLine "[" & Now & "] DB attempt " & dbRetries & " failed, waiting 10s..."
        WScript.Sleep 10000
    End If
Loop

If Not dbReady Then
    log.WriteLine "[" & Now & "] ERROR - Database not available after 12 attempts"
    log.Close
    MsgBox "Database connection failed. Check that PostgreSQL is running.", vbCritical, "Assetz Strata"
    WScript.Quit 1
End If

Dim serverLogPath
serverLogPath = strPath & "\windows\logs\server.log"

If Not fso.FolderExists(strPath & "\windows\logs") Then
    fso.CreateFolder(strPath & "\windows\logs")
End If

If fso.FileExists(serverLogPath) Then
    Dim srvLogSize
    srvLogSize = fso.GetFile(serverLogPath).Size
    If srvLogSize > 52428800 Then
        Dim truncSrv
        Set truncSrv = fso.CreateTextFile(serverLogPath, True)
        truncSrv.WriteLine "[" & Now & "] Log truncated (was " & FormatNumber(srvLogSize / 1048576, 1) & " MB)"
        truncSrv.Close
        log.WriteLine "[" & Now & "] Truncated server.log (was " & FormatNumber(srvLogSize / 1048576, 1) & " MB)"
    End If
End If

Dim needBuild
needBuild = False
If Not fso.FileExists(strPath & "\dist\index.cjs") Then
    needBuild = True
    log.WriteLine "[" & Now & "] dist\index.cjs not found -- build required"
Else
    Dim gitHash, buildHash
    gitHash = ""
    buildHash = ""
    On Error Resume Next
    Dim oExec
    Set oExec = WshShell.Exec("cmd /c cd /d """ & strPath & """ && git rev-parse HEAD 2>nul")
    If Err.Number = 0 Then
        gitHash = Trim(oExec.StdOut.ReadAll)
    End If
    Err.Clear
    If fso.FileExists(strPath & "\dist\.build-hash") Then
        Dim bhFile
        Set bhFile = fso.OpenTextFile(strPath & "\dist\.build-hash", 1)
        buildHash = Trim(bhFile.ReadAll)
        bhFile.Close
    Else
        needBuild = True
        log.WriteLine "[" & Now & "] dist\.build-hash not found -- build required"
    End If
    If Not needBuild And Len(gitHash) > 0 And gitHash <> buildHash Then
        needBuild = True
        log.WriteLine "[" & Now & "] Source updated (git: " & Left(gitHash, 8) & " vs build: " & Left(buildHash, 8) & ") -- rebuild required"
    End If
End If

If needBuild Then
    log.WriteLine "[" & Now & "] Starting build..."
    Dim buildExit
    buildExit = WshShell.Run("cmd /c cd /d """ & strPath & """ && set NODE_ENV= && node windows\build.cjs >> """ & serverLogPath & """ 2>&1", 0, True)
    If buildExit = 0 Then
        log.WriteLine "[" & Now & "] OK - Build completed"
    Else
        log.WriteLine "[" & Now & "] ERROR - Build failed (exit code " & buildExit & ")"
        log.Close
        MsgBox "Build failed. Check windows\logs\server.log for details.", vbCritical, "Assetz Strata"
        WScript.Quit 1
    End If
Else
    log.WriteLine "[" & Now & "] OK - Production build is up to date"
End If

log.WriteLine "[" & Now & "] Starting server (node dist\index.cjs)..."
WshShell.Run "cmd /c cd /d """ & strPath & """ && set NODE_ENV=production && set NODE_OPTIONS=--max-old-space-size=2048 && node dist\index.cjs >> """ & serverLogPath & """ 2>&1", 0, False
WScript.Sleep 3000

Dim attempts, serverUp, http
attempts = 0
serverUp = False
log.WriteLine "[" & Now & "] Waiting for server health check (up to 60s)..."
Do While attempts < 30 And Not serverUp
    Set http = CreateObject("MSXML2.XMLHTTP")
    On Error Resume Next
    http.Open "GET", "http://localhost:3000/api/health", False
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        serverUp = True
    End If
    Err.Clear
    On Error GoTo 0
    Set http = Nothing
    If Not serverUp Then
        attempts = attempts + 1
        WScript.Sleep 2000
    End If
Loop

If serverUp Then
    log.WriteLine "[" & Now & "] OK - Server is running on http://localhost:3000 (responded in " & (attempts * 2 + 3) & "s)"
Else
    log.WriteLine "[" & Now & "] WARNING - Server did not respond to health check after 60s"
    log.WriteLine "[" & Now & "] Check windows\logs\server.log for server errors"
End If

log.WriteLine "[" & Now & "] Opening browser..."
log.Close
WshShell.Run "http://localhost:3000", 1, False
