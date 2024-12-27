import { createServer } from 'http';
import { AddressInfo } from 'net';
import { runTestsForEachFetchImpl } from './test-fetch';
import { runTestsForEachServerImpl } from './test-server';

describe('Proxy', () => {
  if (globalThis.Bun) {
    // Bun does not support streams on Request body
    it.skip('skipping test on Bun', () => {});
    return;
  }
  runTestsForEachFetchImpl(
    (fetchImplName, { createServerAdapter, fetchAPI: { fetch, Response, URL } }) => {
      let aborted: boolean = false;
      const originalAdapter = createServerAdapter(async request => {
        if (request.url.endsWith('/delay')) {
          await new Promise<void>(resolve => {
            const timeout = setTimeout(() => {
              resolve();
            }, 1000);
            request.signal.addEventListener('abort', () => {
              clearTimeout(timeout);
              aborted = true;
              resolve();
            });
          });
          aborted = request.signal.aborted;
        }
        return Response.json({
          method: request.method,
          url: request.url,
          headers: Object.fromEntries(request.headers.entries()),
          body: await request.text(),
        });
      });
      beforeEach(() => {
        aborted = false;
      });
      runTestsForEachServerImpl((originalServer, serverImplName) => {
        if (serverImplName === 'hapi' && fetchImplName.toLowerCase() === 'native') {
          // Hapi does not work well with native streams
          it.skip('skipping test on Hapi with native fetch', () => {});
          return;
        }
        beforeEach(() => originalServer.addOnceHandler(originalAdapter));
        const proxyAdapter = createServerAdapter(request => {
          const proxyUrl = new URL(request.url);
          return fetch(`${originalServer.url}${proxyUrl.pathname}`, {
            method: request.method,
            headers: Object.fromEntries(
              [...request.headers.entries()].filter(([key]) => key !== 'host'),
            ),
            body: request.body,
            signal: request.signal,
            // @ts-expect-error duplex is not part of RequestInit type yet
            duplex: 'half',
          });
        });
        const proxyServer = createServer(proxyAdapter);
        beforeAll(done => {
          proxyServer.listen(0, () => done());
        });
        afterAll(done => {
          proxyServer.close(() => done());
        });
        it('proxies requests', async () => {
          const requestBody = JSON.stringify({
            test: true,
          });
          const response = await fetch(
            `http://localhost:${(proxyServer.address() as AddressInfo).port}/test`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: requestBody,
            },
          );
          expect(response.status).toBe(200);
          const resJson = await response.json();
          expect(resJson.method).toBe('POST');
          expect(resJson.headers).toMatchObject({
            'content-type': 'application/json',
          });
          expect(resJson.body).toBe(requestBody);
        });
        it('handles aborted requests', async () => {
          const response = fetch(
            `http://localhost:${(proxyServer.address() as AddressInfo).port}/delay`,
            {
              signal: AbortSignal.timeout(500),
            },
          );
          await expect(response).rejects.toThrow();
          await new Promise<void>(resolve => setTimeout(resolve, 500));
          expect(aborted).toBe(true);
        });
        it('handles requested terminated before abort', async () => {
          const res = await fetch(
            `http://localhost:${(proxyServer.address() as AddressInfo).port}/delay`,
            {
              signal: AbortSignal.timeout(2000),
            },
          );
          expect(res.ok).toBe(true);
          await res.text();
          await new Promise(resolve => setTimeout(resolve, 1000));
          expect(aborted).toBe(false);
        });
      });
    },
    {
      // TODO: Flakey on native fetch
      // TODO: Readable streams for fetch() are not available on Bun
      noNativeFetch: !!process.env.LEAK_TEST || !!globalThis.Bun,
    },
  );
});
