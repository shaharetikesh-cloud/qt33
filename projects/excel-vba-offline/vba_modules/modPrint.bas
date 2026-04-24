Attribute VB_Name = "modPrint"
Option Explicit

Public Sub PrintCurrentReport()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    ApplyStandardReportFormatting ws, 1, 4, 10
    SetupA4Landscape ws
    ws.PrintPreview
End Sub

Public Sub SetupA3Landscape(ByVal ws As Worksheet)
    With ws.PageSetup
        .Orientation = xlLandscape
        .PaperSize = xlPaperA3
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = False
        .CenterHorizontally = True
        .LeftMargin = Application.InchesToPoints(0.3)
        .RightMargin = Application.InchesToPoints(0.3)
        .TopMargin = Application.InchesToPoints(0.4)
        .BottomMargin = Application.InchesToPoints(0.4)
        .PrintTitleRows = "$1:$5"
    End With
End Sub

Public Sub SetupA4Landscape(ByVal ws As Worksheet)
    With ws.PageSetup
        .Orientation = xlLandscape
        .PaperSize = xlPaperA4
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = False
        .CenterHorizontally = True
        .LeftMargin = Application.InchesToPoints(0.3)
        .RightMargin = Application.InchesToPoints(0.3)
        .TopMargin = Application.InchesToPoints(0.4)
        .BottomMargin = Application.InchesToPoints(0.4)
    End With
End Sub

Public Sub SetupA4Portrait(ByVal ws As Worksheet)
    With ws.PageSetup
        .Orientation = xlPortrait
        .PaperSize = xlPaperA4
        .Zoom = False
        .FitToPagesWide = 1
        .FitToPagesTall = False
        .CenterHorizontally = True
        .LeftMargin = Application.InchesToPoints(0.4)
        .RightMargin = Application.InchesToPoints(0.4)
        .TopMargin = Application.InchesToPoints(0.5)
        .BottomMargin = Application.InchesToPoints(0.5)
    End With
End Sub

Public Sub AddSignatureBlock(ByVal ws As Worksheet, ByVal startRow As Long, ByVal leftLabel As String, ByVal rightLabel As String)
    ws.Cells(startRow, 2).Value = "________________________"
    ws.Cells(startRow, 8).Value = "________________________"
    ws.Cells(startRow + 1, 2).Value = leftLabel
    ws.Cells(startRow + 1, 8).Value = rightLabel
End Sub

Public Sub PrintDailyLog()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    SetupA3Landscape ws
    InsertMonthEndPageBreaks ws, 48
    AddSignatureBlock ws, 58, "Operator", "Substation Incharge"
    ws.PrintPreview
End Sub

Public Sub PrintAttendanceSheet()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    SetupA4Landscape ws
    InsertMonthEndPageBreaks ws, 40
    AddSignatureBlock ws, 48, "Assistant Engineer", "Dy. Executive Engineer"
    ws.PrintPreview
End Sub

Public Sub InsertMonthEndPageBreaks(ByVal ws As Worksheet, ByVal sectionHeight As Long)
    On Error Resume Next
    ws.ResetAllPageBreaks
    On Error GoTo 0

    Dim lastRow As Long, startRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow <= sectionHeight Then Exit Sub

    For startRow = sectionHeight + 1 To lastRow Step sectionHeight
        ws.HPageBreaks.Add Before:=ws.Cells(startRow, 1)
    Next startRow
End Sub

Public Sub RenderAndPreviewDailyLog(ByVal reportDate As Date, ByVal substationId As String)
    RenderDailyLogPrint reportDate, substationId
    PrintDailyLog
End Sub

Public Sub RenderAndPreviewAttendance(ByVal monthKey As String, ByVal substationId As String, ByVal moduleType As String)
    RenderAttendanceMonthlyPrint monthKey, substationId, moduleType
    PrintAttendanceSheet
End Sub

Public Sub RenderAndPreviewBattery(ByVal reportDate As Date, ByVal substationId As String, ByVal batterySetId As String)
    RenderBatteryWeeklyPrint reportDate, substationId, batterySetId
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    SetupA4Portrait ws
    AddSignatureBlock ws, 45, "Operator", "Substation Incharge"
    ws.PrintPreview
End Sub

Public Sub RenderAndPreviewBatteryTwoPerPage(ByVal reportDate1 As Date, ByVal reportDate2 As Date, ByVal substationId As String, ByVal batterySetId As String)
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_reports_print")
    ws.Cells.Clear

    RenderBatteryWeeklyPrint reportDate1, substationId, batterySetId
    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row + 2
    ws.Cells(lastRow, 1).Value = "-------------------- SECOND REPORT --------------------"

    ' Append second report block
    ws.Cells(lastRow + 1, 1).Value = "WEEKLY BATTERY MAINTENANCE"
    ws.Cells(lastRow + 2, 1).Value = "Date:"
    ws.Cells(lastRow + 2, 2).Value = reportDate2
    ws.Cells(lastRow + 2, 4).Value = "Substation:"
    ws.Cells(lastRow + 2, 5).Value = substationId
    ws.Cells(lastRow + 2, 7).Value = "Battery Set:"
    ws.Cells(lastRow + 2, 8).Value = batterySetId

    SetupA4Portrait ws
    InsertMonthEndPageBreaks ws, 70
    AddSignatureBlock ws, lastRow + 35, "Operator", "Substation Incharge"
    ws.PrintPreview
End Sub

Public Sub RenderAndPreviewMonthEndPack()
    BuildMonthEndPack
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_month_end_pack")
    ApplyStandardReportFormatting ws, 1, 5, 8
    SetupA4Landscape ws
    InsertMonthEndPageBreaks ws, 16
    ws.PrintPreview
End Sub

Public Sub ApplyStandardReportFormatting(ByVal ws As Worksheet, ByVal titleRow As Long, ByVal headerRow As Long, ByVal maxCol As Long)
    ws.Cells.Font.Name = "Calibri"
    ws.Cells.Font.Size = 10
    ws.Rows(titleRow).Font.Bold = True
    ws.Rows(titleRow).Font.Size = 14
    ws.Rows(headerRow).Font.Bold = True
    ws.Range(ws.Cells(headerRow, 1), ws.Cells(headerRow, maxCol)).Interior.Color = RGB(242, 242, 242)

    Dim lastRow As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    If lastRow < headerRow Then lastRow = headerRow
    ws.Range(ws.Cells(headerRow, 1), ws.Cells(lastRow, maxCol)).Borders.LineStyle = xlContinuous
    Dim c As Long
    For c = 1 To maxCol
        ws.Columns(c).AutoFit
    Next c
End Sub
