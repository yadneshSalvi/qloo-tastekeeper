'use client';
import Link from 'next/link';
import { Button } from '@/components/ui';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="main" className="centered-state">
      <span className="eyebrow">A MOMENT TO REGROUP</span>
      <h1>We couldn’t open your space.</h1>
      <p>
        Your permission is checked before anything is shared. The database may be unavailable; try
        again in a moment.
      </p>
      <Button onClick={reset}>Try again</Button>
      <Link href="/">Return home</Link>
    </main>
  );
}
