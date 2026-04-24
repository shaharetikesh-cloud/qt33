Attribute VB_Name = "modAttendance"
Option Explicit

Private ROTATION_REGULAR() As String
Private ROTATION_GD() As String

Private Sub InitRotation()
    If (Not Not ROTATION_REGULAR) = 0 Then
        ROTATION_REGULAR = Split("OFF,II,III,I", ",")
        ROTATION_GD = Split("OFF,II,III,I,G,G,G", ",")
    End If
End Sub

Public Sub GenerateOperatorRotation()
    InitRotation

    ' Expected input range layout:
    ' Col A: EmployeeId, Col B: DayNo(1..31), Col C: IsGeneralDuty(TRUE/FALSE), Col D: ManualOverride
    ' Output in Col E: ShiftCode
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("tx_shift")

    Dim lastRow As Long, r As Long
    lastRow = ws.Cells(ws.Rows.Count, "A").End(xlUp).Row

    For r = 2 To lastRow
        Dim dayNo As Long, isGD As Boolean, manualCode As String
        dayNo = CLng(Val(ws.Cells(r, "B").Value))
        isGD = CBool(ws.Cells(r, "C").Value)
        manualCode = UCase$(Trim$(CStr(ws.Cells(r, "D").Value)))

        If Len(manualCode) > 0 Then
            ws.Cells(r, "E").Value = manualCode
        Else
            ws.Cells(r, "E").Value = GetOperatorShiftCode(dayNo, isGD)
        End If
    Next r
End Sub

Public Function GetOperatorShiftCode(ByVal dayNo As Long, ByVal isGeneralDuty As Boolean) As String
    InitRotation

    If dayNo < 1 Then
        GetOperatorShiftCode = ""
        Exit Function
    End If

    Dim idx As Long
    If isGeneralDuty Then
        idx = (dayNo - 1) Mod (UBound(ROTATION_GD) + 1)
        GetOperatorShiftCode = ROTATION_GD(idx)
    Else
        idx = (dayNo - 1) Mod (UBound(ROTATION_REGULAR) + 1)
        GetOperatorShiftCode = ROTATION_REGULAR(idx)
    End If
End Function

Public Function CalculateNightAllowance(ByVal iiiCount As Long, ByVal ratePerNight As Double) As Double
    CalculateNightAllowance = CDbl(iiiCount) * CDbl(ratePerNight)
End Function

Public Function IsPresentLikeCode(ByVal attCode As String) As Boolean
    Dim c As String
    c = UCase$(Trim$(attCode))
    IsPresentLikeCode = (c = "P" Or c = "OD" Or c = "-" Or c = "I" Or c = "II" Or c = "III" Or c = "G")
End Function
