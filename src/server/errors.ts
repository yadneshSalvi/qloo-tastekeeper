export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 403,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
const messages: Record<string, string> = {
  PRINCIPAL_DENIED: 'This connection cannot access that request.',
  CLIENT_DISABLED: 'This client connection has been disabled.',
  TOKEN_EXPIRED: 'This client session has expired. Return to TASTEKEEPER to allow a new choice.',
  GRANT_REVOKED: 'Access ended. The recipient has stopped future requests through this connection.',
  GRANT_EXPIRED: 'This invitation has ended. The recipient can create a new invitation.',
  REVISION_CHANGED: 'Access changed before this choice was ready. Start a new request.',
  SCOPE_DENIED: 'This request is outside the permission that was approved.',
  CATALOG_DENIED: 'This catalog was not approved for this connection.',
  CANDIDATE_DENIED: 'One or more choices are outside the approved catalog.',
  SIGNAL_SELECTION_REQUIRED:
    'The recipient needs to choose at least one current reference for this connection.',
  BUDGET_EXHAUSTED: 'This connection has used all of its permitted choices.',
  UPSTREAM_UNAVAILABLE:
    'Live Qloo ranking is unavailable. Your brief is preserved; you can explicitly choose the authored sample mode.',
  UNMAPPED_CANDIDATES:
    'These sample titles have not been verified against Qloo. Live ranking requires confirmed entity mappings.',
  NO_ELIGIBLE_OPTIONS:
    'No catalog options meet these constraints. Adjust your brief and try again.',
  INVITATION_CLAIMED: 'This single-use invitation has already been claimed.',
};
export const denied = (code: string, status = 403) =>
  new DomainError(code, messages[code] ?? 'The request could not be completed.', status);
