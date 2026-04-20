const logoSrc = `${import.meta.env.BASE_URL}qt33-brand-logo.png`

export default function Qt33OffsiteBrand({ variant = 'login' }) {
  return (
    <a
      className={`qt33-brand-link qt33-brand-link--${variant}`}
      href="https://qt33.in/"
      target="_blank"
      rel="noopener noreferrer"
      title="qt33.in — Substation DLR and Reports (opens in a new tab)"
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
