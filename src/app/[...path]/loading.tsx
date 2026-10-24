export default function Loading() {
  return (
    <main id="main" className="loading-page" aria-busy="true" aria-label="Opening your space">
      <div className="skeleton skeleton-line" />
      <div className="skeleton skeleton-hero" />
      <div className="skeleton skeleton-line" />
      <p>Opening your space…</p>
    </main>
  );
}
