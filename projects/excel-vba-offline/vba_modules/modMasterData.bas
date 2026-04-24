Attribute VB_Name = "modMasterData"
Option Explicit

Public Sub SaveMasterRecord(ByVal masterType As String)
    Select Case LCase$(Trim$(masterType))
        Case "substation", "substations"
            SaveSubstationMaster
        Case "feeder", "feeders"
            SaveFeederMaster
        Case "employee", "employees"
            SaveEmployeeMaster
        Case Else
            MsgBox "Unknown master type: " & masterType, vbExclamation
    End Select
End Sub

Public Sub SaveSubstationMaster()
    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_MST_SUBSTATIONS)
    nextRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(nextRow, 1).Value = NextId("SS_")
    ws.Cells(nextRow, 2).Value = "New Substation"
    ws.Cells(nextRow, 5).Value = True
End Sub

Public Sub SaveFeederMaster()
    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_MST_FEEDERS)
    nextRow = ws.Cells(ws.Rows.Count, fc_id).End(xlUp).Row + 1

    ws.Cells(nextRow, fc_id).Value = NextId("FD_")
    ws.Cells(nextRow, fc_name).Value = "New Feeder"
    ws.Cells(nextRow, fc_type).Value = "normal"
    ws.Cells(nextRow, fc_mf).Value = 1
    ws.Cells(nextRow, fc_active).Value = True
End Sub

Public Sub SaveEmployeeMaster()
    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_MST_EMP)
    nextRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(nextRow, 1).Value = NextId("EMP_")
    ws.Cells(nextRow, 2).Value = "New Employee"
    ws.Cells(nextRow, 10).Value = True
End Sub
