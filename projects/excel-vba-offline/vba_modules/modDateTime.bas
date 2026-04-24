Attribute VB_Name = "modDateTime"
Option Explicit

Public Function NormalizeTimeInput(ByVal rawText As String) As String
    Dim t As String
    t = Replace(Trim$(rawText), ":", "")
    If Len(t) = 0 Then Exit Function

    If Not IsNumeric(t) Then Exit Function
    If Len(t) = 3 Then t = "0" & t
    If Len(t) <> 4 Then Exit Function

    Dim hh As Long, mm As Long
    hh = CLng(Left$(t, 2))
    mm = CLng(Right$(t, 2))

    If mm < 0 Or mm > 59 Then Exit Function
    If hh = 24 And mm = 0 Then
        NormalizeTimeInput = "24:00"
        Exit Function
    End If
    If hh < 0 Or hh > 23 Then Exit Function

    NormalizeTimeInput = Format$(hh, "00") & ":" & Format$(mm, "00")
End Function

Public Function DurationMinutes(ByVal fromTime As String, ByVal toTime As String) As Long
    Dim f As String, t As String
    f = NormalizeTimeInput(fromTime)
    t = NormalizeTimeInput(toTime)
    If Len(f) = 0 Or Len(t) = 0 Then DurationMinutes = -1: Exit Function

    Dim fMin As Long, tMin As Long
    fMin = CLng(Left$(f, 2)) * 60 + CLng(Right$(f, 2))
    tMin = CLng(Left$(t, 2)) * 60 + CLng(Right$(t, 2))
    If t = "24:00" Then tMin = 1440

    If tMin < fMin Then DurationMinutes = -1 Else DurationMinutes = tMin - fMin
End Function
