import {
  architectureDecisions,
  deliveryPhases,
  targetModules,
} from '../config/legacyInventory'

export default function ArchitecturePage() {
  return (
    <div className="page-stack">
      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Target architecture</p>
            <h2>Hostinger-friendly web app, Supabase backend, Android APK.</h2>
          </div>
        </div>
        <div className="architecture-grid">
          {architectureDecisions.map((decision) => (
            <article key={decision.title} className="detail-card">
              <h3>{decision.title}</h3>
              <p>{decision.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Security model</p>
            <h2>Admin vs user visibility rules</h2>
          </div>
        </div>
        <div className="details-grid">
          <article className="detail-card">
            <h3>Admin privileges</h3>
            <p>Admin la sarv data, signup approvals, role changes, and master tables cha access asel.</p>
          </article>
          <article className="detail-card">
            <h3>Normal user rules</h3>
            <p>User la fakta swata tayar kelela data disel. He UI var nahi tar RLS policies var enforce hoil.</p>
          </article>
          <article className="detail-card">
            <h3>Forgot password</h3>
            <p>Supabase reset email flow + in-app password recovery completion use karu.</p>
          </article>
          <article className="detail-card">
            <h3>Admin-created accounts</h3>
            <p>Local SQL mode madhye he localhost API karto. Final production sathi secure Edge Function kiwa protected backend action required aahe.</p>
          </article>
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Module migration</p>
            <h2>Porting order</h2>
          </div>
        </div>
        <div className="grid-cards">
          {targetModules.map((module, index) => (
            <article key={module.name} className="feature-card">
              <p className="eyebrow">Step {index + 1}</p>
              <h3>{module.name}</h3>
              <p>{module.scope}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Execution plan</p>
            <h2>Implementation phases</h2>
          </div>
        </div>
        <ol className="phase-list">
          {deliveryPhases.map((phase) => (
            <li key={phase}>{phase}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
