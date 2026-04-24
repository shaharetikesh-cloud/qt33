Attribute VB_Name = "modHistory"
Option Explicit

Public Sub SaveHistoryRecord()
    Dim wsIn As Worksheet
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    SaveHistoryFromForm wsIn.Range("D20").Value, NzText(wsIn.Range("D21").Value), NzText(wsIn.Range("D22").Value), NzText(wsIn.Range("D23").Value), NzText(wsIn.Range("D24").Value), NzText(wsIn.Range("D25").Value), NzText(wsIn.Range("D26").Value), NzText(wsIn.Range("D27").Value), NzText(wsIn.Range("D28").Value), NzText(wsIn.Range("D29").Value), NzText(wsIn.Range("D30").Value), NzText(wsIn.Range("D31").Value), NzText(wsIn.Range("D32").Value), NzText(wsIn.Range("D33").Value), NzText(wsIn.Range("D34").Value)
End Sub

Public Sub SaveHistoryFromForm( _
    ByVal opDate As Variant, _
    ByVal substationId As String, _
    ByVal assetType As String, _
    ByVal equipmentName As String, _
    ByVal makeText As String, _
    ByVal serialNo As String, _
    ByVal capacitySpec As String, _
    ByVal feederBay As String, _
    ByVal installDate As String, _
    ByVal replacementDate As String, _
    ByVal repairDate As String, _
    ByVal locationText As String, _
    ByVal changeHistory As String, _
    ByVal remarkText As String, _
    ByVal extraRef As String)

    If Not IsDate(opDate) Or Len(substationId) = 0 Then
        MsgBox "History date/substation required.", vbExclamation
        Exit Sub
    End If

    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_TX_HISTORY)
    nextRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(nextRow, 1).Value = NextId("HIS_")
    ws.Cells(nextRow, 2).Value = CDate(opDate)
    ws.Cells(nextRow, 3).Value = substationId
    ws.Cells(nextRow, 4).Value = assetType
    ws.Cells(nextRow, 5).Value = equipmentName
    ws.Cells(nextRow, 6).Value = makeText
    ws.Cells(nextRow, 7).Value = serialNo
    ws.Cells(nextRow, 8).Value = capacitySpec
    ws.Cells(nextRow, 9).Value = feederBay
    ws.Cells(nextRow, 10).Value = installDate
    ws.Cells(nextRow, 11).Value = replacementDate
    ws.Cells(nextRow, 12).Value = repairDate
    ws.Cells(nextRow, 13).Value = locationText
    ws.Cells(nextRow, 14).Value = changeHistory & IIf(Len(extraRef) > 0, " | Ref: " & extraRef, "")
    ws.Cells(nextRow, 15).Value = remarkText
End Sub
