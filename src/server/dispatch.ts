import { z } from 'zod';

export function cloudDispatchConfig(env: Record<string, string | undefined> = process.env) {
  if (!env.CLOUD_TASKS_QUEUE) return null;
  const project = z
    .string()
    .regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/)
    .parse(env.GOOGLE_CLOUD_PROJECT);
  const region = z
    .string()
    .regex(/^[a-z]+-[a-z]+\d$/)
    .parse(env.CLOUD_TASKS_LOCATION);
  const queue = z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .parse(env.CLOUD_TASKS_QUEUE);
  const worker = new URL(z.string().url().parse(env.WORKER_ORIGIN));
  if (
    worker.protocol !== 'https:' ||
    worker.username ||
    worker.password ||
    worker.pathname !== '/' ||
    worker.search ||
    worker.hash
  )
    throw new Error('INVALID_WORKER_ORIGIN');
  const invoker = z
    .string()
    .regex(/^[a-z][a-z0-9-]+@[a-z][a-z0-9-]+\.iam\.gserviceaccount\.com$/)
    .parse(env.WORKER_INVOKER_SERVICE_ACCOUNT);
  return {
    parent: `projects/${project}/locations/${region}/queues/${queue}`,
    worker: worker.origin,
    invoker,
  };
}

/** One idempotently named task. A failed dispatch leaves the SQL job queued for maintenance. */
async function dispatchTask(tenantId: string, id: string, kind: 'decision' | 'reference-search') {
  const config = cloudDispatchConfig();
  if (!config) return { dispatched: false, mode: 'polling' as const };
  z.uuid().parse(tenantId);
  z.uuid().parse(id);
  const metadata = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    },
  );
  if (!metadata.ok) throw new Error('TASK_IDENTITY_UNAVAILABLE');
  const { access_token } = z
    .object({ access_token: z.string().min(1) })
    .parse(await metadata.json());
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${config.parent}/tasks`, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(7000),
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      task: {
        name: `${config.parent}/tasks/${kind}-${id}`,
        dispatchDeadline: '90s',
        httpRequest: {
          httpMethod: 'POST',
          url: `${config.worker}/tasks/${kind}`,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(
            JSON.stringify({
              tenantId,
              ...(kind === 'decision' ? { runId: id } : { searchId: id }),
            }),
          ).toString('base64'),
          oidcToken: { serviceAccountEmail: config.invoker, audience: config.worker },
        },
      },
    }),
  });
  if (!response.ok && response.status !== 409) throw new Error('TASK_DISPATCH_FAILED');
  return { dispatched: true, mode: 'cloud_tasks' as const };
}
export const dispatchDecision = (tenantId: string, runId: string) =>
  dispatchTask(tenantId, runId, 'decision');
export const dispatchReferenceSearch = (tenantId: string, searchId: string) =>
  dispatchTask(tenantId, searchId, 'reference-search');
