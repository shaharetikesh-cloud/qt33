# Phase-3 Sheet Column Mappings

## `tx_dlr`
1. `dlr_id`
2. `date`
3. `substation_id`
4. `hour`
5. `feeder_id`
6. `amp`
7. `kv`
8. `kwh`
9. `event_code`
10. `entry_mode`
11. `source_type`
12. `remark`

## `tx_faults`
1. `fault_id`
2. `date`
3. `substation_id`
4. `feeder_id`
5. `event_type`
6. `from_time`
7. `to_time`
8. `duration_min`
9. `source`
10. `remark`

## `mst_feeders`
1. `feeder_id`
2. `substation_id`
3. `name`
4. `feeder_type`
5. `ct_ratio`
6. `mf`
7. `parent_feeder_id`
8. `is_incomer`
9. `sort_order`
10. `is_active`
11. `include_in_total`

## `tx_shift`
1. `shift_id`
2. `month_key`
3. `substation_id`
4. `employee_id`
5. `day_no`
6. `shift_code`
7. `auto_flag`
8. `override_flag`

## `tx_attendance`
1. `att_id`
2. `month_key`
3. `substation_id`
4. `module_type`
5. `employee_id`
6. `day_no`
7. `att_code`
8. `remark`
