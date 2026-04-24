Attribute VB_Name = "modValidation"
Option Explicit

Public Function RequireText(ByVal v As Variant, ByVal fieldName As String) As Boolean
    RequireText = (Len(Trim$(CStr(v))) > 0)
End Function

Public Function ValidateEventCode(ByVal codeText As String) As Boolean
    Dim code As String
    code = UCase$(Trim$(codeText))
    ValidateEventCode = (code = "LS" Or code = "SD" Or code = "BD" Or code = "EF" Or code = "SF" Or code = "OC")
End Function

Public Function ValidateDLRRequired(ByVal substationId As String, ByVal operationalDate As Variant) As Boolean
    ValidateDLRRequired = (Len(Trim$(substationId)) > 0 And IsDate(operationalDate))
End Function
