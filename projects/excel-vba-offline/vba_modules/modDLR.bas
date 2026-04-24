Attribute VB_Name = "modDLR"
Option Explicit

Public Sub SaveDailyLog()
    ' Expected caller: frmDailyLog Save button.
    ' Base save flow using sh_admin_tools staging controls.
    ' B2: Date, B3: SubstationId, B4: Hour, B5: FeederId, B6: Amp, B7: KV, B8: KWH, B9: Event, B18: Remark
    Dim wsIn As Worksheet, wsTx As Worksheet, nextRow As Long
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    Set wsTx = ThisWorkbook.Worksheets(SH_TX_DLR)

    Dim opDate As Variant, ss As String, hr As String, feeder As String, evt As String
    opDate = wsIn.Range("B2").Value
    ss = NzText(wsIn.Range("B3").Value)
    hr = NormalizeTimeInput(NzText(wsIn.Range("B4").Value))
    feeder = NzText(wsIn.Range("B5").Value)
    evt = UCase$(NzText(wsIn.Range("B9").Value))

    If Not ValidateDLRRequired(ss, opDate) Then
        MsgBox "DLR date/substation required.", vbExclamation
        Exit Sub
    End If
    If ParseHourToIndex(hr) < 0 Then
        MsgBox "Invalid DLR hour.", vbExclamation
        Exit Sub
    End If
    If Len(evt) > 0 And Not ValidateEventCode(evt) Then
        MsgBox "Invalid event code.", vbExclamation
        Exit Sub
    End If

    nextRow = wsTx.Cells(wsTx.Rows.Count, 1).End(xlUp).Row + 1
    wsTx.Cells(nextRow, 1).Value = NextId("DLR_")
    wsTx.Cells(nextRow, 2).Value = CDate(opDate)
    wsTx.Cells(nextRow, 3).Value = ss
    wsTx.Cells(nextRow, 4).Value = hr
    wsTx.Cells(nextRow, 5).Value = feeder
    wsTx.Cells(nextRow, 6).Value = wsIn.Range("B6").Value
    wsTx.Cells(nextRow, 7).Value = wsIn.Range("B7").Value
    wsTx.Cells(nextRow, 8).Value = wsIn.Range("B8").Value
    wsTx.Cells(nextRow, 9).Value = evt
    wsTx.Cells(nextRow, 10).Value = IIf(Len(evt) > 0, "event", "actual")
    wsTx.Cells(nextRow, 11).Value = IIf(Len(evt) > 0, "overlay", "manual")
    wsTx.Cells(nextRow, 12).Value = NzText(wsIn.Range("B18").Value)
End Sub

Public Sub SaveDailyLogFromForm( _
    ByVal opDate As Variant, _
    ByVal substationId As String, _
    ByVal hourText As String, _
    ByVal feederId As String, _
    ByVal ampValue As Variant, _
    ByVal kvValue As Variant, _
    ByVal kwhValue As Variant, _
    ByVal eventCode As String, _
    ByVal remarkText As String)

    Dim wsTx As Worksheet, nextRow As Long, hr As String, evt As String
    Set wsTx = ThisWorkbook.Worksheets(SH_TX_DLR)
    hr = NormalizeTimeInput(NzText(hourText))
    evt = UCase$(NzText(eventCode))

    If Not ValidateDLRRequired(substationId, opDate) Then
        MsgBox "DLR date/substation required.", vbExclamation
        Exit Sub
    End If
    If ParseHourToIndex(hr) < 0 Then
        MsgBox "Invalid DLR hour.", vbExclamation
        Exit Sub
    End If
    If Len(evt) > 0 And Not ValidateEventCode(evt) Then
        MsgBox "Invalid event code.", vbExclamation
        Exit Sub
    End If

    nextRow = wsTx.Cells(wsTx.Rows.Count, 1).End(xlUp).Row + 1
    wsTx.Cells(nextRow, 1).Value = NextId("DLR_")
    wsTx.Cells(nextRow, 2).Value = CDate(opDate)
    wsTx.Cells(nextRow, 3).Value = substationId
    wsTx.Cells(nextRow, 4).Value = hr
    wsTx.Cells(nextRow, 5).Value = feederId
    wsTx.Cells(nextRow, 6).Value = ampValue
    wsTx.Cells(nextRow, 7).Value = kvValue
    wsTx.Cells(nextRow, 8).Value = kwhValue
    wsTx.Cells(nextRow, 9).Value = evt
    wsTx.Cells(nextRow, 10).Value = IIf(Len(evt) > 0, "event", "actual")
    wsTx.Cells(nextRow, 11).Value = IIf(Len(evt) > 0, "overlay", "manual")
    wsTx.Cells(nextRow, 12).Value = NzText(remarkText)
End Sub

Public Sub FinalizeDailyLog()
    ' Finalize for selected Date/Substation from sh_admin_tools B2/B3
    ' Rule: unresolved trailing blank KWH entries become LS events.
    Dim wsIn As Worksheet, wsTx As Worksheet
    Set wsIn = ThisWorkbook.Worksheets("sh_admin_tools")
    Set wsTx = ThisWorkbook.Worksheets(SH_TX_DLR)

    Dim opDate As Date, ss As String
    If Not IsDate(wsIn.Range("B2").Value) Then Exit Sub
    opDate = CDate(wsIn.Range("B2").Value)
    ss = NzText(wsIn.Range("B3").Value)
    If Len(ss) = 0 Then Exit Sub

    Dim feederMap As Object
    Set feederMap = CreateObject("Scripting.Dictionary")

    Dim lastRow As Long, r As Long
    lastRow = wsTx.Cells(wsTx.Rows.Count, 1).End(xlUp).Row

    For r = 2 To lastRow
        If IsDate(wsTx.Cells(r, 2).Value) Then
            If CDate(wsTx.Cells(r, 2).Value) = opDate And NzText(wsTx.Cells(r, 3).Value) = ss Then
                feederMap(NzText(wsTx.Cells(r, 5).Value) & "|" & NzText(wsTx.Cells(r, 4).Value)) = r
            End If
        End If
    Next r

    Dim f As Variant, h As Long, hasAnchor As Boolean, pendingStart As Long
    Dim feederIds As Object
    Set feederIds = CreateObject("Scripting.Dictionary")
    For Each f In feederMap.Keys
        feederIds(Split(CStr(f), "|")(0)) = True
    Next f

    Dim fid As Variant
    For Each fid In feederIds.Keys
        hasAnchor = False
        pendingStart = -1
        For h = 0 To 24
            Dim ht As String, key As String
            ht = Format$(h, "00") & ":00"
            key = CStr(fid) & "|" & ht

            If feederMap.Exists(key) Then
                Dim rowIx As Long, kwhVal As String
                rowIx = CLng(feederMap(key))
                kwhVal = NzText(wsTx.Cells(rowIx, 8).Value)

                If Len(kwhVal) > 0 Then
                    hasAnchor = True
                    pendingStart = -1
                ElseIf hasAnchor And pendingStart < 0 Then
                    pendingStart = h
                End If
            End If
        Next h

        If pendingStart >= 0 Then
            For h = pendingStart To 24
                Dim k2 As String
                k2 = CStr(fid) & "|" & Format$(h, "00") & ":00"
                If feederMap.Exists(k2) Then
                    Dim rr As Long
                    rr = CLng(feederMap(k2))
                    If Len(NzText(wsTx.Cells(rr, 8).Value)) = 0 Then
                        wsTx.Cells(rr, 9).Value = "LS"
                        wsTx.Cells(rr, 10).Value = "event"
                        wsTx.Cells(rr, 11).Value = "auto_finalize_gap"
                    End If
                End If
            Next h
        End If
    Next fid
End Sub

Public Function ParseHourToIndex(ByVal hourText As String) As Long
    Dim hh As String
    hh = NormalizeTimeInput(hourText)
    If Len(hh) = 0 Then ParseHourToIndex = -1: Exit Function
    If hh = "24:00" Then ParseHourToIndex = 24: Exit Function
    ParseHourToIndex = CLng(Left$(hh, 2))
End Function
