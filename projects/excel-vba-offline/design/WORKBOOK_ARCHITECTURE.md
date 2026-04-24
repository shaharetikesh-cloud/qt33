# 3) Workbook Architecture

## Workbook plan
- File name: `MSEDCL_Offline_Register_v1.xlsm`
- Startup object: `frmDashboard`
- Raw sheet editing minimized; forms-first operation.

## 4) Sheet Structure

Visible sheets:
- `sh_dashboard`
- `sh_reports_print`
- `sh_month_end_pack`
- `sh_export_preview`
- `sh_admin_tools`

Hidden sheets (very hidden):
- `mst_substations`
- `mst_feeders`
- `mst_battery_sets`
- `mst_employees`
- `mst_settings`
- `tx_dlr`
- `tx_faults`
- `tx_maintenance`
- `tx_battery`
- `tx_charge_handover`
- `tx_history`
- `tx_attendance`
- `tx_shift`
- `tx_reports_cache`

## 5) Hidden table schema (key columns)

- `mst_substations`: `substation_id,name,division,subdivision,is_active`
- `mst_feeders`: `feeder_id,substation_id,name,feeder_type,ct_ratio,mf,parent_feeder_id,is_incomer,sort_order,is_active,include_in_total`
- `mst_battery_sets`: `battery_set_id,substation_id,name,cell_count,nominal_voltage,is_active`
- `mst_employees`: `employee_id,name,designation,employee_type,cpf_no,substation_id,weekly_off,general_duty_flag,vacancy_flag,is_active`
- `mst_settings`: `setting_key,setting_value,category`
- `tx_dlr`: `dlr_id,date,substation_id,hour,feeder_id,amp,kv,kwh,event_code,entry_mode,source_type,remark`
- `tx_faults`: `fault_id,date,substation_id,feeder_id,event_type,from_time,to_time,duration_min,source,remark`
- `tx_maintenance`: `maint_id,date,substation_id,equipment,feeder_bay,maint_type,description,action_taken,staff,status,remark`
- `tx_battery`: `battery_tx_id,date,substation_id,battery_set_id,row_no,cell_no,sp_gravity,voltage,condition,check_flags,remark`
- `tx_charge_handover`: `handover_id,date,substation_id,shift,outgoing,incoming,pending_items,notes,ack`
- `tx_history`: `hist_id,date,substation_id,asset_type,equipment_name,make,serial_no,capacity_spec,feeder_bay,install_date,replacement_date,repair_date,location,change_history,remark`
- `tx_attendance`: `att_id,month_key,substation_id,module_type,employee_id,day_no,att_code,remark`
- `tx_shift`: `shift_id,month_key,substation_id,employee_id,day_no,shift_code,auto_flag,override_flag`
- `tx_reports_cache`: `cache_id,report_name,period_key,payload_json,generated_at`

## 6) UserForms design

- `frmDashboard`: module shortcuts, pending alerts, month quick actions
- Master forms: `frmSubstationMaster`, `frmFeederMaster`, `frmBatterySetMaster`, `frmEmployeeMaster`, `frmSettings`
- DLR forms: `frmDailyLog`, `frmFaultRegister`, `frmMaintenanceRegister`, `frmBatteryMaintenance`, `frmChargeHandover`, `frmHistoryRegister`
- Attendance forms: `frmOperatorAttendance`, `frmAdvanceShift`, `frmTechAttendance`, `frmOutsourceAttendance`, `frmApprenticeAttendance`, `frmOtherAttendance`
- Reporting form: `frmReports`

UI pattern:
- Header filter panel (date/substation/month)
- Entry grid/list
- Action row: `New`, `Save`, `Validate`, `Print`, `Export`, `Close`
