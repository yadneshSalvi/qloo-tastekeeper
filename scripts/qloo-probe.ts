import { probeQloo } from '../src/integrations/qloo.ts';

try {
  console.log(JSON.stringify(await probeQloo(), null, 2));
} catch {
  console.error(
    'The local official Qloo harness capability probe failed. No authenticated ranking was requested. Check the installed Node runtime and package setup.',
  );
  process.exitCode = 1;
}
