import { useMemo, useState } from 'react'

function buildInitialForm(fields, initialValue = {}) {
  return fields.reduce((form, field) => {
    if (initialValue[field.name] !== undefined) {
      form[field.name] = initialValue[field.name]
      return form
    }

    form[field.name] = field.type === 'checkbox' ? false : ''
    return form
  }, {})
}

export default function MasterDataManager({
  title,
  description,
  fields,
  records,
  onSave,
  onDelete,
}) {
  const [form, setForm] = useState(buildInitialForm(fields))

  const columns = useMemo(
    () => fields.filter((field) => field.showInTable !== false),
    [fields],
  )

  function resetForm() {
    setForm(buildInitialForm(fields))
  }

  function updateField(field, value) {
    setForm((current) => {
      if (typeof field.applyChange === 'function') {
        return field.applyChange(current, value)
      }

      return {
        ...current,
        [field.name]: value,
      }
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    await onSave(form)
    resetForm()
  }

  return (
    <section className="content-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Master data</p>
          <h2>{title}</h2>
        </div>
      </div>
      <p className="muted-copy">{description}</p>

      <form className="form-stack" onSubmit={handleSubmit}>
        <div className="details-grid">
          {fields.map((field) => (
            <div key={field.name}>
              <label htmlFor={`${title}-${field.name}`}>{field.label}</label>
              {field.type === 'select' ? (
                <select
                  id={`${title}-${field.name}`}
                  value={form[field.name]}
                  onChange={(event) => updateField(field, event.target.value)}
                  required={field.required}
                >
                  <option value="">Select</option>
                  {(field.options || []).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'checkbox' ? (
                <label className="checkbox-label" htmlFor={`${title}-${field.name}`}>
                  <input
                    id={`${title}-${field.name}`}
                    type="checkbox"
                    checked={Boolean(form[field.name])}
                    onChange={(event) => updateField(field, event.target.checked)}
                  />
                  {field.label}
                </label>
              ) : (
                <input
                  id={`${title}-${field.name}`}
                  type={field.type || 'text'}
                  value={form[field.name]}
                  onChange={(event) => updateField(field, event.target.value)}
                  required={field.required}
                />
              )}
            </div>
          ))}
        </div>
        <div className="inline-actions">
          <button type="submit" className="primary-button">
            Save
          </button>
          <button type="button" className="ghost-light-button" onClick={resetForm}>
            Clear
          </button>
        </div>
      </form>

      <div className="table-shell">
        <table className="simple-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.name}>{column.label}</th>
              ))}
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                {columns.map((column) => {
                  const rawValue = record[column.name]
                  const optionLabel = column.options?.find(
                    (item) => item.value === rawValue,
                  )?.label

                  return (
                    <td key={column.name}>
                      {column.type === 'checkbox'
                        ? rawValue
                          ? 'Yes'
                          : 'No'
                        : optionLabel || rawValue || '-'}
                    </td>
                  )
                })}
                <td>
                  <button
                    type="button"
                    className="danger-button small-button"
                    onClick={() => onDelete(record.id)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!records.length ? (
              <tr>
                <td colSpan={columns.length + 1}>No records added yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
