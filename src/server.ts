import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { isMainThread } from 'node:worker_threads';
import { getRelay } from './server/mosaic-relay';

try {
  process.loadEnvFile();
} catch {}

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine({
  allowedHosts: process.env['ALLOWED_HOSTS']?.split(',')
    .map((host) => host.trim())
    .filter(Boolean),
  trustProxyHeaders: true,
});

app.get('/health', (_, res) => {
  const status = getRelay().status();
  res.status(status.mqttConnected ? 200 : 503).json({
    status: status.mqttConnected ? 'ok' : 'degraded',
    ...status,
    uptime: Math.round(process.uptime()),
  });
});

app.get('/api/course/:vehicleId', (req, res) => {
  void getRelay().serveCourse(req.params.vehicleId, res);
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) => (response ? writeResponseToNodeResponse(response, res) : next()))
    .catch(next);
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  const server = app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
  getRelay().attach(server);
} else if (isMainThread) {
  // Dev mode (`ng serve` + proxy.conf.json): run the relay standalone.
  // Skipped in Angular's build-time prerender/route-extraction workers,
  // which import this module but must not start the relay.
  getRelay().listenStandalone(Number(process.env['RELAY_PORT'] ?? 4300));
}

export const reqHandler = createNodeRequestHandler(app);
