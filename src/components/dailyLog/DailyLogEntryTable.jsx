import { useRef, useState } from 'react'
import { formatNumber } from '../../lib/reportFormats'

function getMetricLabel(metric) {
  if (metric === 'amp') {
    return 'Amp'
  }

  if (metric === 'kv') {
    return 'KV'
  }

  if (metric === 'kwh') {
    return 'KWH'
  }

  if (metric === 'tap') {
    return 'Tap'
  }

  if (metric === 'temperature') {
    return 'Temp'
  }

  return 'Value'
}

export default function DailyLogEntryTable({
  config,
  rows,
  derivedState,
  activeHour,
  editable = true,
  onFeederMetricChange,
  onBatteryVoltageChange,
  onTransformerValueChange,
  onRemarkChange,
}) {
  const [focusedHour, setFocusedHour] = useState('')
  const tableRef = useRef(null)
  const navigationColumnCount = config.flatColumns.length + 1

  if (!config.feeders.length && !config.batterySets.length && !config.transformers.length) {
    return (
      <div className="report-empty-state">
        Daily Log chart sathi feeder, battery set, kiwa transformer master configure kara.
      </div>
    )
  }

  function handleRowFocus(hour) {
    setFocusedHour(hour)
  }

  function handleRowBlur(event, hour) {
    const nextTarget = event.relatedTarget

    if (nextTarget instanceof HTMLElement && nextTarget.dataset.navHour === hour) {
      return
    }

    if (focusedHour === hour) {
      setFocusedHour('')
    }
  }

  function focusInputElement(element) {
    if (!(element instanceof HTMLInputElement)) {
      return false
    }

    element.focus()
    element.select()
    return true
  }

  function queryCellInput(rowIndex, columnIndex) {
    if (!tableRef.current) {
      return null
    }

    return tableRef.current.querySelector(
      `[data-nav-row="${rowIndex}"][data-nav-col="${columnIndex}"]`,
    )
  }

  function focusDirectionalCell(rowIndex, columnIndex, rowStep, columnStep) {
    let nextRow = rowIndex + rowStep
    let nextColumn = columnIndex + columnStep

    while (
      nextRow >= 0 &&
      nextRow < rows.length &&
      nextColumn >= 0 &&
      nextColumn < navigationColumnCount
    ) {
      const nextInput = queryCellInput(nextRow, nextColumn)

      if (focusInputElement(nextInput)) {
        return true
      }

      nextRow += rowStep
      nextColumn += columnStep
    }

    return false
  }

  function focusTabCell(rowIndex, columnIndex, direction) {
    let nextRow = rowIndex
    let nextColumn = columnIndex + direction

    while (nextRow >= 0 && nextRow < rows.length) {
      while (nextColumn >= 0 && nextColumn < navigationColumnCount) {
        const nextInput = queryCellInput(nextRow, nextColumn)

        if (focusInputElement(nextInput)) {
          return true
        }

        nextColumn += direction
      }

      nextRow += direction > 0 ? 1 : -1
      nextColumn = direction > 0 ? 0 : navigationColumnCount - 1
    }

    return false
  }

  function handleCellKeyDown(event, rowIndex, columnIndex) {
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      focusDirectionalCell(rowIndex, columnIndex, 0, 1)
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      focusDirectionalCell(rowIndex, columnIndex, 0, -1)
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      focusDirectionalCell(rowIndex, columnIndex, 1, 0)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      focusDirectionalCell(rowIndex, columnIndex, -1, 0)
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (!focusDirectionalCell(rowIndex, columnIndex, 1, 0)) {
        focusTabCell(rowIndex, columnIndex, 1)
      }
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      focusTabCell(rowIndex, columnIndex, event.shiftKey ? -1 : 1)
    }
  }

  return (
    <div ref={tableRef} className="daily-log-table-shell daily-log-entry-shell">
      <table className="daily-log-entry-table">
        <thead>
          <tr>
            <th rowSpan={3} className="sticky-hour-column sticky-header-tier-1">
              Hrs
            </th>
            <th rowSpan={3} className="sticky-total-column sticky-header-tier-1">
              {config.totalColumnLabel || 'Total Amp'}
            </th>
            {config.headerGroups.map((group) => (
              <th
                key={group.key}
                className="sticky-header-tier-1"
                colSpan={group.items.reduce((total, item) => total + item.metrics.length, 0)}
              >
                {group.label}
              </th>
            ))}
            <th rowSpan={3} className="sticky-header-tier-1">Remark</th>
          </tr>
          <tr>
            {config.headerGroups.map((group) =>
              group.items.map((item) => (
                <th
                  key={`${group.key}-${item.kind}-${item.id}`}
                  className="sticky-header-tier-2"
                  colSpan={item.metrics.length}
                >
                  {item.label}
                </th>
              )),
            )}
          </tr>
          <tr>
            {config.headerGroups.map((group) =>
              group.items.map((item) =>
                item.metrics.map((metric) => (
                  <th
                    key={`${group.key}-${item.kind}-${item.id}-${metric}`}
                    className="sticky-header-tier-3"
                    data-metric={metric}
                  >
                    {getMetricLabel(metric)}
                  </th>
                )),
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const derivedRow = derivedState.tableRows[rowIndex]
            const isActiveHour = activeHour && row.hour === activeHour
            const isFocusedHour = focusedHour && row.hour === focusedHour

            return (
              <tr
                key={row.hour}
                className={[
                  isActiveHour ? 'daily-log-active-row' : '',
                  isFocusedHour ? 'daily-log-focused-row' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <th className="sticky-hour-column">{row.hour}</th>
                <td className="sticky-total-column align-right daily-log-total-auto-cell">
                  {formatNumber(derivedRow?.totalLoad || 0)}
                </td>
                {config.flatColumns.map((column, columnIndex) => {
                  if (column.kind === 'feeder') {
                    const cell = derivedRow?.cells?.[column.key] || {}
                    const overlay = derivedState.overlayMap.get(`${column.id}:${rowIndex}`)
                    const isComputedAmp =
                      column.metric === 'amp' &&
                      config.feeders.some(
                        (feeder) =>
                          feeder.id === column.id &&
                          feeder.feederType === 'main_incoming' &&
                          (config.childMap?.[feeder.id] || []).length > 0,
                      )
                    const inputClassName = [
                      'daily-log-cell-input',
                      cell.sourceType === 'auto_gap_fill' ? 'daily-log-auto-fill-input' : '',
                      cell.isPending ? 'daily-log-pending-input' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')

                    if (cell.overlayCode || (overlay && column.metric !== 'kwh')) {
                      return (
                        <td
                          key={column.key}
                          className={`daily-log-event-cell daily-log-event-${cell.overlaySource || overlay?.source}`}
                        >
                          {cell.overlayCode || ''}
                        </td>
                      )
                    }

                    return (
                      <td key={column.key} data-metric={column.metric}>
                        <div className="daily-log-cell-wrap">
                          <input
                            type="text"
                            inputMode="decimal"
                            className={[
                              inputClassName,
                              isComputedAmp ? 'daily-log-auto-amp-input' : '',
                              cell.validationState === 'invalid_decrease'
                                ? 'daily-log-invalid-input'
                                : '',
                              cell.sourceType === 'carry_forward'
                                ? 'daily-log-carry-forward-input'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            value={cell.value ?? ''}
                            placeholder={cell.isPending ? '...' : ''}
                            title={cell.validationMessage || ''}
                            readOnly={!editable || isComputedAmp}
                            autoComplete="off"
                            data-nav-row={rowIndex}
                            data-nav-col={columnIndex}
                            data-nav-hour={row.hour}
                            onFocus={() => handleRowFocus(row.hour)}
                            onBlur={(event) => handleRowBlur(event, row.hour)}
                            onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                            onChange={(event) =>
                              onFeederMetricChange(
                                rowIndex,
                                column.id,
                                column.metric,
                                event.target.value,
                              )
                            }
                          />
                          {cell.sourceBadge ? (
                            <span className="daily-log-source-badge">{cell.sourceBadge}</span>
                          ) : null}
                        </div>
                      </td>
                    )
                  }

                  if (column.kind === 'battery') {
                    return (
                      <td key={column.key} data-metric={column.metric}>
                        <input
                          type="text"
                          inputMode="decimal"
                          className="daily-log-cell-input"
                          value={row.batteryVoltages?.[column.id] ?? ''}
                          readOnly={!editable}
                          autoComplete="off"
                          data-nav-row={rowIndex}
                          data-nav-col={columnIndex}
                          data-nav-hour={row.hour}
                          onFocus={() => handleRowFocus(row.hour)}
                          onBlur={(event) => handleRowBlur(event, row.hour)}
                          onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                          onChange={(event) =>
                            onBatteryVoltageChange(rowIndex, column.id, event.target.value)
                          }
                        />
                      </td>
                    )
                  }

                  return (
                    <td key={column.key} data-metric={column.metric}>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="daily-log-cell-input"
                        value={
                          column.metric === 'tap'
                            ? row.transformerTaps?.[column.id] ?? ''
                            : row.transformerTemperatures?.[column.id] ?? ''
                        }
                        readOnly={!editable}
                        autoComplete="off"
                        data-nav-row={rowIndex}
                        data-nav-col={columnIndex}
                        data-nav-hour={row.hour}
                        onFocus={() => handleRowFocus(row.hour)}
                        onBlur={(event) => handleRowBlur(event, row.hour)}
                        onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex)}
                        onChange={(event) =>
                          onTransformerValueChange(
                            rowIndex,
                            column.id,
                            column.metric,
                            event.target.value,
                          )
                        }
                      />
                    </td>
                  )
                })}
                <td className="daily-log-remark-cell">
                  <input
                    value={row.remark || ''}
                    className="daily-log-cell-input"
                    readOnly={!editable}
                    autoComplete="off"
                    data-nav-row={rowIndex}
                    data-nav-col={config.flatColumns.length}
                    data-nav-hour={row.hour}
                    onFocus={() => handleRowFocus(row.hour)}
                    onBlur={(event) => handleRowBlur(event, row.hour)}
                    onKeyDown={(event) =>
                      handleCellKeyDown(event, rowIndex, config.flatColumns.length)
                    }
                    onChange={(event) => onRemarkChange(rowIndex, event.target.value)}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
