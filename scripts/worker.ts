import { workerTick } from '../src/server/gateway.ts';
import { shutdownDb } from '../src/server/db.ts';
let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
console.log(
  'TASTEKEEPER durable worker started. Authored sample mode; live requests require explicit configuration.',
);
while (!stopping) {
  try {
    await workerTick();
  } catch (error) {
    console.error('Worker tick failed:', error instanceof Error ? error.name : 'unknown');
  }
  await new Promise((resolve) => setTimeout(resolve, 600));
}
await shutdownDb();
