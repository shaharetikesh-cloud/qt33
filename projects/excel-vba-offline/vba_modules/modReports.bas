Attribute VB_Name = "modReports"
Option Explicit

Public Sub BuildMonthEndPack()
    Dim wsPack As Worksheet
    Set wsPack = ThisWorkbook.Worksheets("sh_month_end_pack")

    wsPack.Cells.Clear
    wsPack.Range("A1").Value = "MSEDCL Month-End Pack"
    wsPack.Range("A2").Value = "Generated On:"
    wsPack.Range("B2").Value = Now

    RenderMonthEndSection wsPack, 4, "1. Monthly Consumption Report", Array("Feeder", "Units", "Sent Out", "Status")
    RenderMonthEndSection wsPack, 20, "2. Daily Min/Max Feeder Report", Array("Date", "Peak Load", "Peak Feeder", "Min Load")
    RenderMonthEndSection wsPack, 36, "3. Monthly Min/Max Report", Array("Feeder", "Min", "Max", "Remarks")
    RenderMonthEndSection wsPack, 52, "4. Monthly Interruption Report", Array("Feeder", "Count", "Duration Hrs", "Source")
    RenderMonthEndSection wsPack, 68, "5. Energy Balance / Loss Report", Array("Main Inc", "Input", "Outgoing", "Loss %")
    RenderMonthEndSection wsPack, 84, "6. Attendance Monthly Statements", Array("Employee", "Present", "Leave", "Night")
    RenderMonthEndSection wsPack, 100, "7. Night Allowance Statement", Array("Employee", "Night Count", "Rate", "Amount")
    FillMonthEndComputedRows wsPack
    wsPack.Columns("A:H").AutoFit
End Sub

Public Function BuildFaultDurationLabel(ByVal fromTime As String, ByVal toTime As String) As String
    Dim mins As Long
    mins = DurationMinutes(fromTime, toTime)
    If mins < 0 Then
        BuildFaultDurationLabel = "Invalid"
    Else
        BuildFaultDurationLabel = Format$(mins \ 60, "00") & ":" & Format$(mins Mod 60, "00")
    End If
End Function

Public Function EnergyBalanceLossPercent(ByVal inputSentOut As Double, ByVal childOutgoing As Double) As Double
    If inputSentOut = 0 Then
        EnergyBalanceLossPercent = 0
    Else
        EnergyBalanceLossPercent = ((inputSentOut - childOutgoing) / inputSentOut) * 100#
    End If
End Function

Public Sub RenderDailyLogPrint(ByVal reportDate As Date, ByVal substationId As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    ws.Cells.Clear

    ws.Range("A1").Value = "MSEDCL DAILY LOG REGISTER"
    ws.Range("A2").Value = "Date:"
    ws.Range("B2").Value = reportDate
    ws.Range("D2").Value = "Substation:"
    ws.Range("E2").Value = substationId

    ws.Range("A4:H4").Value = Array("Hour", "Feeder", "Amp", "KV", "KWH", "Event", "Entry Mode", "Remark")

    Dim tx As Worksheet, lastRow As Long, r As Long, outRow As Long
    Set tx = ThisWorkbook.Worksheets(SH_TX_DLR)
    lastRow = tx.Cells(tx.Rows.Count, 1).End(xlUp).Row
    outRow = 5

    For r = 2 To lastRow
        If IsDate(tx.Cells(r, 2).Value) Then
            If CDate(tx.Cells(r, 2).Value) = reportDate And NzText(tx.Cells(r, 3).Value) = substationId Then
                ws.Cells(outRow, 1).Value = tx.Cells(r, 4).Value
                ws.Cells(outRow, 2).Value = tx.Cells(r, 5).Value
                ws.Cells(outRow, 3).Value = tx.Cells(r, 6).Value
                ws.Cells(outRow, 4).Value = tx.Cells(r, 7).Value
                ws.Cells(outRow, 5).Value = tx.Cells(r, 8).Value
                ws.Cells(outRow, 6).Value = tx.Cells(r, 9).Value
                ws.Cells(outRow, 7).Value = tx.Cells(r, 10).Value
                ws.Cells(outRow, 8).Value = tx.Cells(r, 12).Value
                outRow = outRow + 1
            End If
        End If
    Next r

    ws.Range("A4:H4").Font.Bold = True
    ws.Range("A4:H" & outRow - 1).Borders.LineStyle = xlContinuous
    ws.Columns("A:H").AutoFit
End Sub

Public Sub RenderAttendanceMonthlyPrint(ByVal monthKey As String, ByVal substationId As String, ByVal moduleType As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    ws.Cells.Clear

    ws.Range("A1").Value = "MSEDCL ATTENDANCE STATEMENT"
    ws.Range("A2").Value = "Month:"
    ws.Range("B2").Value = monthKey
    ws.Range("D2").Value = "Substation:"
    ws.Range("E2").Value = substationId
    ws.Range("G2").Value = "Module:"
    ws.Range("H2").Value = moduleType

    ws.Range("A4:G4").Value = Array("Employee", "Day", "Attendance", "Shift", "CPF", "Remark", "PresentLike")

    Dim txA As Worksheet, txS As Worksheet, emp As Worksheet
    Set txA = ThisWorkbook.Worksheets(SH_TX_ATT)
    Set txS = ThisWorkbook.Worksheets(SH_TX_SHIFT)
    Set emp = ThisWorkbook.Worksheets(SH_MST_EMP)

    Dim outRow As Long, r As Long, lastA As Long
    outRow = 5
    lastA = txA.Cells(txA.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastA
        If NzText(txA.Cells(r, 2).Value) = monthKey _
           And NzText(txA.Cells(r, 3).Value) = substationId _
           And NzText(txA.Cells(r, 4).Value) = moduleType Then
            ws.Cells(outRow, 1).Value = ResolveEmployeeName(NzText(txA.Cells(r, 5).Value), emp)
            ws.Cells(outRow, 2).Value = txA.Cells(r, 6).Value
            ws.Cells(outRow, 3).Value = txA.Cells(r, 7).Value
            ws.Cells(outRow, 4).Value = ResolveShiftCode(monthKey, substationId, NzText(txA.Cells(r, 5).Value), CLng(Val(txA.Cells(r, 6).Value)), txS)
            ws.Cells(outRow, 5).Value = ResolveEmployeeCPF(NzText(txA.Cells(r, 5).Value), emp)
            ws.Cells(outRow, 6).Value = txA.Cells(r, 8).Value
            ws.Cells(outRow, 7).Value = IIf(IsPresentLikeCode(NzText(txA.Cells(r, 7).Value)), "Y", "N")
            outRow = outRow + 1
        End If
    Next r

    ws.Range("A4:G4").Font.Bold = True
    ws.Range("A4:G" & outRow - 1).Borders.LineStyle = xlContinuous
    ws.Columns("A:G").AutoFit
End Sub

Public Sub RenderBatteryWeeklyPrint(ByVal reportDate As Date, ByVal substationId As String, ByVal batterySetId As String)
    Dim ws As Worksheet, tx As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    Set tx = ThisWorkbook.Worksheets(SH_TX_BATTERY)
    ws.Cells.Clear

    ws.Range("A1").Value = "WEEKLY BATTERY MAINTENANCE"
    ws.Range("A2").Value = "Date:"
    ws.Range("B2").Value = reportDate
    ws.Range("D2").Value = "Substation:"
    ws.Range("E2").Value = substationId
    ws.Range("G2").Value = "Battery Set:"
    ws.Range("H2").Value = batterySetId
    ws.Range("A4:F4").Value = Array("Row", "Cell", "SP Gravity", "Voltage", "Condition", "Remark")

    Dim lastRow As Long, r As Long, outRow As Long
    lastRow = tx.Cells(tx.Rows.Count, 1).End(xlUp).Row
    outRow = 5
    For r = 2 To lastRow
        If IsDate(tx.Cells(r, 2).Value) Then
            If CDate(tx.Cells(r, 2).Value) = reportDate And NzText(tx.Cells(r, 3).Value) = substationId And NzText(tx.Cells(r, 4).Value) = batterySetId Then
                ws.Cells(outRow, 1).Value = tx.Cells(r, 5).Value
                ws.Cells(outRow, 2).Value = tx.Cells(r, 6).Value
                ws.Cells(outRow, 3).Value = tx.Cells(r, 7).Value
                ws.Cells(outRow, 4).Value = tx.Cells(r, 8).Value
                ws.Cells(outRow, 5).Value = tx.Cells(r, 9).Value
                ws.Cells(outRow, 6).Value = tx.Cells(r, 11).Value
                outRow = outRow + 1
            End If
        End If
    Next r
    ws.Range("A4:F4").Font.Bold = True
    ws.Range("A4:F" & outRow - 1).Borders.LineStyle = xlContinuous
    ws.Columns("A:F").AutoFit
End Sub

Private Function ResolveEmployeeName(ByVal employeeId As String, ByVal wsEmp As Worksheet) As String
    Dim lastRow As Long, r As Long
    lastRow = wsEmp.Cells(wsEmp.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If NzText(wsEmp.Cells(r, 1).Value) = employeeId Then
            ResolveEmployeeName = NzText(wsEmp.Cells(r, 2).Value)
            Exit Function
        End If
    Next r
    ResolveEmployeeName = employeeId
End Function

Private Function ResolveEmployeeCPF(ByVal employeeId As String, ByVal wsEmp As Worksheet) As String
    Dim lastRow As Long, r As Long
    lastRow = wsEmp.Cells(wsEmp.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If NzText(wsEmp.Cells(r, 1).Value) = employeeId Then
            ResolveEmployeeCPF = "CPF- " & NzText(wsEmp.Cells(r, 5).Value)
            Exit Function
        End If
    Next r
End Function

Private Function ResolveShiftCode(ByVal monthKey As String, ByVal substationId As String, ByVal employeeId As String, ByVal dayNo As Long, ByVal wsShift As Worksheet) As String
    Dim lastRow As Long, r As Long
    lastRow = wsShift.Cells(wsShift.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lastRow
        If NzText(wsShift.Cells(r, 2).Value) = monthKey _
           And NzText(wsShift.Cells(r, 3).Value) = substationId _
           And NzText(wsShift.Cells(r, 4).Value) = employeeId _
           And CLng(Val(wsShift.Cells(r, 5).Value)) = dayNo Then
            ResolveShiftCode = NzText(wsShift.Cells(r, 6).Value)
            Exit Function
        End If
    Next r
End Function

Public Sub RenderFaultRegisterPrint(ByVal fromDate As Date, ByVal toDate As Date, ByVal substationId As String)
    RenderGenericRegister "FAULT / INTERRUPTION REGISTER", SH_TX_FAULTS, fromDate, toDate, substationId, Array("Date", "Feeder", "Event", "From", "To", "Duration", "Source", "Remark")
End Sub

Public Sub RenderMaintenanceRegisterPrint(ByVal fromDate As Date, ByVal toDate As Date, ByVal substationId As String)
    RenderGenericRegister "MAINTENANCE REGISTER", SH_TX_MAINT, fromDate, toDate, substationId, Array("Date", "Equipment", "Feeder/Bay", "Type", "Description", "Action", "Staff", "Status", "Remark")
End Sub

Public Sub RenderHistoryRegisterPrint(ByVal fromDate As Date, ByVal toDate As Date, ByVal substationId As String)
    RenderGenericRegister "ASSET HISTORY REGISTER", SH_TX_HISTORY, fromDate, toDate, substationId, Array("Date", "Asset", "Name", "Serial", "Capacity", "Bay", "Install", "Replace", "Repair", "Remark")
End Sub

Public Sub RenderChargeHandoverPrint(ByVal fromDate As Date, ByVal toDate As Date, ByVal substationId As String)
    RenderGenericRegister "CHARGE HANDOVER REGISTER", SH_TX_HANDOVER, fromDate, toDate, substationId, Array("Date", "Shift", "Outgoing", "Incoming", "Pending", "Notes", "Ack")
End Sub

Private Sub RenderGenericRegister(ByVal titleText As String, ByVal sourceSheetName As String, ByVal fromDate As Date, ByVal toDate As Date, ByVal substationId As String, ByVal headers As Variant)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    ws.Cells.Clear
    ws.Range("A1").Value = titleText
    ws.Range("A2").Value = "From:"
    ws.Range("B2").Value = fromDate
    ws.Range("D2").Value = "To:"
    ws.Range("E2").Value = toDate
    ws.Range("G2").Value = "Substation:"
    ws.Range("H2").Value = substationId

    Dim i As Long
    For i = LBound(headers) To UBound(headers)
        ws.Cells(4, i + 1).Value = headers(i)
    Next i

    Dim src As Worksheet, lr As Long, r As Long, outRow As Long, c As Long
    Set src = ThisWorkbook.Worksheets(sourceSheetName)
    lr = src.Cells(src.Rows.Count, 1).End(xlUp).Row
    outRow = 5
    For r = 2 To lr
        If IsDate(src.Cells(r, 2).Value) Then
            If CDate(src.Cells(r, 2).Value) >= fromDate And CDate(src.Cells(r, 2).Value) <= toDate Then
                If NzText(src.Cells(r, 3).Value) = substationId Then
                    For c = 1 To (UBound(headers) + 1)
                        ws.Cells(outRow, c).Value = src.Cells(r, c + 1).Value
                    Next c
                    outRow = outRow + 1
                End If
            End If
        End If
    Next r

    ws.Range(ws.Cells(4, 1), ws.Cells(4, UBound(headers) + 1)).Font.Bold = True
    ws.Range(ws.Cells(4, 1), ws.Cells(Application.Max(outRow - 1, 4), UBound(headers) + 1)).Borders.LineStyle = xlContinuous
    ws.Columns("A:K").AutoFit
End Sub

Private Sub RenderMonthEndSection(ByVal ws As Worksheet, ByVal startRow As Long, ByVal sectionTitle As String, ByVal headerArr As Variant)
    ws.Cells(startRow, 1).Value = sectionTitle
    ws.Cells(startRow, 1).Font.Bold = True
    Dim i As Long
    For i = LBound(headerArr) To UBound(headerArr)
        ws.Cells(startRow + 1, i + 1).Value = headerArr(i)
        ws.Cells(startRow + 1, i + 1).Font.Bold = True
        ws.Cells(startRow + 1, i + 1).Borders.LineStyle = xlContinuous
    Next i
End Sub

Private Sub FillMonthEndComputedRows(ByVal ws As Worksheet)
    Dim monthKey As String, substationId As String
    monthKey = Format$(Date, "yyyy-mm")
    substationId = NzText(ThisWorkbook.Worksheets("sh_admin_tools").Range("B3").Value)
    If Len(substationId) = 0 Then substationId = "SS001"

    FillMonthlyConsumptionRows ws, 6, monthKey, substationId
    FillMonthlyInterruptionRows ws, 54, monthKey, substationId
    FillAttendanceSummaryRows ws, 86, monthKey, substationId
End Sub

Private Sub FillMonthlyConsumptionRows(ByVal ws As Worksheet, ByVal startRow As Long, ByVal monthKey As String, ByVal substationId As String)
    Dim tx As Worksheet, feederWs As Worksheet
    Set tx = ThisWorkbook.Worksheets(SH_TX_DLR)
    Set feederWs = ThisWorkbook.Worksheets(SH_MST_FEEDERS)

    Dim feederMap As Object, feeder As Variant
    Set feederMap = CreateObject("Scripting.Dictionary")

    Dim lr As Long, r As Long, feederId As String, kwhVal As Double
    lr = tx.Cells(tx.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lr
        If NzText(tx.Cells(r, 3).Value) = substationId Then
            If Left$(Format$(tx.Cells(r, 2).Value, "yyyy-mm-dd"), 7) = monthKey Then
                feederId = NzText(tx.Cells(r, 5).Value)
                If Len(feederId) > 0 And IsNumeric(tx.Cells(r, 8).Value) Then
                    kwhVal = CDbl(tx.Cells(r, 8).Value)
                    If Not feederMap.Exists(feederId) Then
                        feederMap(feederId) = Array(kwhVal, kwhVal)
                    Else
                        Dim pair As Variant
                        pair = feederMap(feederId)
                        pair(1) = kwhVal
                        feederMap(feederId) = pair
                    End If
                End If
            End If
        End If
    Next r

    Dim outRow As Long: outRow = startRow
    For Each feeder In feederMap.Keys
        Dim p As Variant, units As Double, mf As Double, sentOut As Double
        p = feederMap(feeder)
        units = CDbl(p(1)) - CDbl(p(0))
        mf = GetFeederMF(CStr(feeder), feederWs)
        sentOut = units * mf
        ws.Cells(outRow, 1).Value = ResolveFeederName(CStr(feeder), feederWs)
        ws.Cells(outRow, 2).Value = Round(units, 2)
        ws.Cells(outRow, 3).Value = Round(sentOut, 2)
        ws.Cells(outRow, 4).Value = IIf(units < 0, "Negative", "Normal")
        outRow = outRow + 1
    Next feeder
End Sub

Private Sub FillMonthlyInterruptionRows(ByVal ws As Worksheet, ByVal startRow As Long, ByVal monthKey As String, ByVal substationId As String)
    Dim tx As Worksheet
    Set tx = ThisWorkbook.Worksheets(SH_TX_FAULTS)
    Dim map As Object, k As Variant
    Set map = CreateObject("Scripting.Dictionary")

    Dim lr As Long, r As Long, feederId As String, dur As Double
    lr = tx.Cells(tx.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lr
        If NzText(tx.Cells(r, 3).Value) = substationId Then
            If Left$(Format$(tx.Cells(r, 2).Value, "yyyy-mm-dd"), 7) = monthKey Then
                feederId = NzText(tx.Cells(r, 4).Value)
                dur = CDbl(Val(tx.Cells(r, 8).Value)) / 60#
                If Not map.Exists(feederId) Then
                    map(feederId) = Array(1, dur)
                Else
                    Dim x As Variant
                    x = map(feederId)
                    x(0) = CLng(x(0)) + 1
                    x(1) = CDbl(x(1)) + dur
                    map(feederId) = x
                End If
            End If
        End If
    Next r

    Dim outRow As Long: outRow = startRow
    For Each k In map.Keys
        Dim y As Variant
        y = map(k)
        ws.Cells(outRow, 1).Value = k
        ws.Cells(outRow, 2).Value = y(0)
        ws.Cells(outRow, 3).Value = Round(y(1), 2)
        ws.Cells(outRow, 4).Value = "Fault Register"
        outRow = outRow + 1
    Next k
End Sub

Private Sub FillAttendanceSummaryRows(ByVal ws As Worksheet, ByVal startRow As Long, ByVal monthKey As String, ByVal substationId As String)
    Dim tx As Worksheet
    Set tx = ThisWorkbook.Worksheets(SH_TX_ATT)
    Dim map As Object, key As Variant
    Set map = CreateObject("Scripting.Dictionary")

    Dim lr As Long, r As Long, empId As String, att As String
    lr = tx.Cells(tx.Rows.Count, 1).End(xlUp).Row
    For r = 2 To lr
        If NzText(tx.Cells(r, 2).Value) = monthKey And NzText(tx.Cells(r, 3).Value) = substationId Then
            empId = NzText(tx.Cells(r, 5).Value)
            att = UCase$(NzText(tx.Cells(r, 7).Value))
            If Not map.Exists(empId) Then map(empId) = Array(0, 0, 0) 'P,L,N
            Dim arr As Variant
            arr = map(empId)
            If IsPresentLikeCode(att) Then arr(0) = CLng(arr(0)) + 1
            If att = "CL" Or att = "SL" Or att = "EL" Or att = "A" Then arr(1) = CLng(arr(1)) + 1
            If att = "III" Then arr(2) = CLng(arr(2)) + 1
            map(empId) = arr
        End If
    Next r

    Dim outRow As Long: outRow = startRow
    For Each key In map.Keys
        Dim z As Variant
        z = map(key)
        ws.Cells(outRow, 1).Value = key
        ws.Cells(outRow, 2).Value = z(0)
        ws.Cells(outRow, 3).Value = z(1)
        ws.Cells(outRow, 4).Value = z(2)
        outRow = outRow + 1
    Next key
End Sub

Private Function GetFeederMF(ByVal feederId As String, ByVal ws As Worksheet) As Double
    Dim lr As Long, r As Long
    lr = ws.Cells(ws.Rows.Count, fc_id).End(xlUp).Row
    For r = 2 To lr
        If NzText(ws.Cells(r, fc_id).Value) = feederId Then
            If IsNumeric(ws.Cells(r, fc_mf).Value) Then
                GetFeederMF = CDbl(ws.Cells(r, fc_mf).Value)
                If GetFeederMF <= 0 Then GetFeederMF = 1
                Exit Function
            End If
        End If
    Next r
    GetFeederMF = 1
End Function

Private Function ResolveFeederName(ByVal feederId As String, ByVal ws As Worksheet) As String
    Dim lr As Long, r As Long
    lr = ws.Cells(ws.Rows.Count, fc_id).End(xlUp).Row
    For r = 2 To lr
        If NzText(ws.Cells(r, fc_id).Value) = feederId Then
            ResolveFeederName = NzText(ws.Cells(r, fc_name).Value, feederId)
            Exit Function
        End If
    Next r
    ResolveFeederName = feederId
End Function
