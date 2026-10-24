import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main" className="centered-state">
      <span className="eyebrow">SOMETHING WENT ASTRAY</span>
      <h1>This page isn’t here.</h1>
      <p>Return to your space to find your contexts, connections, and choices.</p>
      <Link className="button button-primary" href="/home">
        Go to my space
      </Link>
    </main>
  );
}
