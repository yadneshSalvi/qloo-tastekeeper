'use client';
import Link from 'next/link';
import { ArrowRight, Gift, ShieldCheck, RefreshCw, BookOpen } from 'lucide-react';
import { useState } from 'react';
import { GiftArt, Mark } from './art';
import { Button } from './ui';
export function Landing() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start(path: string) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/demo', { method: 'POST' });
      if (!response.ok) throw new Error('The demo workspace is unavailable. Please try again.');
      window.location.assign(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start a workspace.');
      setBusy(false);
    }
  }
  return (
    <div className="landing">
      <header className="landing-header">
        <Link href="/" className="brand">
          <Mark />
          <span>TASTEKEEPER</span>
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <Link href="/developers">For developers</Link>
          <Button variant="secondary" onClick={() => start('/home')} busy={busy}>
            Explore the demo <ArrowRight size={16} />
          </Button>
        </nav>
      </header>
      <main id="main">
        <section className="landing-hero">
          <div>
            <span className="eyebrow">YOUR TASTE. YOUR TERMS.</span>
            <h1>
              Thoughtful choices.
              <br />
              <em>A little more you.</em>
            </h1>
            <p>
              Let someone choose a gift you’ll love, without handing over your whole taste history.
              Share a little context. Keep the rest yours.
            </p>
            <div className="landing-actions">
              <Button busy={busy} onClick={() => start('/gifts/new')}>
                <Gift size={18} /> Try a thoughtful gift <ArrowRight size={17} />
              </Button>
              <button className="text-button" onClick={() => start('/contexts/new')}>
                Create my taste space <ArrowRight size={16} />
              </button>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="landing-note">
              <ShieldCheck size={16} />
              <span>A temporary, isolated demo. No account or payment.</span>
            </div>
          </div>
          <div className="landing-illustration">
            <span className="handwritten">a little thought goes a long way</span>
            <GiftArt />
            <span className="illustration-caption">
              GOOD TASTE IS PERSONAL. SHARING IT SHOULD BE TOO.
            </span>
          </div>
        </section>
        <section id="how-it-works" className="how-section">
          <div className="section-heading">
            <span className="eyebrow">A SIMPLER WAY TO BE THOUGHTFUL</span>
            <h2>
              Give a little context.
              <br />
              Make room for a good surprise.
            </h2>
          </div>
          <div className="how-grid">
            <article>
              <span className="step-numeral">01</span>
              <BookOpen />
              <h3>A few things you return to</h3>
              <p>
                Books, films, places. Gather the references that matter in a space for this
                occasion.
              </p>
            </article>
            <article>
              <span className="step-numeral">02</span>
              <Gift />
              <h3>A choice, with permission</h3>
              <p>
                Invite one person to one client. Choose what it can use, what it can share, and for
                how long.
              </p>
            </article>
            <article>
              <span className="step-numeral">03</span>
              <RefreshCw />
              <h3>Yours to change</h3>
              <p>
                Correct a reference or end a connection. Future choices follow your current
                permission.
              </p>
            </article>
          </div>
        </section>
        <section className="truth-note">
          <ShieldCheck size={21} />
          <p>
            Reviewed cultural references. Public inventory. Permission checked at every release.
            Live Qloo results and authored sample choices are labeled separately, and every result
            includes a receipt. Suggestions are possibilities, not promises about individual taste.
          </p>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/" className="brand">
          <Mark />
          <span>TASTEKEEPER</span>
        </Link>
        <span>A little context. A better connection.</span>
        <Link href="/developers">Built with care ↗</Link>
      </footer>
    </div>
  );
}
