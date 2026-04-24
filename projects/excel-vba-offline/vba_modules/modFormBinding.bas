Attribute VB_Name = "modFormBinding"
Option Explicit

Public Function SafeControlText(ByVal frm As Object, ByVal controlName As String, Optional ByVal fallback As String = "") As String
    On Error GoTo fail
    SafeControlText = Trim$(CStr(frm.Controls(controlName).Value))
    Exit Function
fail:
    SafeControlText = fallback
End Function

Public Function SafeControlNumber(ByVal frm As Object, ByVal controlName As String, Optional ByVal fallback As Double = 0) As Double
    On Error GoTo fail
    If IsNumeric(frm.Controls(controlName).Value) Then
        SafeControlNumber = CDbl(frm.Controls(controlName).Value)
    Else
        SafeControlNumber = fallback
    End If
    Exit Function
fail:
    SafeControlNumber = fallback
End Function

Public Function SafeControlDate(ByVal frm As Object, ByVal controlName As String, Optional ByVal fallback As Date = 0) As Date
    On Error GoTo fail
    If IsDate(frm.Controls(controlName).Value) Then
        SafeControlDate = CDate(frm.Controls(controlName).Value)
    Else
        SafeControlDate = fallback
    End If
    Exit Function
fail:
    SafeControlDate = fallback
End Function
