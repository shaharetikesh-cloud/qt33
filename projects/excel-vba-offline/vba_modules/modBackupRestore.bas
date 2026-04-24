Attribute VB_Name = "modBackupRestore"
Option Explicit

Public Sub FullBackup()
    Dim targetFolder As String
    targetFolder = ThisWorkbook.Path & "\backup_restore\"

    Dim backupName As String
    backupName = "MSEDCL_Backup_" & Format$(Now, "yyyymmdd_hhnnss") & ".xlsm"

    ThisWorkbook.SaveCopyAs targetFolder & backupName
    MsgBox "Backup created: " & backupName, vbInformation
End Sub

Public Sub FullRestore()
    MsgBox "Restore wizard skeleton ready. Implement manifest read + transactional reload.", vbInformation
End Sub

Public Sub WriteBackupManifest()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_admin_tools")
    ws.Range("B4").Value = Now
End Sub
