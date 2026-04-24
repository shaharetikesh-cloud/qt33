Attribute VB_Name = "modUtils"
Option Explicit

Public Function NzText(ByVal v As Variant, Optional ByVal fallback As String = "") As String
    If IsError(v) Or IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then NzText = fallback Else NzText = Trim$(CStr(v))
End Function

Public Function NextId(ByVal prefix As String) As String
    Randomize
    NextId = prefix & Format$(Now, "yyyymmddhhnnss") & "_" & CStr(Int((9999 - 1000 + 1) * Rnd + 1000))
End Function

Public Sub WithPerformanceStart()
    Application.ScreenUpdating = False
    Application.Calculation = xlCalculationManual
    Application.EnableEvents = False
End Sub

Public Sub WithPerformanceEnd()
    Application.EnableEvents = True
    Application.Calculation = xlCalculationAutomatic
    Application.ScreenUpdating = True
End Sub
