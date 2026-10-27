'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, Clock3, Search, ShieldCheck } from 'lucide-react';
import { Badge, Button, ExternalLink, Modal } from './ui';

type ReferenceType = 'book' | 'movie' | 'person' | 'artist' | 'place';
type Candidate = { id: string; title: string; subtitle: string; type: string; source?: string };
type SearchRun = {
  id: string;
  state: 'queued' | 'searching' | 'complete' | 'failed';
  candidates?: Candidate[];
  error?: { code: string; message: string };
};
class SearchError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal,
  });
  const value = await response.json();
  if (!response.ok)
    throw new SearchError(
      value.error?.message ?? 'This search could not be completed.',
      value.error?.code,
    );
  return value as T;
}
const sourceUrl = (value?: string) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

export function ReferenceSearch({
  open,
  onOpenChange,
  context,
  available,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: { id: string; name: string; revision: number };
  available: boolean;
  onChanged: (message: string) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ReferenceType>('book');
  const [run, setRun] = useState<SearchRun | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [review, setReview] = useState(false);
  const [ack, setAck] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [adding, setAdding] = useState(false);
  const [expectedRevision, setExpectedRevision] = useState(context.revision);
  const [error, setError] = useState<SearchError | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const selected = run?.candidates?.find((candidate) => candidate.id === selectedId);
  const conflict =
    error?.code === 'CORRECTION_CONFLICT' ||
    error?.code === 'REVISION_CHANGED' ||
    error?.code === 'CONTEXT_CONFLICT';
  const needsContextReview = conflict || error?.code === 'CONTEXT_LIMIT';

  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
    },
    [],
  );

  function close(next: boolean) {
    if (!next) {
      generation.current += 1;
      controller.current?.abort();
      if (waiting && run) setPaused(true);
      else if (waiting)
        setError(
          new SearchError(
            'The search submission was not confirmed in this view. Your query is preserved. A server-side search may still finish.',
          ),
        );
      setWaiting(false);
    }
    onOpenChange(next);
  }
  function clearResult() {
    setRun(null);
    setSelectedId('');
    setReview(false);
    setAck(false);
    setPaused(false);
    setError(null);
  }
  async function poll(id: string, current: number, signal: AbortSignal) {
    const started = Date.now();
    while (generation.current === current && !signal.aborted) {
      const next = await request<SearchRun>(
        `reference-searches/${encodeURIComponent(id)}`,
        undefined,
        signal,
      );
      if (generation.current !== current || signal.aborted) return;
      setRun(next);
      if (next.state === 'complete') {
        setWaiting(false);
        setPaused(false);
        return;
      }
      if (next.state === 'failed')
        throw new SearchError(
          next.error?.message ??
            'The identity provider could not finish this search. Your query is preserved.',
          next.error?.code,
        );
      if (Date.now() - started >= 20_000) {
        setWaiting(false);
        setPaused(true);
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (waiting || !available || query.trim().length < 2) return;
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    clearResult();
    setExpectedRevision(context.revision);
    setWaiting(true);
    let searchId: string | null = null;
    const deadline = window.setTimeout(() => {
      if (generation.current !== current) return;
      abort.abort();
      setWaiting(false);
      if (searchId) setPaused(true);
      else
        setError(
          new SearchError(
            'The search submission timed out. Your query is preserved. An already queued search may still finish; trying again creates another request.',
          ),
        );
    }, 20_000);
    try {
      const queued = await request<SearchRun>(
        'reference-searches',
        { query: query.trim(), type },
        abort.signal,
      );
      if (generation.current !== current || abort.signal.aborted) return;
      setRun(queued);
      searchId = queued.id;
      await poll(queued.id, current, abort.signal);
    } catch (e) {
      if (generation.current !== current || abort.signal.aborted) return;
      setWaiting(false);
      setError(
        e instanceof SearchError
          ? e
          : new SearchError(
              'The search connection is unavailable. Your query is preserved; try again.',
            ),
      );
    } finally {
      window.clearTimeout(deadline);
    }
  }
  async function resume() {
    if (!run || waiting) return;
    const current = ++generation.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setWaiting(true);
    setPaused(false);
    setError(null);
    const deadline = window.setTimeout(() => {
      if (generation.current !== current) return;
      abort.abort();
      setWaiting(false);
      setPaused(true);
    }, 20_000);
    try {
      await poll(run.id, current, abort.signal);
    } catch (e) {
      if (generation.current !== current || abort.signal.aborted) return;
      setWaiting(false);
      setError(
        e instanceof SearchError
          ? e
          : new SearchError('This search could not be checked. Try checking it again.'),
      );
    } finally {
      window.clearTimeout(deadline);
    }
  }
  async function add() {
    if (!run || !selected || !ack || adding) return;
    setAdding(true);
    setError(null);
    try {
      const result = await request<{ revision: number; added: { id: string; title: string } }>(
        `contexts/${context.id}/references`,
        { expectedRevision, searchId: run.id, candidateId: selected.id },
      );
      await onChanged(
        `Added ${result.added.title} to ${context.name}, revision ${result.revision}. Existing invitations were not expanded. Create a new invitation to include this reference.`,
      );
      clearResult();
      setQuery('');
      close(false);
    } catch (e) {
      setError(
        e instanceof SearchError
          ? e
          : new SearchError('This reference could not be added. Your selection is preserved.'),
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      title={review ? 'Review this reference' : 'Find the one you mean.'}
      description={
        review
          ? 'Confirm the exact cultural identity before adding it to this context.'
          : 'Search Qloo by title, creator, or place. You choose the exact match; nothing is added automatically.'
      }
      wide
    >
      {!available ? (
        <div className="reference-search-unavailable">
          <Clock3 size={24} />
          <h3>Live identity search is unavailable here.</h3>
          <p>
            The server has not enabled this connection to Qloo search. Your existing references
            remain available. You can return to this context and try again when live search is
            enabled.
          </p>
          <Button variant="secondary" onClick={() => close(false)}>
            Return to context
          </Button>
        </div>
      ) : review && selected ? (
        <>
          <div className="identity-review">
            <Badge tone="blue">Selected Qloo search identity</Badge>
            <h3 id="reference-review-heading" ref={reviewHeading} tabIndex={-1}>
              {selected.title}
            </h3>
            <p>{selected.subtitle}</p>
            <span className="identity-type">{selected.type}</span>
            {sourceUrl(selected.source) && (
              <ExternalLink href={sourceUrl(selected.source)!}>View identity source</ExternalLink>
            )}
          </div>
          <div className="reference-change-preview">
            <span className="mini-label">
              {context.name} / REVISION {expectedRevision} → {expectedRevision + 1}
            </span>
            <p>
              Add one owner-confirmed reference. Existing invitations keep their approved subset.
              Create a new invitation if this reference should guide a client’s next choice.
            </p>
          </div>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => setAck(event.target.checked)}
            />
            <span>I confirm this is the identity I mean.</span>
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error.message}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="secondary"
              disabled={adding || needsContextReview}
              onClick={() => {
                setReview(false);
                setAck(false);
                setError(null);
              }}
            >
              Choose another match
            </Button>
            {needsContextReview ? (
              <Button
                onClick={async () => {
                  try {
                    await onChanged(
                      'The context was refreshed. Review its latest revision before adding a reference.',
                    );
                    clearResult();
                    close(false);
                  } catch {
                    setError(
                      new SearchError('The current context could not be refreshed. Try again.'),
                    );
                  }
                }}
              >
                Review current context
              </Button>
            ) : (
              <Button busy={adding} disabled={!ack} onClick={add}>
                Add to this context <Check size={16} />
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <form className="reference-search-form" onSubmit={search}>
            <fieldset disabled={waiting}>
              <legend className="sr-only">Search for an exact cultural reference</legend>
              <div>
                <label className="field-label" htmlFor="live-reference-type">
                  Reference category
                </label>
                <select
                  id="live-reference-type"
                  value={type}
                  onChange={(event) => {
                    setType(event.target.value as ReferenceType);
                    clearResult();
                  }}
                >
                  <option value="book">Book</option>
                  <option value="movie">Film</option>
                  <option value="person">Person</option>
                  <option value="artist">Artist</option>
                  <option value="place">Place</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="live-reference-query">
                  Title, creator, or place
                </label>
                <input
                  id="live-reference-query"
                  type="search"
                  minLength={2}
                  maxLength={100}
                  required
                  value={query}
                  placeholder="A title and its creator…"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    clearResult();
                  }}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" busy={waiting} disabled={query.trim().length < 2}>
                <Search size={16} /> Search Qloo
              </Button>
            </fieldset>
          </form>
          <div className="reference-search-disclosure">
            <ShieldCheck size={17} />
            <p>
              Your search text and category are sent to Qloo. Your existing context and private
              references are not included in this identity search.
            </p>
          </div>
          {waiting ? (
            <div className="reference-search-loading" role="status">
              <span className="spinner" aria-hidden="true" />
              <strong>
                {run?.state === 'searching'
                  ? 'Searching Qloo for matching identities…'
                  : 'Your identity search is queued…'}
              </strong>
              <p>We’ll show the returned matches for you to review.</p>
            </div>
          ) : paused ? (
            <div className="reference-search-paused">
              <Clock3 size={21} />
              <h3>This search is still waiting.</h3>
              <p>It may finish on the server. Check this same request again when you’re ready.</p>
              <Button variant="secondary" onClick={resume}>
                Check this search
              </Button>
            </div>
          ) : null}
          {error && (
            <p className="inline-error" role="alert">
              {error.message}
            </p>
          )}
          {!waiting &&
            !paused &&
            run?.state === 'complete' &&
            (run.candidates?.length ? (
              <fieldset className="identity-candidates">
                <legend>Choose the exact identity you mean.</legend>
                <p className="field-note" role="status">
                  {run.candidates.length} match{run.candidates.length === 1 ? '' : 'es'} returned.
                  No reference has been added.
                </p>
                {run.candidates.map((candidate) => (
                  <div
                    className={`identity-candidate ${selectedId === candidate.id ? 'is-selected' : ''}`}
                    key={candidate.id}
                  >
                    <label>
                      <input
                        type="radio"
                        name="reference-candidate"
                        value={candidate.id}
                        checked={selectedId === candidate.id}
                        onChange={() => {
                          setSelectedId(candidate.id);
                          setAck(false);
                        }}
                      />
                      <span>
                        <strong>{candidate.title}</strong>
                        <small>{candidate.subtitle}</small>
                        <span className="identity-type">{candidate.type}</span>
                      </span>
                    </label>
                    {sourceUrl(candidate.source) && (
                      <ExternalLink href={sourceUrl(candidate.source)!}>Source</ExternalLink>
                    )}
                  </div>
                ))}
                <div className="dialog-actions">
                  <Button
                    disabled={!selected}
                    onClick={() => {
                      setReview(true);
                      setAck(false);
                      window.requestAnimationFrame(() => reviewHeading.current?.focus());
                    }}
                  >
                    Review this identity <ArrowRight size={16} />
                  </Button>
                </div>
              </fieldset>
            ) : (
              <div className="reference-search-empty">
                <h3>No exact match in these results.</h3>
                <p>
                  Try a more specific title, creator, or category. Nothing has been added to your
                  context.
                </p>
              </div>
            ))}
          <p className="reference-search-footnote">
            New references never silently expand current connections. Closing stops waiting in this
            view; an already queued search may still finish.
          </p>
        </>
      )}
    </Modal>
  );
}
