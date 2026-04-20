const logoSrc = `${import.meta.env.BASE_URL}qt33-brand-logo.png`

export default function Qt33OffsiteBrand({ variant = 'login' }) {
  return (
    <a
      className={`qt33-brand-link qt33-brand-link--${variant}`}
      href="#/"
      title="QT - Unified Substation ERP Dashboard"
    >
      <img
        src={logoSrc}
        alt="qt33.in — Substation DLR and Reports"
        loading={variant === 'header' ? 'lazy' : 'eager'}
        decoding="async"
      />
    </a>
  )
}
