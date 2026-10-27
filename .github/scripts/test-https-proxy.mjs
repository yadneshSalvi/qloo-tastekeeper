import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { request as upstreamRequest } from 'node:http';

// CI-only TLS frontends preserve production HTTPS origins and Secure cookies.
// They bind only to loopback and never forward to an external destination.
const tls = {
  cert: readFileSync(process.env.TASTEKEEPER_TEST_TLS_CERT),
  key: readFileSync(process.env.TASTEKEEPER_TEST_TLS_KEY),
};
const frontends = [
  [process.env.APP_ORIGIN, process.env.TASTEKEEPER_TEST_WEB_PORT || 3104],
  [process.env.CLIENT_BOOKS_ORIGIN, process.env.TASTEKEEPER_TEST_BOOKS_PORT || 3114],
  [process.env.CLIENT_MEDIA_ORIGIN, process.env.TASTEKEEPER_TEST_MEDIA_PORT || 3115],
  [process.env.CLIENT_PLACES_ORIGIN, process.env.TASTEKEEPER_TEST_PLACES_PORT || 3116],
];
const servers = frontends.map(([origin, upstreamPort]) => {
  const url = new URL(origin);
  const allowedHosts = [
    '127.0.0.1',
    'localhost',
    'books.localhost',
    'media.localhost',
    'places.localhost',
  ];
  if (
    url.protocol !== 'https:' ||
    !allowedHosts.includes(url.hostname) ||
    !url.port ||
    url.origin !== origin ||
    !Number.isInteger(Number(upstreamPort)) ||
    Number(upstreamPort) < 1024 ||
    Number(upstreamPort) > 65535
  )
    throw new Error('The test frontend must use an exact loopback HTTPS origin.');
  const server = createServer(tls, (request, response) => {
    const upstream = upstreamRequest({
      hostname: '127.0.0.1',
      port: Number(upstreamPort),
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        'x-forwarded-proto': 'https',
        'x-forwarded-host': request.headers.host,
      },
    });
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'content-type': 'text/plain' });
      response.end('The isolated test service is unavailable.');
    });
    upstream.on('response', (result) => {
      response.writeHead(result.statusCode || 502, result.headers);
      result.pipe(response);
    });
    request.on('aborted', () => upstream.destroy());
    request.pipe(upstream);
  });
  server.listen(Number(url.port), '127.0.0.1');
  return server;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    for (const server of servers) {
      server.closeAllConnections();
      server.close();
    }
  });
