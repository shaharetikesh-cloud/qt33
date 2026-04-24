Attribute VB_Name = "modChargeHandover"
Option Explicit

Public Sub SaveChargeHandover()
    Dim wsIn As Worksheet
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    SaveChargeHandoverFromForm wsIn.Range("F20").Value, NzText(wsIn.Range("F21").Value), NzText(wsIn.Range("F22").Value), NzText(wsIn.Range("F23").Value), NzText(wsIn.Range("F24").Value), NzText(wsIn.Range("F25").Value), NzText(wsIn.Range("F26").Value), NzText(wsIn.Range("F27").Value)
End Sub

Public Sub SaveChargeHandoverFromForm( _
    ByVal opDate As Variant, _
    ByVal substationId As String, _
    ByVal shiftText As String, _
    ByVal outgoing As String, _
    ByVal incoming As String, _
    ByVal pendingItems As String, _
    ByVal notesText As String, _
    ByVal ackText As String)

    If Not IsDate(opDate) Or Len(substationId) = 0 Then
        MsgBox "Handover date/substation required.", vbExclamation
        Exit Sub
    End If

    Dim ws As Worksheet, nextRow As Long
    Set ws = ThisWorkbook.Worksheets(SH_TX_HANDOVER)
    nextRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 1

    ws.Cells(nextRow, 1).Value = NextId("CHO_")
    ws.Cells(nextRow, 2).Value = CDate(opDate)
    ws.Cells(nextRow, 3).Value = substationId
    ws.Cells(nextRow, 4).Value = shiftText
    ws.Cells(nextRow, 5).Value = outgoing
    ws.Cells(nextRow, 6).Value = incoming
    ws.Cells(nextRow, 7).Value = pendingItems
    ws.Cells(nextRow, 8).Value = notesText
    ws.Cells(nextRow, 9).Value = ackText
End Sub
