Attribute VB_Name = "modExportImport"
Option Explicit

Public Sub ExportToCsv()
    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_export_preview")

    Dim filePath As Variant
    filePath = Application.GetSaveAsFilename(InitialFileName:="export.csv", FileFilter:="CSV Files (*.csv), *.csv")
    If VarType(filePath) = vbBoolean Then Exit Sub

    Dim f As Integer
    f = FreeFile
    Open CStr(filePath) For Output As #f

    Dim lastRow As Long, lastCol As Long, r As Long, c As Long
    lastRow = ws.Cells(ws.Rows.Count, 1).End(xlUp).Row
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    For r = 1 To lastRow
        Dim lineText As String
        lineText = ""
        For c = 1 To lastCol
            Dim cellText As String
            cellText = Replace(CStr(ws.Cells(r, c).Value), """", """""")
            If c = 1 Then
                lineText = """" & cellText & """"
            Else
                lineText = lineText & ",""" & cellText & """"
            End If
        Next c
        Print #f, lineText
    Next r
    Close #f
End Sub

Public Sub ImportFromTemplate()
    Dim requiredCols As Variant
    requiredCols = Array("date", "substation_id", "hour", "feeder_id", "kwh")

    Dim ws As Worksheet
    Set ws = ThisWorkbook.Worksheets("sh_export_preview")

    Dim errors As Collection
    Set errors = ValidateHeaderMapping(ws, requiredCols)

    If errors.Count > 0 Then
        WriteImportErrorLog errors
        MsgBox "Import blocked. Check sh_import_errors sheet.", vbExclamation
        Exit Sub
    End If

    MsgBox "Header mapping validated. Ready to import rows.", vbInformation
End Sub

Public Function ValidateHeaderMapping(ByVal ws As Worksheet, ByVal requiredCols As Variant) As Collection
    Dim col As Variant, found As Boolean, c As Long, lastCol As Long
    Dim errors As New Collection
    lastCol = ws.Cells(1, ws.Columns.Count).End(xlToLeft).Column

    For Each col In requiredCols
        found = False
        For c = 1 To lastCol
            If LCase$(Trim$(CStr(ws.Cells(1, c).Value))) = LCase$(CStr(col)) Then
                found = True
                Exit For
            End If
        Next c
        If Not found Then
            errors.Add "Missing required column: " & CStr(col)
        End If
    Next col

    Set ValidateHeaderMapping = errors
End Function

Public Sub WriteImportErrorLog(ByVal errors As Collection)
    Dim ws As Worksheet
    On Error Resume Next
    Set ws = ThisWorkbook.Worksheets("sh_import_errors")
    On Error GoTo 0
    If ws Is Nothing Then
        Set ws = ThisWorkbook.Worksheets.Add
        ws.Name = "sh_import_errors"
    End If

    ws.Cells.Clear
    ws.Range("A1").Value = "Import Error Log"
    ws.Range("A2").Value = "Generated On:"
    ws.Range("B2").Value = Now
    ws.Range("A4").Value = "Error"
    ws.Range("A4").Font.Bold = True

    Dim i As Long
    For i = 1 To errors.Count
        ws.Cells(i + 4, 1).Value = errors(i)
    Next i
    ws.Columns("A:B").AutoFit
End Sub
