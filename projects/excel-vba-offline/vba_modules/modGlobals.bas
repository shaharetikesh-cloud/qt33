Attribute VB_Name = "modGlobals"
Option Explicit

Public Const APP_NAME As String = "MSEDCL Offline Register"
Public Const APP_VERSION As String = "v1.0.0-design"
Public Const SCHEMA_VERSION As String = "1.0.0"

Public Const SH_MST_SUBSTATIONS As String = "mst_substations"
Public Const SH_MST_FEEDERS As String = "mst_feeders"
Public Const SH_MST_BATTERY As String = "mst_battery_sets"
Public Const SH_MST_EMP As String = "mst_employees"
Public Const SH_TX_DLR As String = "tx_dlr"
Public Const SH_TX_FAULTS As String = "tx_faults"
Public Const SH_TX_MAINT As String = "tx_maintenance"
Public Const SH_TX_BATTERY As String = "tx_battery"
Public Const SH_TX_HANDOVER As String = "tx_charge_handover"
Public Const SH_TX_HISTORY As String = "tx_history"
Public Const SH_TX_ATT As String = "tx_attendance"
Public Const SH_TX_SHIFT As String = "tx_shift"

Public Enum FeederCols
    fc_id = 1
    fc_substation = 2
    fc_name = 3
    fc_type = 4
    fc_ctratio = 5
    fc_mf = 6
    fc_parent = 7
    fc_isIncomer = 8
    fc_sortOrder = 9
    fc_active = 10
    fc_includeTotal = 11
End Enum
