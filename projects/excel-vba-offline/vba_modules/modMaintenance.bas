Attribute VB_Name = "modMaintenance"
Option Explicit

Public Sub SaveMaintenanceRecord()
    Dim wsIn As Worksheet
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    SaveMaintenanceFromForm wsIn.Range("B20").Value, NzText(wsIn.Range("B21").Value), NzText(wsIn.Range("B22").Value), NzText(wsIn.Range("B23").Value), NzText(wsIn.Range("B24").Value), NzText(wsIn.Range("B25").Value), NzText(wsIn.Range("B26").Value), NzText(wsIn.Range("B27").Value), NzText(wsIn.Range("B28").Value), NzText(wsIn.Range("B29").Value)
End Sub

Public Sub SaveMaintenanceFromForm( _
    ByVal opDate As Variant, _
    ByVal substationId As String, _
    ByVal equipment As String, _
    ByVal feederBay As String, _
    ByVal maintType As String, _
    ByVal description As String, _
    ByVal actionTaken As String, _
    ByVal staff As String, _
    ByVal statusText As String, _
    ByVal remarkText As String)

    If Not IsDate(opDate) Or Len(substationId) = 0 Then
        MsgBox "Maintenance date/substation required.", vbExclamation
        Exit Sub
    End If

    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_TX_MAINT)
    nextRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(nextRow, 1).Value = NextId("MNT_")
    ws.Cells(nextRow, 2).Value = CDate(opDate)
    ws.Cells(nextRow, 3).Value = substationId
    ws.Cells(nextRow, 4).Value = equipment
    ws.Cells(nextRow, 5).Value = feederBay
    ws.Cells(nextRow, 6).Value = maintType
    ws.Cells(nextRow, 7).Value = description
    ws.Cells(nextRow, 8).Value = actionTaken
    ws.Cells(nextRow, 9).Value = staff
    ws.Cells(nextRow, 10).Value = statusText
    ws.Cells(nextRow, 11).Value = remarkText
End Sub
