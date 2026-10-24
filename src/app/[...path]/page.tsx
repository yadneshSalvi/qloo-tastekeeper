import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { WorkspaceApp } from '@/components/workspace';
import { ownerFromToken, ownerWorkspace } from '@/server/store';
import { DomainError } from '@/server/errors';
import { clientIdSchema } from '@/domain/contracts';
export const dynamic = 'force-dynamic';
export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ path: string[] }>;
  searchParams: Promise<{ client?: string }>;
}) {
  const { path } = await params;
  if (path[0] === 'demo') redirect('/');
  if (!['home', 'contexts', 'gifts', 'connections', 'decisions', 'clients'].includes(path[0]))
    notFound();
  if (path[0] === 'clients') {
    const id = clientIdSchema.safeParse(path[1]);
    if (!id.success) notFound();
    redirect(`/connections?client=${id.data}`);
  }
  const cookieStore = await cookies();
  let owner;
  try {
    owner = await ownerFromToken(cookieStore.get('tastekeeper_owner')?.value);
  } catch (error) {
    if (error instanceof DomainError) redirect('/');
    throw error;
  }
  const data = await ownerWorkspace(owner);
  const query = await searchParams;
  const client = clientIdSchema.safeParse(query.client);
  return (
    <WorkspaceApp
      key={`${path.join('/')}?${query.client ?? ''}`}
      initialData={data}
      path={path}
      requestedClient={client.success ? client.data : undefined}
    />
  );
}
