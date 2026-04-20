import { formatDateTime } from '../../lib/dateUtils'

export function ReportDocument({
  children,
  documentRef,
  orientation = 'portrait',
  reportType = 'generic',
  title = '',
}) {
  return (
    <article
      ref={documentRef}
      className={`report-document report-${orientation} report-${reportType}`}
      data-report-document="true"
      aria-label={title || 'Report preview'}
    >
      {children}
    </article>
  )
}

export function ReportHeader({
  companyName,
  title,
  subtitle,
  caption,
}) {
  return (
    <header className="report-header">
      <p className="report-company">{companyName}</p>
      <h2>{title}</h2>
      {subtitle ? <p className="report-subtitle">{subtitle}</p> : null}
      {caption ? <p className="report-caption">{caption}</p> : null}
    </header>
  )
}

export function MsedclReportHeader({
  substationObj,
  title,
  monthLabel,
}) {
  const sub = substationObj || {}
  return (
    <header className="msedcl-print-header">
      <div className="msedcl-print-company">MAHARASHTRA STATE ELECTRICITY DISTRIBUTION CO. LTD</div>
      <div className="msedcl-print-station">
        <span>{sub.name || 'Substation Name'}</span>
        <span>{sub.omName || 'O&M Name'}</span>
        <span>{sub.subDivisionName || 'Sub Division'}</span>
      </div>
      <div className="msedcl-print-title">
        {title ? title.toUpperCase() : 'ATTENDANCE & DUTY CHART'} FOR THE MONTH OF {monthLabel || '-'}
      </div>
    </header>
  )
}

export function MetadataGrid({ items = [] }) {
  return (
    <section className="report-metadata-grid">
      {items.map(([label, value]) => (
        <div key={`${label}-${value}`} className="report-metadata-item">
          <span>{label}</span>
          <strong>{value || '-'}</strong>
        </div>
      ))}
    </section>
  )
}

export function SummaryCards({ items = [] }) {
  if (!items.length) {
    return null
  }

  return (
    <section className="report-summary-grid">
      {items.map((item) => (
        <article key={item.label} className="report-summary-card">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </article>
      ))}
    </section>
  )
}

export function TagList({ items = [] }) {
  if (!items.length) {
    return null
  }

  return (
    <section className="report-tag-list">
      {items.map((item) => (
        <div key={item} className="report-tag-item">
          {item}
        </div>
      ))}
    </section>
  )
}

export function SectionTitle({ children }) {
  return <h3 className="report-section-title">{children}</h3>
}

export function ReportTable({
  columns,
  rows,
  footRows = [],
  className = '',
  chunkSize = 0,
  headerRows = null,
}) {
  if (!columns.length) {
    return (
      <div className={`report-table-shell ${className}`.trim()}>
        <div className="report-empty-state">No rows available.</div>
      </div>
    )
  }

  const rowChunks =
    chunkSize > 0
      ? Array.from(
          { length: Math.ceil(rows.length / chunkSize) || 1 },
          (_, index) => rows.slice(index * chunkSize, (index + 1) * chunkSize),
        )
      : [rows]

  return (
    <>
      {rowChunks.map((rowChunk, chunkIndex) => (
        <div
          key={`chunk-${chunkIndex}`}
          className={`report-table-shell report-table-chunk ${className}`.trim()}
        >
          {chunkIndex ? <div className="report-page-break" aria-hidden="true" /> : null}
          <table className="report-table">
            <thead>
              {headerRows?.length
                ? headerRows.map((headerRow, headerRowIndex) => (
                    <tr key={`header-row-${headerRowIndex}`}>
                      {headerRow.map((cell, cellIndex) => (
                        <th
                          key={cell.key || `header-cell-${headerRowIndex}-${cellIndex}`}
                          colSpan={cell.colSpan}
                          rowSpan={cell.rowSpan}
                          style={cell.width ? { width: cell.width } : undefined}
                          className={[
                            cell.align ? `align-${cell.align}` : '',
                            cell.className || '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                        >
                          {cell.label}
                        </th>
                      ))}
                    </tr>
                  ))
                : (
                    <tr>
                      {columns.map((column) => (
                        <th
                          key={column.key}
                          style={column.width ? { width: column.width } : undefined}
                          className={column.align ? `align-${column.align}` : ''}
                        >
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  )}
            </thead>
            <tbody>
              {rowChunk.map((row, index) => (
                <tr
                  key={row.id || `${row.srNo || 'row'}-${chunkIndex}-${index}`}
                  className={row._rowClass || ''}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={column.align ? `align-${column.align}` : ''}
                    >
                      {column.render
                        ? column.render(row, chunkIndex * (chunkSize || rows.length) + index)
                        : row[column.key]}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={columns.length}>No rows available.</td>
                </tr>
              ) : null}
              {chunkIndex === rowChunks.length - 1
                ? footRows.map((row, index) => (
                    <tr key={`foot-${index}`} className="report-table-foot-row">
                      {columns.map((column) => (
                        <td
                          key={column.key}
                          className={column.align ? `align-${column.align}` : ''}
                        >
                          {column.render ? column.render(row, index) : row[column.key]}
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}

export function SignatureBlock({ items = [] }) {
  if (!items.length) {
    return null
  }

  return (
    <section className="report-signature-grid">
      {items.map((item) => (
        <div key={item.label} className="report-signature-item">
          <div className="report-signature-space">{item.value || ''}</div>
          <strong>{item.label}</strong>
        </div>
      ))}
    </section>
  )
}

export function PageBreak() {
  return <div className="report-page-break" aria-hidden="true" />
}

export function ReportFooter({ footerText }) {
  return (
    <footer className="report-footer">
      <span>{footerText}</span>
      <span>{formatDateTime(new Date())}</span>
    </footer>
  )
}
