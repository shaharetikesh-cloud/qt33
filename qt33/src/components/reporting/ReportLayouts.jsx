import { formatDate } from '../../lib/dateUtils'
import {
  formatInteger,
  formatNumber,
} from '../../lib/reportFormats'
import {
  MetadataGrid,
  PageBreak,
  ReportDocument,
  ReportFooter,
  ReportHeader,
  MsedclReportHeader,
  ReportTable,
  SectionTitle,
  SignatureBlock,
  SummaryCards,
  TagList,
} from './ReportPrimitives'

function renderRemarkBlock(label, value) {
  return (
    <section className="report-text-block">
      <SectionTitle>{label}</SectionTitle>
      <div className="report-handwriting-block">{value || '-'}</div>
    </section>
  )
}

function inferColumnType(key, value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number'
  }

  if (String(key).toLowerCase().includes('date')) {
    return 'date'
  }

  return 'text'
}

function formatReportValue(value, type) {
  if (value === '' || value === null || value === undefined) {
    return '-'
  }

  if (type === 'date') {
    return formatDate(value)
  }

  if (type === 'percent') {
    return `${formatNumber(value)}%`
  }

  if (type === 'integer') {
    return formatInteger(value)
  }

  if (type === 'number') {
    return formatNumber(value)
  }

  return value
}

function getReportTableColumns(table) {
  if (table.columns?.length) {
    return table.columns.map((column) => ({
      ...column,
      render: (row) =>
        column.render
          ? column.render(row)
          : formatReportValue(row[column.key], column.type || 'text'),
    }))
  }

  return Object.keys(table.rows?.[0] || {}).map((key) => {
    const sampleValue = table.rows?.find((row) => row[key] !== null && row[key] !== undefined)?.[key]

    return {
      key,
      label: key
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (value) => value.toUpperCase()),
      render: (row) => formatReportValue(row[key], inferColumnType(key, sampleValue)),
    }
  })
}

function ReportTableGroup({ tables = [], fallbackRows = [] }) {
  const resolvedTables = tables.length ? tables : [{ rows: fallbackRows }]

  return (
    <>
      {resolvedTables.map((table, index) => (
        <section key={table.title || `table-${index}`} className="report-table-group">
          {table.title ? <SectionTitle>{table.title}</SectionTitle> : null}
          <ReportTable
            columns={getReportTableColumns(table)}
            rows={table.rows || []}
            footRows={table.footRows || []}
            className={table.className || 'report-table-compact'}
            chunkSize={table.chunkSize || 22}
          />
        </section>
      ))}
    </>
  )
}

function buildAttendanceOfficeHeaderRows(days = []) {
  return [
    [
      { key: 'sr', label: 'Sr. No.', rowSpan: 2, className: 'attendance-office-col-sr' },
      { key: 'name', label: 'Employee Name', rowSpan: 2, className: 'attendance-office-col-name' },
      { key: 'desig', label: 'Desig', rowSpan: 2, className: 'attendance-office-col-desig' },
      ...days.map((day) => ({
        key: `weekday-${day.isoDate}`,
        label: <span className="attendance-report-weekday">{day.dayLabel}</span>,
        className: 'attendance-office-col-day attendance-office-col-day-weekday',
      })),
    ],
    days.map((day) => ({
      key: `date-${day.isoDate}`,
      label: day.dayNumber,
      className: 'attendance-office-col-day attendance-office-col-day-date',
    })),
  ]
}

function getAttendanceOfficeColumns(days = [], valueKey = 'attendanceCodes') {
  return [
    { key: 'srNo', label: 'Sr. No.', align: 'center' },
    {
      key: 'employeeName',
      label: 'Employee Name',
      render: (row) => (
        <div className="attendance-office-name-cell">
          <div className="attendance-office-name">{row.displayName}</div>
          {row.cpfLine ? <div className="attendance-office-cpf">{row.cpfLine}</div> : null}
        </div>
      ),
    },
    { key: 'designationShort', label: 'Desig', align: 'center' },
    ...days.map((day, index) => ({
      key: day.isoDate,
      label: day.dayNumber,
      align: 'center',
      render: (row) => row[valueKey]?.[index] || '-',
    })),
  ]
}

function AttendanceOfficeTable({
  title,
  rows,
  days,
  valueKey = 'attendanceCodes',
  chunkSize = 14,
}) {
  return (
    <section className="attendance-office-section">
      {title ? <div className="attendance-office-section-title">{title}</div> : null}
      <ReportTable
        columns={getAttendanceOfficeColumns(days, valueKey)}
        rows={rows}
        headerRows={buildAttendanceOfficeHeaderRows(days)}
        className="attendance-office-report-table"
        chunkSize={chunkSize}
      />
    </section>
  )
}

function AttendanceNoteBox({
  certificateText,
  reportRemarkLines = [],
  single = false,
}) {
  return (
    <section className={`attendance-note-layout${single ? ' attendance-note-layout-single' : ''}`}>
      <div className="attendance-note-box">
        <div className="attendance-note-line">
          <strong>Certificate :</strong>
          <span>{certificateText || '-'}</span>
        </div>
        <div className="attendance-note-line attendance-note-line-remark">
          <strong>Remark :</strong>
          <span>
            {reportRemarkLines.length
              ? reportRemarkLines.map((line, index) => (
                  <span key={`${line}-${index}`} className="attendance-remark-line">
                    {line}
                  </span>
                ))
              : '-'}
          </span>
        </div>
      </div>
    </section>
  )
}

function AttendanceSignatureRow({ items = [] }) {
  if (!items.length) {
    return null
  }

  return (
    <section className="attendance-signature-row">
      {items.map((item) => (
        <div key={item.label} className="attendance-signature-block">
          <div className="attendance-signature-line" />
          <div className="attendance-signature-label">{item.label}</div>
        </div>
      ))}
    </section>
  )
}

export function AttendanceMonthlyReportView({
  documentRef,
  report,
  footerText,
}) {
  const operatorSheet = report.sheetType === 'operator'
  const advanceShiftSheet = report.sheetType === 'advance_shift'
  const singleTableSheet = !operatorSheet && !advanceShiftSheet

  return (
    <ReportDocument
      documentRef={documentRef}
      orientation={report.orientation}
      reportType="attendance-office"
      title={report.title}
    >
      <MsedclReportHeader
        substationObj={report.substationObj}
        title={report.title}
        monthLabel={report.monthLabel}
      />
      {operatorSheet ? (
        <>
          <AttendanceOfficeTable
            rows={report.rows}
            days={report.days}
            valueKey="attendanceCodes"
            chunkSize={12}
          />
          <AttendanceOfficeTable
            title={`SHIFTCHART FOR THE MONTH OF ${report.monthLabel}`}
            rows={report.rows}
            days={report.days}
            valueKey="shiftCodes"
            chunkSize={12}
          />
          <section className="attendance-operator-footer">
            <div className="attendance-allowance-panel">
              <div className="attendance-operator-footer-title">Night Shift Allowance</div>
              <ReportTable
                columns={[
                  { key: 'serialNo', label: 'Sr.No.', align: 'center' },
                  {
                    key: 'displayName',
                    label: 'Employee Name',
                    render: (row) => (
                      <div className="attendance-allowance-name">
                        <div>{row.displayName}</div>
                        {row.cpfLine ? <span>{row.cpfLine}</span> : null}
                      </div>
                    ),
                  },
                  { key: 'nightCount', label: 'Night', align: 'center' },
                  {
                    key: 'rate',
                    label: 'Rate',
                    align: 'right',
                    render: (row) => formatNumber(row.rate),
                  },
                  {
                    key: 'amount',
                    label: 'Amt',
                    align: 'right',
                    render: (row) => formatNumber(row.amount),
                  },
                ]}
                rows={report.nightAllowanceRows || []}
                className="attendance-allowance-table"
                chunkSize={0}
              />
            </div>
            <AttendanceNoteBox
              certificateText={report.certificateText}
              reportRemarkLines={report.reportRemarkLines}
            />
          </section>
        </>
      ) : advanceShiftSheet ? (
        <>
          <AttendanceOfficeTable
            rows={report.rows}
            days={report.days}
            valueKey="shiftCodes"
            chunkSize={12}
          />
          <AttendanceNoteBox
            certificateText={report.certificateText}
            reportRemarkLines={report.reportRemarkLines}
            single
          />
        </>
      ) : (
        <>
          <AttendanceOfficeTable
            rows={report.rows}
            days={report.days}
            valueKey="attendanceCodes"
            chunkSize={14}
          />
          <AttendanceNoteBox
            certificateText={report.certificateText}
            reportRemarkLines={report.reportRemarkLines}
            single={singleTableSheet}
          />
        </>
      )}
      <AttendanceSignatureRow items={report.signatureItems} />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function NightAllowanceReportView({
  documentRef,
  report,
  footerText,
}) {
  const columns = [
    { key: 'srNo', label: 'SR', align: 'center' },
    {
      key: 'employeeName',
      label: 'Employee / CPF',
      render: (row) => (
        <div className="employee-print-cell">
          <strong>{row.employeeName}</strong>
          {row.cpfLine ? <span>{row.cpfLine}</span> : null}
        </div>
      ),
    },
    { key: 'nightShifts', label: 'Night Shifts', align: 'center' },
    {
      key: 'rate',
      label: 'Rate',
      align: 'right',
      render: (row) => formatNumber(row.rate),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (row) => formatNumber(row.amount),
    },
  ]

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="night-allowance" title={report.title}>
      <MsedclReportHeader
        substationObj={report.substationObj}
        title={report.title}
        monthLabel={report.monthLabel}
      />
      <SummaryCards
        items={[
          { label: 'Total Night Shifts', value: formatInteger(report.totals.totalNightShifts) },
          { label: 'Total Amount', value: formatNumber(report.totals.totalAmount) },
        ]}
      />
      <ReportTable columns={columns} rows={report.rows} chunkSize={22} />
      <SignatureBlock items={[{ label: 'Prepared By' }, { label: 'In Charge' }]} />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function AttendanceSummaryReportView({
  documentRef,
  report,
  footerText,
}) {
  const columns = [
    { key: 'sheetType', label: 'Sheet Type' },
    { key: 'employees', label: 'Employees', align: 'center' },
    { key: 'present', label: 'Present', align: 'center' },
    { key: 'leave', label: 'Leave', align: 'center' },
    { key: 'weeklyOff', label: 'Weekly Off', align: 'center' },
    { key: 'night', label: 'Night', align: 'center' },
    { key: 'absent', label: 'Absent', align: 'center' },
  ]

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="attendance-summary" title={report.title}>
      <MsedclReportHeader
        substationObj={report.substationObj}
        title={report.title}
        monthLabel={report.monthLabel}
      />
      <ReportTable columns={columns} rows={report.rows} chunkSize={18} />
      <SignatureBlock items={[{ label: 'Prepared By' }, { label: 'Approved By' }]} />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function DailyLogReportView({
  documentRef,
  report,
  footerText,
}) {
  const interruptionColumns = [
    { key: 'srNo', label: 'SR', align: 'center' },
    { key: 'feederName', label: 'Feeder' },
    { key: 'scopeType', label: 'Scope', render: (row) => String(row.scopeType || '').replaceAll('_', ' ') || '-' },
    { key: 'fromTime', label: 'From' },
    { key: 'toTime', label: 'To' },
    { key: 'durationLabel', label: 'Duration' },
    { key: 'eventType', label: 'Type', align: 'center' },
    { key: 'source', label: 'Source', align: 'center' },
    { key: 'remark', label: 'Remark' },
  ]
  const meterChangeColumns = [
    { key: 'srNo', label: 'SR', align: 'center' },
    { key: 'feederName', label: 'Feeder' },
    { key: 'effectiveTime', label: 'Effective Time' },
    { key: 'oldMeterLastReading', label: 'Old Last', align: 'right' },
    { key: 'newMeterStartReading', label: 'New Start', align: 'right' },
    { key: 'remark', label: 'Remark' },
  ]
  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="daily-log" title={report.title}>
      <ReportHeader companyName={report.companyName} title={report.title} subtitle="Daily substation operational sheet" />
      <MetadataGrid items={report.metadata} />
      <section className="daily-log-report-shell">
        <table className="report-table daily-log-report-table">
          <thead>
            <tr>
              <th rowSpan={3}>Hrs</th>
              <th rowSpan={3}>{report.totalColumnLabel || 'Total Amp'}</th>
              {report.headerGroups.map((group) => (
                <th
                  key={group.key}
                  colSpan={group.items.reduce((total, item) => total + item.metrics.length, 0)}
                >
                  {group.label}
                </th>
              ))}
              <th rowSpan={3}>Remark</th>
            </tr>
            <tr>
              {report.headerGroups.map((group) =>
                group.items.map((item) => (
                  <th key={`${group.key}-${item.kind}-${item.id}`} colSpan={item.metrics.length}>
                    {item.label}
                  </th>
                )),
              )}
            </tr>
            <tr>
              {report.headerGroups.map((group) =>
                group.items.map((item) =>
                  item.metrics.map((metric) => (
                    <th key={`${group.key}-${item.kind}-${item.id}-${metric}`}>
                      {metric === 'amp'
                        ? 'Amp'
                        : metric === 'kv'
                          ? 'KV'
                          : metric === 'kwh'
                            ? 'KWH'
                            : metric === 'tap'
                              ? 'Tap'
                              : metric === 'temperature'
                                ? 'Temp'
                                : 'Voltage'}
                    </th>
                  )),
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {report.tableRows.map((row) => (
              <tr key={row.id}>
                <td className="align-center">{row.hour}</td>
                <td className="align-right report-total-auto-cell">
                  {formatNumber(row.totalLoad)}
                </td>
                {Object.values(row.cells).map((cell, index) => (
                  <td
                    key={`${row.id}-${index}`}
                    className={[
                      cell.isAutoCalculated ? 'report-incomer-auto-cell' : '',
                      cell.overlayCode ? `daily-log-event-cell daily-log-event-${cell.overlaySource}` : '',
                      cell.sourceType === 'auto_gap_fill' ? 'daily-log-report-auto-fill' : '',
                      cell.isPending ? 'daily-log-report-pending' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell.overlayCode || cell.pendingCode || cell.value || '-'}
                  </td>
                ))}
                <td>{row.remark || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <SectionTitle>Interruption Register</SectionTitle>
      <ReportTable
        columns={interruptionColumns}
        rows={report.interruptionRows}
        className="report-table-compact"
        chunkSize={18}
      />
      <SectionTitle>Meter Change Register</SectionTitle>
      <ReportTable
        columns={meterChangeColumns}
        rows={report.meterChangeRows}
        className="report-table-compact"
        chunkSize={18}
      />
      {report.notes?.length ? (
        <section className="report-notes">
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </section>
      ) : null}
      <SignatureBlock
        items={[
          { label: 'Operator', value: report.signatures.operator },
          { label: 'In Charge', value: report.signatures.inCharge },
        ]}
      />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function DailyLogAnalyticsReportView({
  documentRef,
  report,
  footerText,
}) {
  const interruptionColumns = [
    { key: 'srNo', label: 'Sr.No', align: 'center', width: '42px' },
    { key: 'feederName', label: 'Feeder Name', width: '150px' },
    ...report.interruptionFaultTypes.flatMap((faultType) => [
      {
        key: `${faultType.toLowerCase()}No`,
        label: `${faultType} No`,
        align: 'center',
        render: (row) => formatInteger(row.summaryMap[faultType].count),
      },
      {
        key: `${faultType.toLowerCase()}Time`,
        label: `${faultType} Time`,
        align: 'center',
        render: (row) => formatNumber(row.summaryMap[faultType].hours),
      },
    ]),
    {
      key: 'totalCount',
      label: 'Total No',
      align: 'center',
      render: (row) => formatInteger(row.totalCount),
    },
    {
      key: 'totalHours',
      label: 'Total Time',
      align: 'center',
      render: (row) => formatNumber(row.totalHours),
    },
  ]

  const interruptionHeaderRows = [
    [
      { key: 'srNo-group', label: 'Sr.No', rowSpan: 2, align: 'center' },
      { key: 'feeder-group', label: 'Feeder Name', rowSpan: 2 },
      ...report.interruptionFaultTypes.map((faultType) => ({
        key: `${faultType}-group`,
        label: faultType,
        colSpan: 2,
        align: 'center',
      })),
      { key: 'total-group', label: 'Total', colSpan: 2, align: 'center' },
    ],
    [
      ...report.interruptionFaultTypes.flatMap((faultType) => [
        { key: `${faultType}-no`, label: 'No', align: 'center' },
        { key: `${faultType}-time`, label: 'Time', align: 'center' },
      ]),
      { key: 'total-no', label: 'No', align: 'center' },
      { key: 'total-time', label: 'Time', align: 'center' },
    ],
  ]

  const unitColumns = [
    { key: 'srNo', label: 'Sr.No', align: 'center', width: '42px' },
    { key: 'feederName', label: 'Feeder Name', width: '150px' },
    {
      key: 'openingUnit',
      label: 'Opening Unit',
      align: 'center',
      render: (row) => (row.openingUnit === null ? '-' : formatNumber(row.openingUnit)),
    },
    {
      key: 'closingUnit',
      label: 'Closing Unit',
      align: 'center',
      render: (row) => (row.closingUnit === null ? '-' : formatNumber(row.closingUnit)),
    },
    {
      key: 'diffUnit',
      label: 'Diff Unit',
      align: 'center',
      render: (row) => (row.diffUnit === null ? '-' : formatNumber(row.diffUnit)),
    },
    {
      key: 'mf',
      label: 'MF',
      align: 'center',
      render: (row) => formatNumber(row.mf),
    },
    {
      key: 'consumption',
      label: 'Consumption',
      align: 'center',
      render: (row) => formatNumber(row.consumption),
    },
    {
      key: 'expectedUnit',
      label: 'Expected Unit',
      align: 'center',
      render: (row) => (row.expectedUnit === null ? '-' : formatNumber(row.expectedUnit)),
    },
    {
      key: 'difference',
      label: 'Difference',
      align: 'center',
      render: (row) => (row.difference === null ? '-' : formatNumber(row.difference)),
    },
    {
      key: 'lossProfit',
      label: 'Loss / Profit',
      align: 'center',
    },
    {
      key: 'percentageLabel',
      label: 'Percentage',
      align: 'center',
    },
  ]

  const loadColumns = [
    { key: 'srNo', label: 'Sr.No', align: 'center', width: '42px' },
    { key: 'feederName', label: 'Feeder Name', width: '150px' },
    {
      key: 'maxLoad',
      label: 'Max Load',
      align: 'center',
      render: (row) => formatNumber(row.maxLoad),
    },
    {
      key: 'maxLoadTime',
      label: 'Time',
      align: 'center',
    },
    {
      key: 'minLoad',
      label: 'Min Load',
      align: 'center',
      render: (row) => formatNumber(row.minLoad),
    },
    {
      key: 'minLoadTime',
      label: 'Time',
      align: 'center',
    },
  ]

  return (
    <ReportDocument
      documentRef={documentRef}
      orientation={report.orientation}
      reportType="daily-analytics"
      title={report.title}
    >
      <ReportHeader
        companyName={report.companyName}
        title={report.title}
        subtitle="Interruption, consumption, and load analysis"
      />
      <MetadataGrid items={report.metadata} />
      <SectionTitle>Section 1: Interruption Table</SectionTitle>
      <ReportTable
        columns={interruptionColumns}
        rows={report.interruptionRows}
        footRows={report.interruptionFootRows || []}
        headerRows={interruptionHeaderRows}
        className="report-table-compact report-grouped-table"
        chunkSize={16}
      />
      <SectionTitle>Section 2: Units / Consumption / Loss-Profit Table</SectionTitle>
      <ReportTable
        columns={unitColumns}
        rows={report.unitRows}
        className="report-table-compact"
        chunkSize={16}
      />
      <SectionTitle>Section 3: Load Table</SectionTitle>
      <ReportTable
        columns={loadColumns}
        rows={report.loadRows}
        className="report-table-compact"
        chunkSize={18}
      />
      {report.notes?.length ? (
        <section className="report-notes">
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </section>
      ) : null}
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function BatteryReportView({
  documentRef,
  report,
  footerText,
}) {
  const columns = [
    { key: 'srNo', label: 'Sr No', align: 'center', render: (row, index) => index + 1 },
    { key: 'specificGravity', label: 'Per Cell S.P. Gravity', align: 'right', render: (row) => formatNumber(row.specificGravity) },
    { key: 'voltage', label: 'Per Cell Voltage', align: 'right', render: (row) => formatNumber(row.voltage) },
    { key: 'condition', label: 'Cell Condition' },
  ]

  const summaryRows = [
    {
      parameter: 'S.P. Gravity',
      maximum: formatNumber(report.analysis.gravityMax),
      minimum: formatNumber(report.analysis.gravityMin),
      condition: report.analysis.gravityMin >= 1.18 ? 'Within range' : 'Needs attention',
    },
    {
      parameter: 'Voltage',
      maximum: formatNumber(report.analysis.voltageMax),
      minimum: formatNumber(report.analysis.voltageMin),
      condition: report.analysis.voltageMin >= 1.95 ? 'Within range' : 'Needs attention',
    },
  ]

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="battery" title={report.title}>
      <ReportHeader companyName={report.companyName} title={report.title} />
      <MetadataGrid items={report.metadata} />
      <section className="battery-report-grid">
        <div>
          <ReportTable columns={columns} rows={report.cells} chunkSize={24} />
          <div className="battery-total-bar">
            <span>Total Voltage</span>
            <strong>{formatNumber(report.analysis.totalVoltage)}</strong>
          </div>
        </div>
        <div className="battery-side-panel">
          <SectionTitle>Weekly Maintenance Checklist</SectionTitle>
          <div className="checklist-stack">
            {Object.entries(report.checklist).map(([label, value]) => (
              <div key={label} className="checklist-row">
                <span>{label}</span>
                <strong>{value ? 'Yes' : 'No'}</strong>
              </div>
            ))}
          </div>
          {renderRemarkBlock('Generated Remark', report.analysis.remark)}
          <SectionTitle>Battery Summary</SectionTitle>
          <ReportTable
            columns={[
              { key: 'parameter', label: 'Battery Parameter' },
              { key: 'maximum', label: 'Maximum', align: 'right' },
              { key: 'minimum', label: 'Minimum', align: 'right' },
              { key: 'condition', label: 'Condition' },
            ]}
            rows={summaryRows}
            className="report-table-compact"
          />
          <div className="battery-total-bar">
            <span>Overall Battery Condition</span>
            <strong>{report.analysis.overallCondition}</strong>
          </div>
        </div>
      </section>
      <SignatureBlock
        items={[
          { label: 'Operator', value: report.signatures.operator },
          { label: 'In Charge', value: report.signatures.inCharge },
        ]}
      />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function FaultReportView({
  documentRef,
  report,
  footerText,
}) {
  const columns = [
    { key: 'srNo', label: 'SR', align: 'center' },
    { key: 'operationalDate', label: 'Date', render: (row) => formatDate(row.operationalDate) },
    { key: 'fromTime', label: 'From Time', align: 'center' },
    { key: 'toTime', label: 'To Time', align: 'center' },
    { key: 'durationLabel', label: 'Duration', align: 'center' },
    { key: 'feederName', label: 'Feeder' },
    { key: 'faultType', label: 'Fault Type' },
    { key: 'cause', label: 'Cause' },
    { key: 'remark', label: 'Remark' },
  ]

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="fault" title={report.title}>
      <ReportHeader companyName={report.metadata[0]?.[1]} title={report.title} />
      <MetadataGrid items={report.metadata} />
      <ReportTable columns={columns} rows={report.rows} className="report-table-compact" chunkSize={24} />
      <SignatureBlock items={[{ label: 'Operator' }, { label: 'Section In Charge' }]} />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function MaintenanceReportView({
  documentRef,
  report,
  footerText,
}) {
  const columns = [
    { key: 'srNo', label: 'SR', align: 'center' },
    { key: 'date', label: 'Date', render: (row) => formatDate(row.date) },
    { key: 'substationName', label: 'Substation' },
    { key: 'fromTime', label: 'From Time', align: 'center' },
    { key: 'toTime', label: 'To Time', align: 'center' },
    { key: 'durationLabel', label: 'Duration', align: 'center' },
    { key: 'workDetail', label: 'Work Detail' },
    { key: 'remark', label: 'Remark' },
  ]

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="maintenance" title={report.title}>
      <ReportHeader companyName={report.metadata[0]?.[1]} title={report.title} subtitle="Maintenance Register" />
      <MetadataGrid items={report.metadata} />
      <ReportTable columns={columns} rows={report.rows} className="report-table-compact" chunkSize={22} />
      <SignatureBlock items={[{ label: 'Prepared By' }, { label: 'Verified By' }]} />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function ChargeHandoverReportView({
  documentRef,
  report,
  footerText,
}) {
  const pendingItems = String(report.payload.pendingItems || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)

  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="charge-handover" title={report.title}>
      <ReportHeader companyName={report.metadata[0]?.[1]} title={report.title} />
      <MetadataGrid items={report.metadata} />
      {renderRemarkBlock('Charge Details', report.payload.chargeDetails)}
      {renderRemarkBlock('Pending Items', pendingItems.length ? pendingItems.join('\n') : '-')}
      {renderRemarkBlock('Remark', report.payload.remark)}
      <SignatureBlock
        items={[
          { label: 'Outgoing Operator', value: report.payload.outgoingOperator },
          { label: 'Incoming Operator', value: report.payload.incomingOperator },
          { label: 'In Charge', value: report.payload.inChargeName },
        ]}
      />
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

export function GenericMonthlyReportView({
  documentRef,
  report,
  footerText,
}) {
  return (
    <ReportDocument documentRef={documentRef} orientation={report.orientation} reportType="monthly" title={report.title}>
      <ReportHeader companyName={report.metadata[0]?.[1]} title={report.title} subtitle={report.subtitle} />
      <MetadataGrid items={report.metadata} />
      <SummaryCards items={report.summaryCards} />
      <TagList items={report.tags} />
      <ReportTableGroup tables={report.tables} fallbackRows={report.rows} />
      {report.notes?.length ? (
        <section className="report-notes">
          <SectionTitle>Notes</SectionTitle>
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </section>
      ) : null}
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}

function MonthlySectionContent({ report }) {
  return (
    <>
      <MetadataGrid items={report.metadata} />
      <SummaryCards items={report.summaryCards} />
      <TagList items={report.tags} />
      <ReportTableGroup tables={report.tables} fallbackRows={report.rows} />
      {report.notes?.length ? (
        <section className="report-notes">
          <SectionTitle>Notes</SectionTitle>
          {report.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </section>
      ) : null}
    </>
  )
}

export function MonthEndPackReportView({
  documentRef,
  sections,
  companyProfile,
  footerText,
}) {
  return (
    <ReportDocument documentRef={documentRef} orientation="landscape" reportType="month-end-pack" title="Month-End Pack">
      <ReportHeader
        companyName={companyProfile.companyName}
        title="One Click Month-End Report Pack"
        subtitle={companyProfile.officeName}
      />
      {sections.map((section, index) => (
        <div key={section.title}>
          {index ? <PageBreak /> : null}
          <ReportHeader
            companyName={companyProfile.companyName}
            title={section.title}
            subtitle={section.subtitle}
            caption={`Section ${index + 1}`}
          />
          <MonthlySectionContent report={section} />
        </div>
      ))}
      <ReportFooter footerText={footerText} />
    </ReportDocument>
  )
}
