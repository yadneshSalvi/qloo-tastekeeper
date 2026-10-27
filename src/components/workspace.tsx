'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useMemo, useEffect, useCallback, type ReactNode } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileCheck2,
  Film,
  Gift,
  Heart,
  Home,
  Layers3,
  Leaf,
  Link2,
  LockKeyhole,
  MapPin,
  Plus,
  RefreshCw,
  ShieldCheck,
  X,
  Menu,
  Settings2,
  Trash2,
} from 'lucide-react';
import type { Workspace } from '@/server/store';
import { CLIENTS, REFERENCE_CHOICES, type ClientId, type Signal } from '@/domain/catalog';
import { PUBLIC_FIELDS, type CorrectionInput } from '@/domain/contracts';
import { GiftArt, Mark, ContextArt, ReferenceArt } from './art';
import { ReferenceSearch } from './reference-search';
import {
  Badge,
  Button,
  CheckLine,
  ConfirmEnd,
  EvidenceDrawer,
  ExternalLink,
  Modal,
  NavigationDrawer,
} from './ui';

type Execution = {
  defaultMode: 'sample' | 'qloo';
  qlooAvailable: boolean;
  agentAvailable: boolean;
  providerLabel?: string;
  agentLabel?: string;
  referenceSearchAvailable?: boolean;
};
type ReviewedReference = {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  verified?: boolean;
  verifiedAt?: string;
  source?: string;
};
type WorkspaceData = Workspace & {
  execution?: Execution;
  references?: ReviewedReference[];
  clientOrigins?: Partial<Record<ClientId, string>>;
  owner: Workspace['owner'] & { expiresAt?: string; retentionNotice?: string };
};
type Context = WorkspaceData['contexts'][number];
type Grant = WorkspaceData['grants'][number];
type Decision = WorkspaceData['decisions'][number];
const clientIcons = { books: BookOpen, media: Film, places: MapPin };
const clientOrigin = (id: ClientId, data?: WorkspaceData) =>
  data?.clientOrigins?.[id] ?? `http://${id}.localhost:${CLIENTS[id].port}`;
const contextLabel = (c: Context) => (c.purpose === 'gift' ? 'Gift' : 'Personal');
const prettyTime = (value: string) =>
  new Date(value).toLocaleString('en-GB', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + ' UTC';
const short = (value: string) => `${value.slice(0, 8)}…`;
class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function api<T>(path: string, body?: unknown, method?: 'DELETE'): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok)
    throw new WorkspaceError(
      result.error?.message ?? 'This action could not be completed.',
      result.error?.code,
    );
  return result as T;
}
function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function ClientEmblem({ clientId, large = false }: { clientId: ClientId; large?: boolean }) {
  const Icon = clientIcons[clientId];
  return (
    <div className={`client-emblem emblem-${clientId} ${large ? 'large' : ''}`}>
      <Icon size={large ? 30 : 21} />
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function Status({ status }: { status: string }) {
  return (
    <Badge
      tone={
        status === 'active'
          ? 'green'
          : status === 'pending'
            ? 'blue'
            : status === 'revoked'
              ? 'neutral'
              : status === 'expired'
                ? 'amber'
                : 'neutral'
      }
    >
      {status === 'pending'
        ? 'Awaiting claim'
        : status === 'revoked'
          ? 'Access ended'
          : status === 'active'
            ? 'Connected'
            : status}
    </Badge>
  );
}

export function WorkspaceApp({
  initialData,
  path,
  requestedClient,
}: {
  initialData: WorkspaceData;
  path: string[];
  requestedClient?: ClientId;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  const [journal, setJournal] = useState(false);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [ending, setEnding] = useState<Grant | null>(null);
  const [endBusy, setEndBusy] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteAck, setDeleteAck] = useState(false);
  const [syncIssue, setSyncIssue] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const route = path[0] ?? 'home';
  const pageKey = path.join('/');
  const refresh = useCallback(async () => {
    setData(await api<WorkspaceData>('workspace'));
    setSyncIssue(false);
  }, []);
  useEffect(() => {
    let active = true;
    const check = async () => {
      if (document.hidden) return;
      try {
        const next = await api<WorkspaceData>('workspace');
        if (active) {
          setData(next);
          setSyncIssue(false);
        }
      } catch (e) {
        if (active) {
          if (
            e instanceof WorkspaceError &&
            ['SESSION_REQUIRED', 'SESSION_EXPIRED', 'DEMO_EXPIRED', 'PRINCIPAL_DENIED'].includes(
              e.code ?? '',
            )
          )
            setSessionEnded(true);
          else setSyncIssue(true);
        }
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 8000);
    window.addEventListener('focus', check);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', check);
    };
  }, [pageKey]);
  async function deleteWorkspace() {
    setDeleting(true);
    setError('');
    try {
      await api('workspace', undefined, 'DELETE');
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this demo workspace.');
      setDeleting(false);
    }
  }
  async function endOwnerSession() {
    setSigningOut(true);
    try {
      await api('logout', {});
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end this owner session.');
      setSigningOut(false);
    }
  }
  async function openEvidence(id: string) {
    setJournal(false);
    setEvidence({ id });
    setEvidenceLoading(true);
    try {
      setEvidence(await api<Record<string, unknown>>(`decisions/${id}/evidence`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load evidence.');
      setEvidence(null);
    } finally {
      setEvidenceLoading(false);
    }
  }
  async function endAccess() {
    if (!ending) return;
    setEndBusy(true);
    try {
      await api(`grants/${ending.id}/revoke`, {});
      await refresh();
      setEnding(null);
      setNotice('Access ended. Future requests through this connection will be blocked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not end access.');
    } finally {
      setEndBusy(false);
    }
  }
  const nav = [
    { href: '/home', label: 'Your space', icon: Home, key: 'home' },
    { href: '/contexts', label: 'Taste contexts', icon: Layers3, key: 'contexts' },
    { href: '/connections', label: 'Connections', icon: Link2, key: 'connections' },
  ];

  if (sessionEnded)
    return (
      <main id="main" className="centered-state">
        <Mark />
        <span className="eyebrow">A TEMPORARY SPACE</span>
        <h1>This owner session has ended.</h1>
        <p>
          Its stored view is no longer available in this browser. Start a new isolated demo to
          explore again.
        </p>
        <Link className="button button-primary" href="/">
          Start a new demo space <ArrowRight size={17} />
        </Link>
      </main>
    );

  const navigation = (
    <>
      <Link href="/home" className="brand">
        <Mark />
        <span>TASTEKEEPER</span>
      </Link>
      <div className="sidebar-person">
        <div className="avatar">M</div>
        <div>
          <strong>Mira’s space</strong>
          <span>Your taste, on your terms</span>
        </div>
      </div>
      <nav aria-label="Workspace navigation">
        {nav.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            className={`nav-item ${route === n.key ? 'active' : ''}`}
            onClick={() => setMenu(false)}
          >
            <n.icon size={19} />
            <span>{n.label}</span>
            {n.key === 'connections' &&
              data.grants.filter((g) => g.status === 'active').length > 0 && (
                <span className="nav-count">
                  {data.grants.filter((g) => g.status === 'active').length}
                </span>
              )}
          </Link>
        ))}
        <Link
          href="/gifts/new"
          className={`nav-item ${route === 'gifts' ? 'active' : ''}`}
          onClick={() => setMenu(false)}
        >
          <Gift size={19} />
          <span>Gift invitations</span>
        </Link>
      </nav>
      <div className="sidebar-rule" />
      <span className="sidebar-label">A FEW GOOD CONNECTIONS</span>
      <nav aria-label="Reference clients">
        {(Object.keys(CLIENTS) as ClientId[]).map((id) => (
          <Link key={id} href={`/connections?client=${id}`} className="client-nav">
            <ClientEmblem clientId={id} />
            <div>
              <strong>{CLIENTS[id].name}</strong>
              <span>
                {id === 'books'
                  ? 'Books, considered'
                  : id === 'media'
                    ? 'An evening, chosen'
                    : 'A little time outside'}
              </span>
            </div>
            <ArrowUpRight size={14} />
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-mini">
          <ShieldCheck size={21} />
          <p>
            A little context.
            <br />
            <strong>A better connection.</strong>
          </p>
        </div>
        <Link href="/developers" className="sidebar-help">
          <CircleHelp size={16} /> How TASTEKEEPER works <ArrowUpRight size={13} />
        </Link>
        <button
          className="sidebar-help sidebar-privacy"
          onClick={() => {
            setMenu(false);
            setPrivacy(true);
          }}
        >
          <Settings2 size={16} /> Demo ownership & privacy
        </button>
      </div>
    </>
  );
  return (
    <div className="workspace-shell">
      <aside className="sidebar desktop-sidebar">{navigation}</aside>
      <NavigationDrawer open={menu} onOpenChange={setMenu}>
        {navigation}
      </NavigationDrawer>
      <div className="workspace-main">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            aria-haspopup="dialog"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Your workspace <ChevronRight size={13} />{' '}
            <span>
              {route === 'home'
                ? 'Overview'
                : route === 'gifts'
                  ? 'A thoughtful gift'
                  : route === 'contexts'
                    ? 'Taste contexts'
                    : route === 'connections'
                      ? 'Connections'
                      : 'Your choices'}
            </span>
          </div>
          <div className="topbar-right">
            <span
              className={`sample-indicator ${data.execution?.qlooAvailable ? 'live-indicator' : ''}`}
            >
              <span />{' '}
              {data.execution?.qlooAvailable ? (
                <>
                  QLOO LIVE<span className="demo-mode-label"> · DEMO</span>
                </>
              ) : (
                'ISOLATED DEMO'
              )}
            </span>
            <button
              className="icon-button"
              aria-label="Open access journal"
              onClick={() => setJournal(true)}
            >
              <FileCheck2 size={19} />
            </button>
            <div className="avatar avatar-small" aria-label="Mira, example recipient">
              M
            </div>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="workspace-content">
          {syncIssue && (
            <div className="sync-notice" role="status">
              <RefreshCw size={16} />
              <span>This view could not refresh. Your last saved state is shown.</span>
              <button
                className="text-button"
                onClick={() => void refresh().catch(() => setSyncIssue(true))}
              >
                Try again
              </button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <CheckCheck size={19} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss message"
                onClick={() => setNotice('')}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                onClick={() => setError('')}
                className="icon-button"
                aria-label="Dismiss error"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {route === 'home' && <HomePage data={data} onEvidence={openEvidence} />}
          {route === 'gifts' && <GiftWizard data={data} onCreated={refresh} />}
          {route === 'contexts' && path[1] === 'new' && (
            <NewContext
              references={data.references}
              onCreated={async (id) => {
                await refresh();
                router.push(`/contexts/${id}`);
              }}
            />
          )}
          {route === 'contexts' && path[1] !== 'new' && (
            <ContextsPage
              data={data}
              selectedId={path[1]}
              onChange={async (message) => {
                await refresh();
                setNotice(message);
              }}
            />
          )}
          {route === 'connections' && (
            <ConnectionsPage
              data={data}
              selectedId={path[1]}
              onEnd={setEnding}
              onCreated={refresh}
              requestedClient={requestedClient}
            />
          )}
          {route === 'decisions' && (
            <DecisionsPage data={data} selectedId={path[1]} onEvidence={openEvidence} />
          )}
          <div className="workspace-footnote">
            <LockKeyhole size={14} />
            <span>
              {data.execution?.qlooAvailable
                ? 'Live Qloo available. Real permission checks. '
                : 'Explicit modes. Real permission checks. '}
              <Link href="/developers">What this demo does</Link>
            </span>
          </div>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Mobile navigation">
        {nav.map((n) => (
          <Link key={n.key} href={n.href} className={route === n.key ? 'active' : ''}>
            <n.icon size={20} />
            <span>
              {n.key === 'home' ? 'Home' : n.key === 'contexts' ? 'Contexts' : 'Connections'}
            </span>
          </Link>
        ))}
      </nav>
      <ConfirmEnd
        open={!!ending}
        onOpenChange={(open) => {
          if (!open) setEnding(null);
        }}
        name={ending ? `${ending.delegateName} through ${ending.clientName}` : 'This client'}
        onConfirm={endAccess}
        busy={endBusy}
      />
      <Modal
        open={privacy}
        onOpenChange={setPrivacy}
        title="Your demo space, clearly owned."
        description="You are acting as Mira, the example recipient. This browser controls this isolated owner workspace."
      >
        <div className="retention-card">
          <Clock3 size={22} />
          <div>
            <strong>A temporary space for a real flow.</strong>
            <p>
              {data.owner.retentionNotice ??
                'This isolated demonstration stores your approved contexts, invitations, decisions, and saved choices.'}
            </p>
            {data.owner.expiresAt && (
              <p className="field-note">Workspace expires {prettyTime(data.owner.expiresAt)}.</p>
            )}
          </div>
        </div>
        <p className="field-note">
          The client apps use separate sessions. Invitation claims identify a role in this demo;
          they do not verify a real person. Deleting this space ends its authorizations and removes
          its stored records. Previously shared results cannot be recalled.
        </p>
        <label className="checkbox-line delete-ack">
          <input
            type="checkbox"
            checked={deleteAck}
            onChange={(event) => setDeleteAck(event.target.checked)}
          />
          <span>Delete this demo workspace and end all its connections.</span>
        </label>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setPrivacy(false)}>
            Keep exploring
          </Button>
          <Button variant="danger" busy={deleting} disabled={!deleteAck} onClick={deleteWorkspace}>
            <Trash2 size={16} /> Delete demo workspace
          </Button>
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="owner-session-exit">
          <p>
            Leaving signs out this browser. Existing invitations and records remain until expiry.
            This demo has no account recovery; use deletion above to erase the space and end its
            connections.
          </p>
          <Button variant="ghost" busy={signingOut} onClick={endOwnerSession}>
            End this owner session <ArrowUpRight size={15} />
          </Button>
        </div>
      </Modal>
      <EvidenceDrawer open={journal} onOpenChange={setJournal} title="Your access journal">
        <div className="evidence-callout">
          This is an audit of permission and actions. It is not a measurement of recommendation
          quality.
        </div>
        {data.events.map((event) => (
          <div className="journal-entry" key={event.id}>
            <span className="journal-dot" />
            <div>
              <strong>
                {(
                  {
                    'workspace.created': 'Your isolated space was created',
                    'invitation.created': 'An invitation was approved',
                    'invitation.claimed': 'An invitation was claimed',
                    'decision.queued': 'A choice was requested',
                    'decision.prepared': 'Candidate results were prepared',
                    'decision.released': 'A result passed the release check',
                    'selection.saved': 'A choice was kept',
                    'grant.revoked': 'Access was ended',
                    'context.corrected': 'A context was corrected',
                    'decision.stopped': 'A request was stopped',
                  } as Record<string, string>
                )[event.action] ?? event.action}
              </strong>
              <time>{prettyTime(event.createdAt)}</time>
              <code>{JSON.stringify(event.detail)}</code>
            </div>
          </div>
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            void refresh().catch((e) =>
              setError(e instanceof Error ? e.message : 'Could not refresh the journal.'),
            )
          }
        >
          Refresh journal <RefreshCw size={15} />
        </Button>
      </EvidenceDrawer>
      <EvidenceDrawer
        open={!!evidence}
        onOpenChange={(open) => {
          if (!open) setEvidence(null);
        }}
        title="The story behind this choice"
      >
        {evidenceLoading ? (
          <p role="status">Loading the permission receipt…</p>
        ) : (
          evidence && <EvidenceBody evidence={evidence} />
        )}
      </EvidenceDrawer>
    </div>
  );
}

function HomePage({ data, onEvidence }: { data: WorkspaceData; onEvidence: (id: string) => void }) {
  return (
    <>
      <div className="greeting">
        <span>YOUR SPACE, AT A GLANCE</span>
        <span>
          <Leaf size={13} /> A little care goes a long way
        </span>
      </div>
      <section className="workspace-hero">
        <div className="hero-copy">
          <div className="hero-eyebrow">
            <span /> FOR THE PEOPLE WHO GET YOU
          </div>
          <h1>
            Good gifts begin
            <br />
            with a little <em>context.</em>
          </h1>
          <p>
            A few things you love. A person you trust.
            <br />
            Help them find something that feels like you.
          </p>
          <Link href="/gifts/new" className="button button-primary">
            <Gift size={17} /> Make a gift invitation <ArrowRight size={17} />
          </Link>
          <div className="hero-assurance">
            <ShieldCheck size={15} />
            <span>Your references stay out of the giver’s results.</span>
          </div>
        </div>
        <div className="hero-art">
          <span className="handwritten">thoughtfulness, wrapped up</span>
          <GiftArt />
        </div>
      </section>
      <div className="journey-strip" aria-label="The gift journey">
        <div>
          <span>01</span>
          <p>
            <strong>You set the scope</strong>Choose references for this occasion.
          </p>
        </div>
        <ArrowRight size={16} aria-hidden="true" />
        <div>
          <span>02</span>
          <p>
            <strong>They discover a gift</strong>Public choices, with your references kept private.
          </p>
        </div>
        <ArrowRight size={16} aria-hidden="true" />
        <div>
          <span>03</span>
          <p>
            <strong>You stay in control</strong>Correct a reference or end future access.
          </p>
        </div>
      </div>
      <section className="dashboard-section">
        <div className="section-row">
          <div>
            <span className="eyebrow">ROOM FOR EVERY SIDE OF YOU</span>
            <h2>Your taste, in context</h2>
          </div>
          <Link href="/contexts" className="text-link">
            View all contexts <ArrowRight size={16} />
          </Link>
        </div>
        <div className="context-grid">
          {data.contexts.slice(0, 2).map((context) => (
            <ContextCard
              key={context.id}
              context={context}
              grants={
                data.grants.filter((g) => g.contextId === context.id && g.status === 'active')
                  .length
              }
            />
          ))}
        </div>
      </section>
      <section className="dashboard-section">
        <div className="section-row">
          <div>
            <span className="eyebrow">THREE WAYS TO MAKE A GOOD CHOICE</span>
            <h2>Bring your taste along</h2>
          </div>
          <Badge>Reference clients</Badge>
        </div>
        <div className="client-card-grid">
          {(Object.keys(CLIENTS) as ClientId[]).map((id, index) => (
            <Link
              key={id}
              href={`/connections?client=${id}`}
              className={`client-card client-card-${id}`}
            >
              <span className="client-card-number">0{index + 1}</span>
              <ClientEmblem clientId={id} large />
              <h3>{CLIENTS[id].name}</h3>
              <p>{CLIENTS[id].description}</p>
              <span className="client-card-action">
                {id === 'books'
                  ? 'Find your next chapter'
                  : id === 'media'
                    ? 'Settle in for something good'
                    : 'Make an afternoon of it'}
                <ArrowUpRight size={17} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="dashboard-section recent-section">
        <div className="section-row">
          <div>
            <span className="eyebrow">THINGS WORTH KEEPING</span>
            <h2>Recent choices</h2>
          </div>
          <Link className="text-link" href="/decisions">
            View history <ArrowRight size={15} />
          </Link>
        </div>
        {data.decisions.length === 0 ? (
          <div className="recent-empty">
            <div className="book-outline">
              <BookOpen size={27} />
            </div>
            <div>
              <h3>Something lovely belongs here.</h3>
              <p>Your choices and their permission receipts will gather here as you explore.</p>
            </div>
            <Link href="/connections" className="text-link">
              Make a first choice <ArrowRight size={16} />
            </Link>
          </div>
        ) : (
          <div className="recent-list">
            {data.decisions.slice(0, 3).map((decision) => (
              <DecisionRow key={decision.id} decision={decision} onEvidence={onEvidence} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
function ContextCard({ context, grants }: { context: Context; grants: number }) {
  const selected = context.signals.filter((s) => s.active);
  return (
    <Link className="context-card" href={`/contexts/${context.id}`}>
      <ContextArt kind={context.purpose} />
      <div className="context-card-content">
        <div className="context-card-heading">
          <span className="context-kind">
            {context.purpose === 'gift' ? <Gift size={15} /> : <Heart size={15} />}{' '}
            {contextLabel(context)}
          </span>
          <ArrowUpRight size={19} />
        </div>
        <h3>{context.name}</h3>
        <p>
          {context.purpose === 'gift'
            ? 'For thoughtful surprises, with a little privacy.'
            : 'The things you come back to, just for you.'}
        </p>
        <div className="context-card-footer">
          <div className="tiny-reference-stack">
            {selected.slice(0, 3).map((s) => (
              <ReferenceArt key={s.id} id={s.id} />
            ))}
          </div>
          <span>{selected.length} references</span>
          <span className="context-connections">
            <span />
            {grants === 0 ? 'Only you' : `${grants} connection${grants > 1 ? 's' : ''}`}
          </span>
        </div>
      </div>
    </Link>
  );
}
function DecisionRow({
  decision,
  onEvidence,
}: {
  decision: Decision;
  onEvidence: (id: string) => void;
}) {
  return (
    <div className="decision-row">
      <ClientEmblem clientId={decision.clientId} />
      <div>
        <strong>
          {decision.items[0]?.title ??
            (decision.errorCode ? 'A request was stopped' : 'A choice is being prepared')}
        </strong>
        <span>
          {CLIENTS[decision.clientId].name} · {decision.contextName}
        </span>
      </div>
      <Badge tone={decision.stale ? 'amber' : decision.state === 'released' ? 'green' : 'neutral'}>
        {decision.stale
          ? 'Earlier context'
          : decision.state === 'released'
            ? 'Ready'
            : decision.state.replaceAll('_', ' ')}
      </Badge>
      <button className="text-button" onClick={() => onEvidence(decision.id)}>
        View receipt <ArrowUpRight size={15} />
      </button>
    </div>
  );
}

function GiftWizard({ data, onCreated }: { data: WorkspaceData; onCreated: () => Promise<void> }) {
  const contexts = data.contexts.filter((c) => c.purpose === 'gift');
  const [contextId, setContextId] = useState(contexts[0]?.id ?? '');
  const context = contexts.find((c) => c.id === contextId);
  const [step, setStep] = useState(1);
  const [signals, setSignals] = useState(
    context?.signals.filter((s) => s.active).map((s) => s.id) ?? [],
  );
  const [name, setName] = useState('Alex');
  const [hours, setHours] = useState(24);
  const [limit, setLimit] = useState(3);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{
    id: string;
    claimUrl: string;
    expiresAt: string;
    clientName: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  async function create() {
    if (!context) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<NonNullable<typeof created>>('invitations', {
        contextId: context.id,
        clientId: 'books',
        purpose: 'gift',
        signalIds: signals,
        expiresInHours: hours,
        requestLimit: limit,
        snapshotMode: 'pinned',
        delegateName: name,
        acknowledged: ack,
      });
      setCreated(result);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create invitation.');
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.claimUrl);
      setCopied(true);
    } catch {
      setError(
        'Clipboard access is unavailable. Use the invitation button to open the giver’s separate session.',
      );
    }
  }
  if (created)
    return (
      <div className="invitation-success">
        <span className="success-seal">
          <CheckCheck size={28} />
        </span>
        <span className="eyebrow">A LITTLE THOUGHT, READY TO SHARE</span>
        <h1>Your invitation is ready.</h1>
        <p>
          {name} can choose a book through The Reading Room, with only the permission you reviewed.
        </p>
        <div className="invitation-ticket">
          <div className="ticket-top">
            <Mark />
            <Badge tone="blue">One person · one client</Badge>
          </div>
          <h2>
            A little something,
            <br />
            <em>just for you.</em>
          </h2>
          <div className="ticket-detail">
            <span>FOR</span>
            <strong>{name}</strong>
            <span>FROM</span>
            <strong>Mira’s Gift context</strong>
          </div>
          <div className="ticket-foot">
            <Clock3 size={15} />
            <span>Ends {prettyTime(created.expiresAt)}</span>
          </div>
        </div>
        <div className="success-actions">
          <Button onClick={copy} variant="secondary">
            {copied ? <Check size={17} /> : <Copy size={17} />}{' '}
            {copied ? 'Invitation copied' : 'Copy invitation'}
          </Button>
          <a
            className="button button-primary"
            href={created.claimUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open as {name} <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="roleplay-note">
          <ShieldCheck size={18} />
          <p>
            <strong>You’re trying both sides of an isolated demo.</strong> Opening the invitation
            switches to a separate client session as the example giver. It does not verify a real
            person’s identity.
          </p>
        </div>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <Link href={`/connections/${created.id}`} className="text-link">
          Manage this invitation <ArrowRight size={15} />
        </Link>
      </div>
    );
  return (
    <>
      <PageIntro
        eyebrow="A THOUGHTFUL GIFT"
        title="A good surprise starts here."
        description="You choose the context. They discover the gift. A small invitation, with clear boundaries."
      />
      <div className="wizard-steps" aria-label={`Step ${step} of 3`}>
        {['Choose a little context', 'Make the invitation', 'Review & allow'].map(
          (label, index) => (
            <div
              key={label}
              className={step >= index + 1 ? 'current' : ''}
              aria-current={step === index + 1 ? 'step' : undefined}
            >
              <span>{step > index + 1 ? <Check size={15} /> : index + 1}</span>
              <strong>{label}</strong>
            </div>
          ),
        )}
      </div>
      <p className="sr-only" role="status">
        Step {step} of 3:{' '}
        {step === 1
          ? 'Choose a little context'
          : step === 2
            ? 'Make the invitation'
            : 'Review and allow'}
        .
      </p>
      <div className="wizard-layout">
        <div className="wizard-main">
          <div className="panel">
            <span className="eyebrow">0{step} / 03</span>
            <h2>
              {step === 1
                ? 'What may guide this gift?'
                : step === 2
                  ? 'Who is this invitation for?'
                  : 'A little permission. Clearly given.'}
            </h2>
            {!context ? (
              <Empty
                icon={<Gift size={24} />}
                title="Make a gift context first"
                description="A gift starts with references chosen by the recipient."
                action={
                  <Link href="/contexts/new" className="button button-primary">
                    Create a context
                  </Link>
                }
              />
            ) : (
              <>
                {step === 1 && (
                  <>
                    <p className="muted">
                      Choose which references this connection may use. These titles stay out of the
                      giver’s results.
                    </p>
                    <label className="field-label" htmlFor="gift-context">
                      Gift context
                    </label>
                    <select
                      id="gift-context"
                      value={contextId}
                      onChange={(e) => {
                        setContextId(e.target.value);
                        setSignals(
                          contexts
                            .find((c) => c.id === e.target.value)
                            ?.signals.filter((s) => s.active)
                            .map((s) => s.id) ?? [],
                        );
                      }}
                    >
                      {contexts.map((c) => (
                        <option value={c.id} key={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <div className="reference-selection">
                      {context.signals
                        .filter((s) => s.active)
                        .map((signal) => (
                          <label
                            className={`reference-choice ${signals.includes(signal.id) ? 'selected' : ''}`}
                            key={signal.id}
                          >
                            <input
                              type="checkbox"
                              checked={signals.includes(signal.id)}
                              onChange={(e) =>
                                setSignals(
                                  e.target.checked
                                    ? [...signals, signal.id]
                                    : signals.filter((id) => id !== signal.id),
                                )
                              }
                            />
                            <ReferenceArt id={signal.id} />
                            <span>
                              <strong>{signal.title}</strong>
                              <small>{signal.subtitle}</small>
                            </span>
                            <span className="custom-check">
                              {signals.includes(signal.id) && <Check size={15} />}
                            </span>
                          </label>
                        ))}
                    </div>
                    <p className="field-note">
                      {signals.length} of 10 permitted references selected. Choose the exact
                      references for this invitation.
                    </p>
                    {signals.length > 10 && (
                      <p className="inline-error" role="alert">
                        Select at most 10 references before continuing. None will be dropped for
                        you.
                      </p>
                    )}
                  </>
                )}
                {step === 2 && (
                  <>
                    <p className="muted">
                      This isolated demo uses an example giver. You remain the example recipient,
                      Mira.
                    </p>
                    <label className="field-label" htmlFor="delegate-name">
                      Giver’s display name
                    </label>
                    <input
                      id="delegate-name"
                      maxLength={40}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="off"
                    />
                    <div className="form-grid">
                      <div>
                        <label className="field-label" htmlFor="expiry">
                          Invitation duration
                        </label>
                        <select
                          id="expiry"
                          value={hours}
                          onChange={(e) => setHours(Number(e.target.value))}
                        >
                          <option value={1}>1 hour</option>
                          <option value={4}>4 hours</option>
                          <option value={24}>24 hours</option>
                        </select>
                      </div>
                      <div>
                        <label className="field-label" htmlFor="choices">
                          Recommendation requests
                        </label>
                        <select
                          id="choices"
                          value={limit}
                          onChange={(e) => setLimit(Number(e.target.value))}
                        >
                          <option value={1}>1 request</option>
                          <option value={3}>Up to 3 requests</option>
                          <option value={10}>Up to 10 requests</option>
                        </select>
                      </div>
                    </div>
                    <div className="connected-client">
                      <ClientEmblem clientId="books" />
                      <div>
                        <strong>The Reading Room</strong>
                        <span>Book suggestions · a fixed, named inventory</span>
                      </div>
                      <LockKeyhole size={17} />
                    </div>
                    <div className="inset-note">
                      <BookOpen size={19} />
                      <p>
                        The invitation is pinned to this catalog. New catalogs or editions need a
                        new permission review.
                      </p>
                    </div>
                  </>
                )}
                {step === 3 && (
                  <>
                    <div className="consent-statement">
                      <span className="quote-mark">“</span>
                      <p>
                        <strong>{name}</strong> may receive book suggestions from{' '}
                        <strong>{context.name}</strong> through <strong>The Reading Room</strong>{' '}
                        for up to{' '}
                        <strong>
                          {hours} hour{hours > 1 ? 's' : ''}
                        </strong>
                        , with{' '}
                        <strong>
                          {limit} request{limit > 1 ? 's' : ''}
                        </strong>
                        .
                      </p>
                    </div>
                    <div className="consent-grid">
                      <div>
                        <span className="mini-label">WHAT CAN GUIDE THE CHOICE</span>
                        {context.signals
                          .filter((s) => signals.includes(s.id))
                          .map((s) => (
                            <CheckLine key={s.id}>{s.title}</CheckLine>
                          ))}
                      </div>
                      <div>
                        <span className="mini-label">WHAT {name.toUpperCase()} CAN SEE</span>
                        <CheckLine>Titles, creators & public descriptions</CheckLine>
                        <CheckLine>Public source links & illustrative amounts</CheckLine>
                        <CheckLine>A permission receipt, without references</CheckLine>
                        <CheckLine>Generic explanations from public item facts</CheckLine>
                      </div>
                    </div>
                    <div className="provider-consent">
                      <span className="mini-label">HOW THE PROVIDERS HELP</span>
                      <p>
                        In live mode, Qloo receives your approved cultural IDs and candidate IDs to
                        find affinity. When AI explanations are enabled, the AI provider receives
                        public catalog facts and the giver’s brief. Your private references and
                        profile are excluded from the AI prompt.
                      </p>
                    </div>
                    <div className="privacy-statement">
                      <LockKeyhole size={19} />
                      <p>
                        Your references and private evidence are excluded from the giver’s results.
                        Suggestions may still reveal something about your tastes. Results already
                        shared cannot be recalled.
                      </p>
                    </div>
                    <label className="checkbox-line">
                      <input
                        type="checkbox"
                        checked={ack}
                        onChange={(e) => setAck(e.target.checked)}
                      />
                      <span>I understand this scope and allow this gift invitation.</span>
                    </label>
                  </>
                )}
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="wizard-actions">
                  {step > 1 ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setAck(false);
                        setStep(step - 1);
                      }}
                    >
                      Back
                    </Button>
                  ) : (
                    <span className="field-note">
                      <LockKeyhole size={13} /> Only you can approve this.
                    </span>
                  )}
                  {step < 3 ? (
                    <Button
                      onClick={() => {
                        setAck(false);
                        setStep(step + 1);
                      }}
                      disabled={
                        step === 1 ? signals.length === 0 || signals.length > 10 : !name.trim()
                      }
                    >
                      Continue <ArrowRight size={16} />
                    </Button>
                  ) : (
                    <Button onClick={create} busy={busy} disabled={!ack}>
                      <Gift size={16} /> Create invitation
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <aside className="wizard-aside">
          <GiftArt compact />
          <h3>
            A choice with a reason.
            <br />
            <em>A profile kept private.</em>
          </h3>
          <p>
            The giver gets a small selection of books. You keep control of what can guide the next
            choice.
          </p>
          <div className="aside-rule" />
          <CheckLine>One context, one client</CheckLine>
          <CheckLine>Exactly the references you choose</CheckLine>
          <CheckLine>Yours to end at any time</CheckLine>
          <span className="sample-label">ISOLATED ROLE-PLAY · NO REAL IDENTITY VERIFICATION</span>
        </aside>
      </div>
    </>
  );
}

function ContextsPage({
  data,
  selectedId,
  onChange,
}: {
  data: WorkspaceData;
  selectedId?: string;
  onChange: (message: string) => Promise<void>;
}) {
  const router = useRouter();
  const [correcting, setCorrecting] = useState<{ context: Context; signal: Signal } | null>(null);
  const [reason, setReason] = useState<CorrectionInput['reason']>('no_longer_interested');
  const [preview, setPreview] = useState<{
    remaining: number;
    affected: { clientName: string }[];
    nextRevision: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseAck, setEraseAck] = useState(false);
  const [eraseBusy, setEraseBusy] = useState(false);
  const [referenceSearchOpen, setReferenceSearchOpen] = useState(false);
  const context = data.contexts.find((c) => c.id === selectedId);
  async function eraseContext() {
    if (!context) return;
    setEraseBusy(true);
    setError('');
    try {
      await api(`contexts/${context.id}`, undefined, 'DELETE');
      await onChange(
        `Deleted ${context.name}. Its future requests are blocked. Other contexts were not changed.`,
      );
      setErasing(false);
      router.push('/contexts');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete this context.');
    } finally {
      setEraseBusy(false);
    }
  }
  const request = () => ({
    contextId: correcting!.context.id,
    expectedRevision: correcting!.context.revision,
    removeSignalIds: [correcting!.signal.id],
    reason,
  });
  async function checkCorrection() {
    setBusy(true);
    setError('');
    try {
      setPreview(await api('corrections/preview', request()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preview this correction.');
      setConflict(e instanceof WorkspaceError && e.code === 'CORRECTION_CONFLICT');
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError('');
    try {
      await api('corrections', request());
      const label = correcting!.context.purpose === 'personal' ? 'Personal' : 'Gift';
      await onChange(
        `Updated ${label}. ${label === 'Personal' ? 'Gift' : 'Personal'} was not changed. Future choices use the revised context.`,
      );
      setCorrecting(null);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply this correction.');
      setConflict(e instanceof WorkspaceError && e.code === 'CORRECTION_CONFLICT');
    } finally {
      setBusy(false);
    }
  }
  function begin(c: Context, signal: Signal) {
    setCorrecting({ context: c, signal });
    setPreview(null);
    setError('');
    setConflict(false);
  }
  return (
    <>
      {!context ? (
        <>
          <PageIntro
            eyebrow="TASTE CONTEXTS"
            title="A space for every side of you."
            description="Keep the everyday, the occasional, and the gift-worthy in their own spaces. A connection can use only the one you approve."
            action={
              <Link href="/contexts/new" className="button button-primary">
                <Plus size={16} /> New context
              </Link>
            }
          />
          <div className="context-grid">
            {data.contexts.map((c) => (
              <ContextCard
                key={c.id}
                context={c}
                grants={
                  data.grants.filter((g) => g.contextId === c.id && g.status === 'active').length
                }
              />
            ))}
          </div>
          <div className="wide-note">
            <Layers3 size={23} />
            <div>
              <h3>Different moments deserve different context.</h3>
              <p>
                Correcting one space never silently edits another. New references do not expand an
                existing permission.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <Link href="/contexts" className="back-link">
            ← All contexts
          </Link>
          <PageIntro
            eyebrow={`${contextLabel(context).toUpperCase()} / REVISION ${context.revision}`}
            title={context.name}
            description={
              context.purpose === 'gift'
                ? 'A recipient-owned space for thoughtful surprises. You choose which references each invitation may use.'
                : 'The cultural references you return to. These guide choices; they are not a personality diagnosis.'
            }
            action={
              <Link
                href={context.purpose === 'gift' ? '/gifts/new' : '/connections'}
                className="button button-primary"
              >
                {context.purpose === 'gift' ? <Gift size={16} /> : <Link2 size={16} />}{' '}
                {context.purpose === 'gift' ? 'Make an invitation' : 'Allow a connection'}
              </Link>
            }
          />
          <div className="context-detail-layout">
            <section className="panel">
              <div className="section-row">
                <h2>What this context uses</h2>
                <div className="reference-section-actions">
                  <Badge>{context.signals.filter((s) => s.active).length} active references</Badge>
                  <Button variant="secondary" onClick={() => setReferenceSearchOpen(true)}>
                    <Plus size={16} /> Find a reference
                  </Button>
                </div>
              </div>
              <p className="muted">
                These references guide future queries. Preview each correction before applying it;
                no feedback silently edits your context.
              </p>
              <div className="reference-detail-list">
                {context.signals.map((signal) => (
                  <article
                    key={signal.id}
                    className={`reference-detail ${signal.active ? '' : 'is-removed'}`}
                  >
                    <ReferenceArt id={signal.id} />
                    <div>
                      <strong>{signal.title}</strong>
                      <span>{signal.subtitle}</span>
                      <small>
                        {signal.active
                          ? data.references?.find((reference) => reference.id === signal.id)
                              ?.verified
                            ? 'Reviewed Qloo identity'
                            : signal.entityId.startsWith('sample:')
                              ? 'Authored example reference'
                              : 'Owner-confirmed cultural identity'
                          : 'Removed from future decisions'}
                      </small>
                    </div>
                    {signal.active ? (
                      <button
                        className="text-button correct-button"
                        onClick={() => begin(context, signal)}
                      >
                        Correct this <RefreshCw size={15} />
                      </button>
                    ) : (
                      <Badge>Removed</Badge>
                    )}
                  </article>
                ))}
              </div>
            </section>
            <aside className="context-detail-aside">
              <div className="scope-card">
                <ShieldCheck size={25} />
                <h3>Context stays in its lane.</h3>
                <p>
                  {contextLabel(context)} is separate from{' '}
                  {context.purpose === 'gift' ? 'Personal' : 'Gift'}. A correction here changes only
                  future choices using this space.
                </p>
                <div className="scope-metric">
                  <span>CURRENT REVISION</span>
                  <strong>0{context.revision}</strong>
                </div>
                <div className="scope-metric">
                  <span>ACTIVE CONNECTIONS</span>
                  <strong>
                    {
                      data.grants.filter((g) => g.contextId === context.id && g.status === 'active')
                        .length
                    }
                  </strong>
                </div>
              </div>
              <div className="inset-note">
                <LockKeyhole size={18} />
                <p>
                  References remain in your owner workspace. The gift client receives public
                  candidate results.
                </p>
              </div>
              <button
                className="text-button danger-text context-delete"
                onClick={() => {
                  setEraseAck(false);
                  setError('');
                  setErasing(true);
                }}
              >
                <Trash2 size={15} /> Delete this context
              </button>
            </aside>
          </div>
          {data.decisions.some((decision) => decision.contextId === context.id) && (
            <section className="panel context-history">
              <div className="section-row">
                <div>
                  <span className="eyebrow">A CONTEXT WITH A HISTORY</span>
                  <h2>Choices across revisions</h2>
                </div>
                <Link href="/decisions" className="text-link">
                  View all choices <ArrowRight size={15} />
                </Link>
              </div>
              <p className="muted">
                Earlier choices remain visible. A new request uses the current references and
                repeats authorization.
              </p>
              {data.decisions
                .filter((decision) => decision.contextId === context.id)
                .slice(0, 4)
                .map((decision) => (
                  <Link
                    className="revision-decision"
                    key={decision.id}
                    href={`/decisions/${decision.id}`}
                  >
                    <span className={`revision-marker ${decision.stale ? 'is-stale' : ''}`}>
                      v{decision.contextRevision}
                    </span>
                    <span>
                      <strong>
                        {decision.items[0]?.title ?? 'A request without a released choice'}
                      </strong>
                      <small>
                        {CLIENTS[decision.clientId].name} · {prettyTime(decision.createdAt)}
                      </small>
                    </span>
                    <Badge tone={decision.stale ? 'amber' : 'green'}>
                      {decision.stale ? 'Earlier context' : 'Current context'}
                    </Badge>
                    <ArrowUpRight size={16} />
                  </Link>
                ))}
            </section>
          )}
        </>
      )}
      <Modal
        open={!!correcting}
        onOpenChange={(open) => {
          if (!open) setCorrecting(null);
        }}
        title={preview ? 'Review this correction' : 'What should change?'}
        description={
          preview
            ? 'Nothing changes until you apply this correction to the selected context.'
            : 'Feedback is a choice, not a silent update to your profile.'
        }
      >
        {correcting && (
          <>
            {!preview ? (
              <>
                <div className="correction-reference">
                  <ReferenceArt id={correcting.signal.id} />
                  <div>
                    <span className="mini-label">REFERENCE TO REMOVE</span>
                    <strong>{correcting.signal.title}</strong>
                    <span>{correcting.context.name}</span>
                  </div>
                </div>
                <label className="field-label" htmlFor="correction-reason">
                  What feels wrong?
                </label>
                <select
                  id="correction-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value as CorrectionInput['reason'])}
                >
                  <option value="no_longer_interested">I’m no longer interested</option>
                  <option value="wrong_reference">This is the wrong reference</option>
                  <option value="wrong_situation">It doesn’t fit this situation</option>
                  <option value="already_know_it">I don’t want it to guide more choices</option>
                </select>
                <p className="field-note">
                  This removes the reference from future choices in this context. It does not
                  replace it with an unapproved signal.
                </p>
              </>
            ) : (
              <>
                <div className="correction-preview">
                  <Badge tone="amber">
                    Revision {correcting.context.revision} → {preview.nextRevision}
                  </Badge>
                  <h3>Remove “{correcting.signal.title}”</h3>
                  <p>
                    {preview.remaining} active reference{preview.remaining !== 1 ? 's' : ''} will
                    remain in <strong>{correcting.context.name}</strong>.
                  </p>
                  <CheckLine>Future choices use the new revision.</CheckLine>
                  <CheckLine>Earlier decisions are marked as earlier context.</CheckLine>
                  <CheckLine>
                    {correcting.context.purpose === 'personal' ? 'Gift' : 'Personal'} remains
                    unchanged.
                  </CheckLine>
                  <div className="correction-query-preview">
                    <span className="mini-label">THE NEXT QUERY</span>
                    <p>
                      <strong>Remove:</strong> {correcting.signal.title}
                    </p>
                    <p>
                      <strong>Keep:</strong> the same approved client, purpose, catalog, and public
                      output fields.
                    </p>
                    <small>
                      The next choice can change. This preview does not predict the provider’s
                      result.
                    </small>
                  </div>
                  {preview.remaining === 0 && (
                    <p className="inline-error">
                      Connected clients will need a new permission with active references before
                      they can make another choice.
                    </p>
                  )}
                  {preview.affected.length > 0 && (
                    <p className="field-note">
                      Affected connections: {preview.affected.map((a) => a.clientName).join(', ')}.
                    </p>
                  )}
                </div>
              </>
            )}
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <div className="dialog-actions">
              <Button variant="secondary" onClick={() => setCorrecting(null)}>
                Keep it as it is
              </Button>
              {conflict ? (
                <Button
                  onClick={async () => {
                    setCorrecting(null);
                    await onChange(
                      'The context was refreshed. Review the latest revision before correcting it.',
                    );
                  }}
                >
                  Review latest context <RefreshCw size={16} />
                </Button>
              ) : (
                <Button busy={busy} onClick={preview ? apply : checkCorrection}>
                  {preview ? 'Apply to this context' : 'Preview correction'}{' '}
                  <ArrowRight size={16} />
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
      {context && (
        <ReferenceSearch
          key={context.id}
          open={referenceSearchOpen}
          onOpenChange={setReferenceSearchOpen}
          context={context}
          available={
            data.execution?.referenceSearchAvailable ?? data.execution?.qlooAvailable ?? false
          }
          onChanged={onChange}
        />
      )}
      <Modal
        open={erasing}
        onOpenChange={setErasing}
        title="Delete this taste context?"
        description="Its references, saved choices, and stored decision content will be erased. Future requests through its connections will be blocked. Other contexts stay as they are."
      >
        <p className="field-note">
          Previously shared results and provider-side records cannot be recalled. This action cannot
          be undone.
        </p>
        <label className="checkbox-line delete-ack">
          <input
            type="checkbox"
            checked={eraseAck}
            onChange={(event) => setEraseAck(event.target.checked)}
          />
          <span>Delete {context?.name ?? 'this context'} and end its future access.</span>
        </label>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setErasing(false)}>
            Keep this context
          </Button>
          <Button variant="danger" busy={eraseBusy} disabled={!eraseAck} onClick={eraseContext}>
            <Trash2 size={16} /> Delete context
          </Button>
        </div>
      </Modal>
    </>
  );
}

function NewContext({
  references,
  onCreated,
}: {
  references?: ReviewedReference[];
  onCreated: (id: string) => Promise<void>;
}) {
  const library: readonly ReviewedReference[] = references ?? REFERENCE_CHOICES;
  const [name, setName] = useState('A few favourites');
  const [purpose, setPurpose] = useState<'personal' | 'gift'>('personal');
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const results = useMemo(
    () =>
      library.filter(
        (r) =>
          (type === 'all' || r.type === type) &&
          `${r.title} ${r.subtitle}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, type, library],
  );
  async function create() {
    setBusy(true);
    try {
      const result = await api<{ id: string }>('contexts', {
        name,
        purpose,
        referenceIds: selected,
      });
      await onCreated(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your context.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link href="/contexts" className="back-link">
        ← Taste contexts
      </Link>
      <PageIntro
        eyebrow="MAKE IT YOURS"
        title={review ? 'These are the ones you mean.' : 'What do you return to?'}
        description={
          review
            ? 'Confirm the exact titles, creators, and places before you add them to this context.'
            : 'A book you linger over. A film you return to. A place that stays with you. Start with a few cultural references.'
        }
      />
      <div className="new-context-layout">
        <section className="panel">
          <div className="form-grid">
            <div>
              <label className="field-label" htmlFor="context-name">
                Name this space
              </label>
              <input
                id="context-name"
                value={name}
                maxLength={50}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="context-purpose">
                Its purpose
              </label>
              <select
                id="context-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as 'personal' | 'gift')}
              >
                <option value="personal">Personal choices</option>
                <option value="gift">A gift, for me</option>
              </select>
            </div>
          </div>
          {!review ? (
            <>
              <label className="field-label" htmlFor="reference-search">
                Find a reference in the quickstart library
              </label>
              <input
                id="reference-search"
                type="search"
                placeholder="A title, creator, or place…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="filter-tabs" aria-label="Reference types">
                {[
                  ['all', 'All'],
                  ['book', 'Books'],
                  ['movie', 'Films'],
                  ['artist', 'Artists'],
                  ['place', 'Places'],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={type === value ? 'active' : ''}
                    aria-pressed={type === value}
                    onClick={() => setType(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="reference-library">
                {results.map((r) => (
                  <button
                    className={`reference-library-card ${selected.includes(r.id) ? 'selected' : ''}`}
                    key={r.id}
                    onClick={() =>
                      setSelected(
                        selected.includes(r.id)
                          ? selected.filter((id) => id !== r.id)
                          : [...selected, r.id],
                      )
                    }
                    aria-pressed={selected.includes(r.id)}
                    disabled={!selected.includes(r.id) && selected.length >= 10}
                  >
                    <ReferenceArt id={r.id} />
                    <strong>{r.title}</strong>
                    <span>{r.subtitle}</span>
                    <span className={`reference-verification ${r.verified ? 'verified' : ''}`}>
                      {r.verified ? 'Reviewed Qloo identity' : 'Authored example identity'}
                    </span>
                    <span className="library-add">
                      {selected.includes(r.id) ? (
                        <>
                          <Check size={15} /> Selected
                        </>
                      ) : (
                        <>
                          <Plus size={15} /> Choose this one
                        </>
                      )}
                    </span>
                  </button>
                ))}
              </div>
              {results.length === 0 && (
                <Empty
                  icon={<BookOpen size={24} />}
                  title="No match in this reviewed library"
                  description="Try another title or clear your search. This is a bounded library of reviewed identities; it does not search every Qloo entity."
                />
              )}
            </>
          ) : (
            <div className="reference-detail-list">
              {library
                .filter((r) => selected.includes(r.id))
                .map((r) => (
                  <div className="reference-detail" key={r.id}>
                    <ReferenceArt id={r.id} />
                    <div>
                      <strong>{r.title}</strong>
                      <span>{r.subtitle}</span>
                    </div>
                    <Check size={20} />
                  </div>
                ))}
            </div>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <div className="wizard-actions">
            <span className="field-note">{selected.length} of 10 references selected</span>
            {review ? (
              <>
                <Button variant="secondary" onClick={() => setReview(false)}>
                  Change selection
                </Button>
                <Button busy={busy} onClick={create}>
                  Confirm & create context <Check size={16} />
                </Button>
              </>
            ) : (
              <Button
                disabled={!name.trim() || selected.length === 0}
                onClick={() => setReview(true)}
              >
                Review identities <ArrowRight size={16} />
              </Button>
            )}
          </div>
        </section>
        <aside className="scope-card">
          <Layers3 size={26} />
          <h3>
            A few things,
            <br />
            <em>clearly chosen.</em>
          </h3>
          <p>
            Start with this curated quickstart library. Reviewed Qloo identities are labeled;
            authored examples remain explicit. After creating your context, use “Find a reference”
            to search live Qloo identities when available. Nothing is added until you confirm it.
          </p>
          <CheckLine>No account scraping</CheckLine>
          <CheckLine>No inferred personal traits</CheckLine>
          <CheckLine>No client access until you approve it</CheckLine>
        </aside>
      </div>
    </>
  );
}

function ConnectionsPage({
  data,
  selectedId,
  onEnd,
  onCreated,
  requestedClient,
}: {
  data: WorkspaceData;
  selectedId?: string;
  onEnd: (grant: Grant) => void;
  onCreated: () => Promise<void>;
  requestedClient?: ClientId;
}) {
  const [connecting, setConnecting] = useState<ClientId | null>(requestedClient ?? null);
  const [contextId, setContextId] = useState(
    data.contexts.find((c) => c.purpose === 'personal')?.id ?? '',
  );
  const context = data.contexts.find((c) => c.id === contextId);
  const [signals, setSignals] = useState(
    context?.signals.filter((s) => s.active).map((s) => s.id) ?? [],
  );
  const [follow, setFollow] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [claimUrl, setClaimUrl] = useState('');
  const selected = data.grants.find((g) => g.id === selectedId);
  async function allow() {
    if (!connecting || !context) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ claimUrl: string }>('invitations', {
        contextId: context.id,
        clientId: connecting,
        purpose: 'personal',
        signalIds: signals,
        expiresInHours: 24,
        requestLimit: 10,
        snapshotMode: follow ? 'follow_current' : 'pinned',
        delegateName: 'Mira',
        acknowledged: ack,
      });
      setClaimUrl(result.claimUrl);
      await onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not allow this connection.');
    } finally {
      setBusy(false);
    }
  }
  function begin(id: ClientId) {
    setConnecting(id);
    setClaimUrl('');
    setAck(false);
    setError('');
  }
  return (
    <>
      {selected ? (
        <>
          <Link className="back-link" href="/connections">
            ← All connections
          </Link>
          <PageIntro
            eyebrow="ONE CONNECTION, A CLEAR SCOPE"
            title={selected.clientName}
            description={`${selected.delegateName} · ${selected.contextName}`}
            action={<Status status={selected.status} />}
          />
          <div className="connection-details">
            <section className="panel">
              <div className="connected-client">
                <ClientEmblem clientId={selected.clientId} large />
                <div>
                  <h2>{selected.delegateName}’s permission</h2>
                  <p>
                    Grant version {selected.version} · {selected.scope.purposes[0]}
                  </p>
                </div>
              </div>
              <dl className="detail-list">
                <div>
                  <dt>Context</dt>
                  <dd>{selected.contextName}</dd>
                </div>
                <div>
                  <dt>References permitted</dt>
                  <dd>{selected.scope.signalIds.length} explicitly selected references</dd>
                </div>
                <div>
                  <dt>Catalog</dt>
                  <dd>
                    {selected.scope.catalogIds[0]} ·{' '}
                    {selected.scope.snapshotMode === 'pinned'
                      ? 'fixed snapshot'
                      : 'future updates allowed'}
                  </dd>
                </div>
                <div>
                  <dt>Public fields</dt>
                  <dd>Title, creator, description, source link, illustrative amount</dd>
                </div>
                <div>
                  <dt>Expires</dt>
                  <dd>{prettyTime(selected.expiresAt)}</dd>
                </div>
                <div>
                  <dt>Requests remaining</dt>
                  <dd>{selected.remainingRequests}</dd>
                </div>
              </dl>
              <div className="privacy-statement">
                <ShieldCheck size={20} />
                <p>
                  Future requests and stored-result reads repeat live authorization. Ending this
                  connection does not recall previously shared results.
                </p>
              </div>
              {['active', 'pending'].includes(selected.status) && (
                <Button variant="danger" onClick={() => onEnd(selected)}>
                  End access <X size={16} />
                </Button>
              )}
              {selected.status === 'revoked' && (
                <div className="notice">
                  <Check size={18} /> Access ended. A new invitation is required to connect again.
                </div>
              )}
            </section>
            <aside className="scope-card">
              <LockKeyhole size={26} />
              <h3>Permission is specific.</h3>
              <p>
                This grant cannot be combined with another grant to gain broader access. It
                authorizes one context, one client, and one purpose.
              </p>
              <ExternalLink href={clientOrigin(selected.clientId, data)}>
                Open {selected.clientName}
              </ExternalLink>
            </aside>
          </div>
        </>
      ) : (
        <>
          <PageIntro
            eyebrow="CONNECTIONS"
            title="Good connections. Clear boundaries."
            description="Allow a client to help with one context. See exactly what it can use, and end future access whenever you choose."
          />
          <div className="client-card-grid connection-client-grid">
            {(Object.keys(CLIENTS) as ClientId[]).map((id) => (
              <article className={`client-card client-card-${id}`} key={id}>
                <ClientEmblem clientId={id} large />
                <h3>{CLIENTS[id].name}</h3>
                <p>{CLIENTS[id].description}</p>
                <Button variant="secondary" onClick={() => begin(id)}>
                  Allow a choice <ArrowRight size={15} />
                </Button>
              </article>
            ))}
          </div>
          <section className="dashboard-section">
            <div className="section-row">
              <h2>Your invitations & permissions</h2>
              <Link href="/gifts/new" className="text-link">
                <Gift size={15} /> Make a gift invitation
              </Link>
            </div>
            {data.grants.length === 0 ? (
              <Empty
                icon={<Link2 size={25} />}
                title="A good connection starts with permission."
                description="Allow one of the clients above, or make an invitation for a gift. Nothing has access yet."
              />
            ) : (
              <div className="connection-list">
                {data.grants.map((grant) => (
                  <article className="connection-row" key={grant.id}>
                    <ClientEmblem clientId={grant.clientId} />
                    <div className="connection-row-title">
                      <Link href={`/connections/${grant.id}`}>
                        {grant.clientName} <ArrowUpRight size={14} />
                      </Link>
                      <span>
                        {grant.delegateName} · {grant.contextName}
                      </span>
                      <small>
                        {grant.remainingRequests} requests left · ends {prettyTime(grant.expiresAt)}
                      </small>
                    </div>
                    <Status status={grant.status} />
                    {['active', 'pending'].includes(grant.status) ? (
                      <button className="text-button danger-text" onClick={() => onEnd(grant)}>
                        End access <X size={14} />
                      </button>
                    ) : (
                      <span className="ended-label">
                        <LockKeyhole size={14} /> Closed
                      </span>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <div className="wide-note">
            <ShieldCheck size={24} />
            <div>
              <h3>Previously shared answers can’t be taken back.</h3>
              <p>
                Ending access blocks future requests and later reads through this gateway. It cannot
                erase screenshots, remembered results, or another service’s independent history.
              </p>
            </div>
          </div>
        </>
      )}
      <Modal
        open={!!connecting}
        onOpenChange={(open) => {
          if (!open) setConnecting(null);
        }}
        title={
          claimUrl
            ? 'This choice is permitted.'
            : `Allow ${connecting ? CLIENTS[connecting].name : 'a client'}?`
        }
        description={
          claimUrl
            ? 'The client opens in a separate local session with only this permission.'
            : 'Review the context, references, catalog, fields, and duration before you connect.'
        }
        wide
      >
        {connecting && (
          <>
            {claimUrl ? (
              <div className="connection-ready">
                <span className="success-seal">
                  <Check size={25} />
                </span>
                <h3>Your taste, with permission.</h3>
                <p>
                  The client can ask for decisions, using the selected context. Its server has its
                  own identity; references stay in the gateway.
                </p>
                <a
                  className="button button-primary"
                  href={claimUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {CLIENTS[connecting].name} <ArrowUpRight size={16} />
                </a>
                <p className="field-note">
                  Isolated role-play as Mira. No real identity verification.
                </p>
              </div>
            ) : (
              <>
                <label className="field-label" htmlFor="personal-context">
                  Personal context
                </label>
                <select
                  id="personal-context"
                  value={contextId}
                  onChange={(e) => {
                    setAck(false);
                    setContextId(e.target.value);
                    setSignals(
                      data.contexts
                        .find((c) => c.id === e.target.value)
                        ?.signals.filter((s) => s.active)
                        .map((s) => s.id) ?? [],
                    );
                  }}
                >
                  {data.contexts
                    .filter((c) => c.purpose === 'personal')
                    .map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <span className="field-label">References this client may use</span>
                <div className="compact-signal-selection">
                  {context?.signals
                    .filter((s) => s.active)
                    .map((s) => (
                      <label className="checkbox-line" key={s.id}>
                        <input
                          type="checkbox"
                          checked={signals.includes(s.id)}
                          onChange={(e) => {
                            setAck(false);
                            setSignals(
                              e.target.checked
                                ? [...signals, s.id]
                                : signals.filter((id) => id !== s.id),
                            );
                          }}
                        />
                        <span>
                          {s.title}
                          <small>{s.subtitle}</small>
                        </span>
                      </label>
                    ))}
                </div>
                <p className="field-note">{signals.length} of 10 permitted references selected.</p>
                {signals.length > 10 && (
                  <p className="inline-error" role="alert">
                    Choose the 10 references this connection may use. None will be dropped
                    automatically.
                  </p>
                )}
                <dl className="consent-summary">
                  <div>
                    <dt>Purpose</dt>
                    <dd>A personal {CLIENTS[connecting].type} choice</dd>
                  </div>
                  <div>
                    <dt>Catalog</dt>
                    <dd>{CLIENTS[connecting].catalogId} · a named public inventory</dd>
                  </div>
                  <div>
                    <dt>Fields</dt>
                    <dd>{PUBLIC_FIELDS.join(', ')}</dd>
                  </div>
                  <div>
                    <dt>Duration & budget</dt>
                    <dd>24 hours · up to 10 requests</dd>
                  </div>
                </dl>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={follow}
                    onChange={(e) => {
                      setAck(false);
                      setFollow(e.target.checked);
                    }}
                  />
                  <span>
                    Allow future snapshots within this named catalog.
                    <small>Unchecked keeps this permission pinned to its current inventory.</small>
                  </span>
                </label>
                <div className="privacy-statement">
                  <LockKeyhole size={18} />
                  <p>
                    The client receives candidate decisions and public facts. Suggestions may reveal
                    preferences. Previously released answers cannot be recalled.
                  </p>
                </div>
                <div className="provider-consent">
                  <span className="mini-label">PROVIDER SCOPE</span>
                  <p>
                    Live Qloo receives the selected cultural IDs and approved candidate IDs. An
                    enabled AI explanation uses only public catalog facts and the client’s brief.
                    Private references and profiles are excluded from the AI prompt. The client can
                    receive a generic public explanation alongside permitted item facts.
                  </p>
                </div>
                <label className="checkbox-line consent-check">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I reviewed this scope and allow this choice.</span>
                </label>
                {error && (
                  <p className="inline-error" role="alert">
                    {error}
                  </p>
                )}
                <div className="dialog-actions">
                  <Button variant="secondary" onClick={() => setConnecting(null)}>
                    Cancel
                  </Button>
                  <Button
                    busy={busy}
                    disabled={!ack || !signals.length || signals.length > 10}
                    onClick={allow}
                  >
                    Allow this choice <ArrowRight size={16} />
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </Modal>
    </>
  );
}

function DecisionsPage({
  data,
  selectedId,
  onEvidence,
}: {
  data: WorkspaceData;
  selectedId?: string;
  onEvidence: (id: string) => void;
}) {
  const selected = data.decisions.find((d) => d.id === selectedId);
  const decisions = selected ? [selected] : data.decisions;
  return (
    <>
      <PageIntro
        eyebrow="YOUR CHOICES"
        title="A little thought, kept."
        description="Every choice has a context and a permission receipt. Earlier decisions stay in history when you correct what guides the next one."
      />
      {decisions.length === 0 ? (
        <Empty
          icon={<BookOpen size={26} />}
          title="Your first choice is still ahead."
          description="Try a connected client or invite someone to find a thoughtful gift."
          action={
            <Link className="button button-primary" href="/connections">
              Choose a client <ArrowRight size={16} />
            </Link>
          }
        />
      ) : (
        <div className="decision-cards">
          {decisions.map((d) => (
            <article className="panel decision-card" key={d.id}>
              <DecisionRow decision={d} onEvidence={onEvidence} />
              {d.stale && (
                <div className="stale-note">
                  <RefreshCw size={16} /> Based on an earlier context. New requests will use your
                  correction.
                </div>
              )}
              <div className="owner-result-grid">
                {d.items.map((item, index) => (
                  <div key={item.id}>
                    <span className="result-rank">0{index + 1}</span>
                    <h3>{item.title}</h3>
                    <p>{item.creator}</p>
                    {data.selections.some((s) => s.runId === d.id && s.itemId === item.id) && (
                      <Badge tone="green">
                        <Heart size={12} /> Kept
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
              <div className="decision-card-foot">
                <span>
                  {d.provenance?.label ?? 'Awaiting a result'} · {prettyTime(d.createdAt)}
                </span>
                <ExternalLink href={clientOrigin(d.clientId, data)}>
                  Return to {CLIENTS[d.clientId].name}
                </ExternalLink>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
function EvidenceBody({ evidence }: { evidence: Record<string, unknown> }) {
  const refs = evidence.selectedReferences as { id: string; title: string }[] | undefined;
  const qloo = evidence.qloo as { returnedCount?: number; sentCandidateCount?: number } | undefined;
  const agent = evidence.agent as
    | { requestCount?: number; toolSteps?: number; groundedFactCount?: number }
    | undefined;
  const executionCounters = [
    { label: 'Qloo options returned', value: qloo?.returnedCount },
    { label: 'Eligible options sent to Qloo', value: qloo?.sentCandidateCount },
    { label: 'AI HTTP requests', value: agent?.requestCount },
    { label: 'AI tool steps completed', value: agent?.toolSteps },
    { label: 'Public facts validated', value: agent?.groundedFactCount },
  ];
  const receipts = evidence.receipts as
    | {
        id: string;
        grant_version: number;
        context_revision: number;
        fields: string[];
        payload_digest: string;
        authorizedAt: string;
      }[]
    | undefined;
  const provenance = evidence.provenance as
    | {
        mode: string;
        label?: string;
        status?: string;
        candidateCount?: number;
        mappedCount?: number;
        unmappedCount?: number;
        providerLabel?: string;
        agent?: { enabled?: boolean; status?: string; label?: string };
      }
    | undefined;
  return (
    <>
      <div className="evidence-callout">
        <ShieldCheck size={21} />
        <div>
          <strong>Owner-only evidence</strong>
          <p>This drawer can show your selected references. The gift client cannot fetch it.</p>
        </div>
      </div>
      <div className="evidence-layers">
        <div>
          <span>01 / AUTHORIZATION</span>
          <strong>TASTEKEEPER gateway</strong>
          <p>Scope and revisions are checked before a result is released.</p>
        </div>
        <div>
          <span>02 / RECOMMENDATION</span>
          <strong>
            {provenance?.mode === 'qloo'
              ? (provenance.providerLabel ?? 'Qloo cultural affinity')
              : provenance?.mode === 'authored_sample' || provenance?.mode === 'sample'
                ? 'Authored sample order'
                : 'No provider result yet'}
          </strong>
          <p>{provenance?.label ?? 'The request has not returned recommendation evidence.'}</p>
        </div>
        <div>
          <span>03 / EXPLANATION</span>
          <strong>{provenance?.agent?.label ?? 'No AI explanation reported'}</strong>
          <p>
            {provenance?.agent
              ? `Status: ${provenance.agent.status ?? (provenance.agent.enabled ? 'enabled' : 'disabled')}. Explanatory text cannot expand the approved scope.`
              : 'A permission receipt records authorization; it does not establish preference quality.'}
          </p>
        </div>
      </div>
      <dl className="evidence-summary">
        <div>
          <dt>Run</dt>
          <dd>{short(String(evidence.id))}</dd>
        </div>
        <div>
          <dt>State</dt>
          <dd>{String(evidence.state)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {provenance?.mode === 'authored_sample' || provenance?.mode === 'sample'
              ? 'Authored sample rules'
              : provenance?.mode === 'qloo'
                ? 'Qloo'
                : 'No result yet'}
          </dd>
        </div>
        <div>
          <dt>Workflow status</dt>
          <dd>{provenance?.status ?? 'No result yet'}</dd>
        </div>
        {provenance?.candidateCount !== undefined && (
          <div>
            <dt>Approved candidates checked</dt>
            <dd>{provenance.candidateCount}</dd>
          </div>
        )}
        {provenance?.mappedCount !== undefined && (
          <div>
            <dt>Reviewed Qloo mappings</dt>
            <dd>{provenance.mappedCount}</dd>
          </div>
        )}
        {provenance?.unmappedCount !== undefined && (
          <div>
            <dt>Unmapped inventory omitted</dt>
            <dd>{provenance.unmappedCount}</dd>
          </div>
        )}
        {executionCounters.map(({ label, value }) =>
          typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ) : null,
        )}
        <div>
          <dt>Context revision</dt>
          <dd>{String(evidence.contextRevision)}</dd>
        </div>
        <div>
          <dt>Grant version</dt>
          <dd>{String(evidence.grantVersion)}</dd>
        </div>
        <div>
          <dt>Client epoch</dt>
          <dd>{String(evidence.clientEpoch)}</dd>
        </div>
      </dl>
      <h3>References approved for this request</h3>
      <div className="evidence-ref-list">
        {refs?.map((ref) => (
          <div key={ref.id}>
            <span />
            {ref.title}
          </div>
        ))}
      </div>
      <p className="evidence-reference-note">
        Selected references are owner-only. A provider can use only the reviewed mappings available
        for this authorized query.
      </p>
      <h3>Release receipts</h3>
      {!receipts?.length ? (
        <p>No result has passed the final release gate yet.</p>
      ) : (
        receipts.map((receipt) => (
          <div className="receipt" key={receipt.id}>
            <div>
              <Check size={16} />
              <strong>Authorized {prettyTime(receipt.authorizedAt)}</strong>
            </div>
            <p>
              Grant v{receipt.grant_version} · Context v{receipt.context_revision}
            </p>
            <span className="mini-label">PERMITTED RESPONSE FIELDS</span>
            <code>{receipt.fields.join(' · ')}</code>
            <span className="mini-label">PAYLOAD DIGEST</span>
            <code className="digest">{receipt.payload_digest}</code>
          </div>
        ))
      )}
      <div className="evidence-footer">
        No affinity or preference-quality claim is made by this receipt. It records the
        authorization and exact public response fields.
      </div>
    </>
  );
}
