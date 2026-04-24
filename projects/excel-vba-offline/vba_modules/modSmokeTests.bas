Attribute VB_Name = "modSmokeTests"
Option Explicit

Public Sub RunDailyLogFlow()
    SaveDailyLog
    FinalizeDailyLog
    RenderAndPreviewDailyLog Date, NzText(ThisWorkbook.Worksheets("sh_admin_tools").Range("B3").Value, "SS001")
End Sub

Public Sub RunAttendanceFlow()
    GenerateOperatorRotation
    RenderAndPreviewAttendance Format$(Date, "yyyy-mm"), NzText(ThisWorkbook.Worksheets("sh_admin_tools").Range("B3").Value, "SS001"), "operator"
End Sub

Public Sub RunMonthEndFlow()
    RenderAndPreviewMonthEndPack
End Sub

Public Sub RunAllSmokeFlows()
    WithPerformanceStart
    On Error GoTo cleanup

    RunDailyLogFlow
    RunAttendanceFlow
    RunMonthEndFlow

cleanup:
    WithPerformanceEnd
End Sub

Public Sub RunOperatorDayClose()
    WithPerformanceStart
    On Error GoTo cleanup

    ' 1) Save a DLR row (from staging values)
    SaveDailyLog
    ' 2) Finalize day (auto LS for trailing gaps)
    FinalizeDailyLog
    ' 3) Generate attendance rotation and preview
    GenerateOperatorRotation
    RenderAndPreviewAttendance Format$(Date, "yyyy-mm"), NzText(ThisWorkbook.Worksheets("sh_admin_tools").Range("B3").Value, "SS001"), "operator"
    ' 4) Render month-end pack preview
    RenderAndPreviewMonthEndPack

cleanup:
    WithPerformanceEnd
End Sub
