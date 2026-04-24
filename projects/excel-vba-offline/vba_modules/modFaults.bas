Attribute VB_Name = "modFaults"
Option Explicit

Public Sub SaveFaultRecord()
    ' Expected staging cells in sh_admin_tools:
    ' B10 Date, B11 SubstationId, B12 FeederId, B13 EventType, B14 From, B15 To, B16 Source, B17 Remark
    Dim wsIn As Worksheet, wsTx As Worksheet
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    Set wsTx = ThisWorkbook.Worksheets(SH_TX_FAULTS)

    Dim d As Variant, ss As String, feeder As String, eventCode As String
    Dim tFrom As String, tTo As String, src As String, rm As String, dur As Long
    d = wsIn.Range("B10").Value
    ss = NzText(wsIn.Range("B11").Value)
    feeder = NzText(wsIn.Range("B12").Value)
    eventCode = UCase$(NzText(wsIn.Range("B13").Value))
    tFrom = NormalizeTimeInput(NzText(wsIn.Range("B14").Value))
    tTo = NormalizeTimeInput(NzText(wsIn.Range("B15").Value))
    src = NzText(wsIn.Range("B16").Value, "manual")
    rm = NzText(wsIn.Range("B17").Value)

    If Not IsDate(d) Or Len(ss) = 0 Or Len(feeder) = 0 Then
        MsgBox "Fault required fields missing.", vbExclamation
        Exit Sub
    End If
    If Not ValidateEventCode(eventCode) Then
        MsgBox "Invalid event code. Use LS/SD/BD/EF/SF/OC.", vbExclamation
        Exit Sub
    End If

    dur = DurationMinutes(tFrom, tTo)
    If dur < 0 Then
        MsgBox "Invalid time range.", vbExclamation
        Exit Sub
    End If
    If IsFaultDuplicate(CDate(d), ss, feeder, eventCode, tFrom, tTo) Then
        MsgBox "Duplicate fault/interruption prevented.", vbInformation
        Exit Sub
    End If

    Dim nextRow As Long
    nextRow = wsTx.Cells(wsTx.Rows.Count, 1).End(xlUp).Row + 1
    wsTx.Cells(nextRow, 1).Value = NextId("FLT_")
    wsTx.Cells(nextRow, 2).Value = CDate(d)
    wsTx.Cells(nextRow, 3).Value = ss
    wsTx.Cells(nextRow, 4).Value = feeder
    wsTx.Cells(nextRow, 5).Value = eventCode
    wsTx.Cells(nextRow, 6).Value = tFrom
    wsTx.Cells(nextRow, 7).Value = tTo
    wsTx.Cells(nextRow, 8).Value = dur
    wsTx.Cells(nextRow, 9).Value = src
    wsTx.Cells(nextRow, 10).Value = rm
End Sub

Public Function IsFaultDuplicate(ByVal dt As Date, ByVal substationId As String, ByVal feederId As String, ByVal eventCode As String, ByVal fromTime As String, ByVal toTime As String) As Boolean
    Dim ws As Worksheet, lastRow As Long, r As Long
    Set ws = ThisWorkbook.Worksheets(SH_TX_FAULTS)
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row

    For r = 2 To lastRow
        If CDate(ws.Cells(r, 2).Value) = dt _
           And NzText(ws.Cells(r, 3).Value) = substationId _
           And NzText(ws.Cells(r, 4).Value) = feederId _
           And UCase$(NzText(ws.Cells(r, 5).Value)) = eventCode _
           And NzText(ws.Cells(r, 6).Value) = fromTime _
           And NzText(ws.Cells(r, 7).Value) = toTime Then
            IsFaultDuplicate = True
            Exit Function
        End If
    Next r
End Sub
