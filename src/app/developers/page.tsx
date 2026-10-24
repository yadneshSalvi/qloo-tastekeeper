import Link from 'next/link';
import { ArrowLeft, ArrowRight, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Mark } from '@/components/art';
export const metadata = { title: 'How the gateway works' };
export default function Developers() {
  return (
    <div className="developer-page">
      <header className="landing-header">
        <Link href="/" className="brand">
          <Mark />
          <span>TASTEKEEPER</span>
        </Link>
        <Link href="/home" className="text-link">
          <ArrowLeft size={16} /> Your space
        </Link>
      </header>
      <main id="main">
        <span className="eyebrow">A SMALL, ENFORCED PREFERENCE GATEWAY</span>
        <h1>
          Useful choices.
          <br />
          <em>Permission at every boundary.</em>
        </h1>
        <p className="developer-lead">
          TASTEKEEPER lets a client ask for decisions from a permitted context, without receiving a
          reusable preference profile.
        </p>
        <div className="architecture-strip">
          <div>
            <span>01</span>
            <strong>Recipient</strong>
            <p>Chooses references and approves a specific scope.</p>
          </div>
          <ArrowRight />
          <div>
            <span>02</span>
            <strong>Gateway</strong>
            <p>Checks PostgreSQL authority and prepares eligible candidates.</p>
          </div>
          <ArrowRight />
          <div>
            <span>03</span>
            <strong>Independent client</strong>
            <p>Receives only permitted public fields after a fresh release check.</p>
          </div>
        </div>
        <div className="developer-columns">
          <section>
            <h2>What this local sample actually does</h2>
            <ul>
              <li>Three server-authenticated clients, with separate browser hosts and sessions.</li>
              <li>Recipient-created, single-use invitations bound to a claimed demo delegate.</li>
              <li>Encrypted context revisions, immutable catalogs and consent scopes.</li>
              <li>
                Atomic request reservations, request-digest idempotency, and row-level tenant
                isolation.
              </li>
              <li>Explicit corrections that change transparent sample rankings.</li>
              <li>
                Live final-release checks that serialize with revocation, correction, and client
                disable.
              </li>
            </ul>
          </section>
          <section>
            <h2>What it does not claim</h2>
            <ul>
              <li>Real identity verification. Mira and Alex are isolated example roles.</li>
              <li>
                Live Qloo rankings. The official harness adapter is prepared, but a key and verified
                entity mappings are required.
              </li>
              <li>Live prices, stock, streaming licenses, tickets, or opening times.</li>
              <li>Measured recommendation improvement or pilot results.</li>
              <li>Recall of answers already shared, screenshots, or third-party memory.</li>
              <li>A production deployment or managed authentication integration.</li>
            </ul>
          </section>
        </div>
        <section className="developer-contract">
          <div className="section-row">
            <div>
              <span className="eyebrow">THE PUBLIC REQUEST BOUNDARY</span>
              <h2>A candidate decision, in scope</h2>
            </div>
            <LockKeyhole size={24} />
          </div>
          <pre>{`POST /v1/decisions
x-client-id: books
x-client-secret: <server-held credential>
Authorization: Bearer <short-lived delegated token>

{
  "grantId": "<approved grant>",
  "contextId": "<exact context>",
  "purpose": "gift",
  "operation": "rank",
  "targetType": "book",
  "snapshotId": "<immutable approved catalog>",
  "candidateIds": ["book-delights", "book-psalm"],
  "fields": ["id", "title", "description", "creator", "url", "price"],
  "hardConstraints": {"maxPrice": 2500},
  "idempotencyKey": "<unique request UUID>",
  "mode": "sample"
}`}</pre>
          <p>
            Unknown fields fail validation. One grant must authorize the entire request. The client
            cannot send references, expand scope, or retrieve owner-only evidence.
          </p>
        </section>
        <section className="developer-columns">
          <div>
            <h2>Authored sample rules</h2>
            <p>
              The sample adds the declared tag weights of the approved active references, then
              orders the supplied candidates by their weighted overlap. Stable item IDs break ties.
              Budget, format, duration, and setting constraints are applied first.
            </p>
            <p>
              Removing “Braiding Sweetgrass” from Personal reduces the sample nature signal. The
              next book, film, and place ordering changes; Gift remains untouched. These rules
              demonstrate correction propagation, not Qloo affinity or human preference quality.
            </p>
          </div>
          <div>
            <h2>Ending access</h2>
            <p>
              The final release transaction locks the client, context, and grant in that order. It
              rechecks active status, epoch, exact scope, current revisions, token and grant expiry,
              candidate membership, and public fields.
            </p>
            <p>
              If revocation commits first, no new release is permitted. An already-authorized
              response may arrive afterward; no system can make a recipient forget it.
            </p>
          </div>
        </section>
        <div className="truth-note">
          <ShieldCheck size={22} />
          <p>
            Sample workspaces expire after 24 hours and stop authorizing requests. Automatic
            physical deletion and production retention jobs are not implemented yet. Do not enter
            real private data in this local role-play.
          </p>
        </div>
        <div className="developer-footer">
          <Link className="button button-primary" href="/">
            Try the sample <ArrowRight size={16} />
          </Link>
          <a
            href="https://github.com/yadneshSalvi/qloo-tastekeeper"
            target="_blank"
            rel="noreferrer"
          >
            View source ↗
          </a>
        </div>
      </main>
    </div>
  );
}
