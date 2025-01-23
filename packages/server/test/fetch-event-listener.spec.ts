import { describe, expect, it, jest } from '@jest/globals';
import { CustomEvent } from '@whatwg-node/events';
import { fakePromise, FetchEvent } from '@whatwg-node/server';
import { runTestsForEachFetchImpl } from './test-fetch.js';

class PonyfillFetchEvent extends CustomEvent<{}> implements FetchEvent {
  constructor(
    public request: Request,
    public respondWith: FetchEvent['respondWith'],
    public waitUntil: FetchEvent['waitUntil'],
  ) {
    super('fetch');
  }
}

describe('FetchEvent listener', () => {
  runTestsForEachFetchImpl(
    (_, { createServerAdapter, fetchAPI: { Request, Response } }) => {
      it('should not return a promise to event listener', async () => {
        const response = new Response();
        const response$ = fakePromise(response);
        const adapter = createServerAdapter(() => response$);
        let returnedResponse$: Response | Promise<Response> | undefined;
        const respondWith = jest.fn((response$: Response | Promise<Response>) => {
          returnedResponse$ = response$;
        });
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        const returnValue = adapter(fetchEvent);
        expect(returnValue).toBeUndefined();
        expect(await returnedResponse$).toBe(response);
      });
      it('should expose FetchEvent as server context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const respondWith = jest.fn();
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        adapter(fetchEvent);
        expect(calledRequest).toBe(fetchEvent.request);
        expect(calledContext.request).toBe(fetchEvent.request);
        expect(calledContext.respondWith).toBe(fetchEvent.respondWith);
        expect(calledContext.waitUntil).toBe(fetchEvent.waitUntil);
      });
      it('should accept additional parameters as server context', async () => {
        const handleRequest = jest.fn((_req: Request, _ctx: any) => Response.json({}));
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const respondWith = jest.fn();
        const waitUntil = jest.fn();
        const fetchEvent = new PonyfillFetchEvent(
          new Request('http://localhost:8080'),
          respondWith,
          waitUntil,
        );
        const additionalCtx = { foo: 'bar' };
        adapter(fetchEvent, additionalCtx);
        expect(handleRequest).toHaveBeenCalledWith(
          fetchEvent.request,
          expect.objectContaining(additionalCtx),
        );
      });
    },
    { noLibCurl: true, noUndici: true },
  );
});
