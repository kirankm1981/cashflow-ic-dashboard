Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

' Navigate to project root (parent of windows folder)
strWinDir = fso.GetParentFolderName(WScript.ScriptFullName)
strAppDir = fso.GetParentFolderName(strWinDir)
WshShell.CurrentDirectory = strAppDir

If Not fso.FolderExists(strAppDir & "\logs") Then
    fso.CreateFolder(strAppDir & "\logs")
End If

If Not fso.FolderExists(strAppDir & "\data") Then
    fso.CreateFolder(strAppDir & "\data")
End If

WshShell.Run strAppDir & "\windows\start-server.bat", 0, False

Set WshShell = Nothing
Set fso = Nothing
