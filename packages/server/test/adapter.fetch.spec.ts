import { describe, expect, it, jest } from '@jest/globals';
import { createDeferredPromise, DisposableSymbols } from '@whatwg-node/server';
import { runTestsForEachFetchImpl } from './test-fetch.js';

describe('adapter.fetch', () => {
  runTestsForEachFetchImpl(
    (_, { fetchAPI: { Request, Response, URL }, createServerAdapter }) => {
      // Request as first parameter
      it('should accept Request as a first argument', async () => {
        let calledRequest: Request | undefined;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const request = new Request('http://localhost:8080');
        await adapter(request);
        expect(calledRequest).toBe(request);
      });
      it('should accept additional parameters as server context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const request = new Request('http://localhost:8080');
        const additionalCtx = { foo: 'bar' };
        await adapter.fetch(request, additionalCtx);
        expect(calledRequest).toBe(request);
        expect(calledContext).toMatchObject(additionalCtx);
      });
      // URL as first parameter
      it('should accept URL as a first argument', async () => {
        let calledRequest: Request | undefined;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const url = new URL('http://localhost:8080');
        await adapter.fetch(url);
        expect(calledRequest?.url).toBe(url.toString());
      });
      it('should accept URL without a RequestInit but with an additional context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const url = new URL('http://localhost:8080');
        const additionalCtx = { foo: 'bar' };
        await adapter.fetch(url, additionalCtx);
        expect(calledContext).toMatchObject(additionalCtx);
        expect(calledRequest?.url).toBe(url.toString());
      });
      it('should accept URL with a RequestInit', async () => {
        let calledRequest: Request | undefined;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const url = new URL('http://localhost:8080');
        const init = {
          method: 'POST',
        };
        await adapter.fetch(url, init);
        expect(calledRequest?.url).toBe(url.toString());
        expect(calledRequest?.method).toBe(init.method);
      });
      it('should accept URL with a RequestInit and additional parameters as server context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const url = new URL('http://localhost:8080');
        const init = {
          method: 'POST',
        };
        const additionalCtx = { foo: 'bar' };
        await adapter.fetch(url, init, additionalCtx);
        expect(calledRequest?.url).toBe(url.toString());
        expect(calledRequest?.method).toBe(init.method);
        expect(calledContext).toMatchObject(additionalCtx);
      });

      // String as first parameter
      it('should accept string as a first argument', async () => {
        let calledRequest: Request | undefined;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const url = 'http://localhost:8080/';
        await adapter.fetch(url);
        expect(calledRequest?.url).toBe(url);
      });
      it('should accept string without a RequestInit but with an additional context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const url = 'http://localhost:8080/';
        const additionalCtx = { foo: 'bar' };
        await adapter.fetch(url, additionalCtx);
        expect(calledRequest?.url).toBe(url);
        expect(calledContext).toMatchObject(additionalCtx);
      });
      it('should accept string with a RequestInit', async () => {
        let calledRequest: Request | undefined;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest);
        const url = 'http://localhost:8080/';
        const init = {
          method: 'POST',
        };
        await adapter.fetch(url, init);
        expect(calledRequest?.url).toBe(url);
        expect(calledRequest?.method).toBe(init.method);
      });
      it('should accept string with a RequestInit and additional parameters as server context', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const url = 'http://localhost:8080/';
        const init = {
          method: 'POST',
        };
        const additionalCtx = { foo: 'bar' };
        await adapter.fetch(url, init, additionalCtx);
        expect(calledRequest?.url).toBe(url);
        expect(calledRequest?.method).toBe(init.method);
        expect(calledContext).toMatchObject(additionalCtx);
      });
      it('should copy non-enumerable parameters as server context and keep their descriptors', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter<any>(handleRequest);
        const request = new Request('http://localhost:8080/');
        const env = { VAR: 'abc' };
        const additionalCtx = {};
        const waitUntil = () => {};
        // in Cloudflare Workers, waitUntil is a non-enumerable property
        Object.defineProperty(additionalCtx, 'waitUntil', { enumerable: false, value: waitUntil });
        await adapter.fetch(request, env, additionalCtx);
        expect(calledRequest?.url).toBe(request.url);
        expect(calledContext).toMatchObject(additionalCtx);
        expect(calledContext.waitUntil).toBe(waitUntil);
        // test that enumerable stays false
        expect(Object.getOwnPropertyDescriptor(calledContext, 'waitUntil')?.enumerable).toBe(false);
      });
      it('should ignore falsy and non object values', async () => {
        let calledRequest: Request | undefined;
        let calledContext: any;
        const handleRequest = jest.fn((_req: Request, _ctx: any) => {
          calledRequest = _req;
          calledContext = _ctx;
          return Response.json({});
        });
        const adapter = createServerAdapter(handleRequest) as any;
        const request = new Request('http://localhost:8080/');
        await adapter.fetch(request, null, undefined, 0, false, 'abc', { foo: 'bar' });
        expect(calledRequest?.url).toBe(request.url);
        expect(calledContext).toMatchObject({ foo: 'bar' });
      });
      it('should have the abort signal on the request', async () => {
        let calledRequest: Request | undefined;
        const handler = jest.fn((_request: Request) => {
          calledRequest = _request;
          return new Response();
        });
        const adapter = createServerAdapter(handler);

        await adapter.fetch('http://localhost');

        expect(calledRequest?.signal).toBeTruthy();
      });
      it('should respect existing methods', () => {
        const baseObj = {
          async handle() {
            return new Response();
          },
          foo() {
            return 'foo';
          },
        };
        const adapter = createServerAdapter(baseObj);
        expect(adapter.foo()).toBe('foo');
      });
      it('should respect existing methods returning the object itself', async () => {
        const baseObj = {
          async handle() {
            return new Response();
          },
          returnThis() {
            return this;
          },
        };
        const adapter = createServerAdapter(baseObj);
        expect(adapter.returnThis()).toBe(adapter);
      });
      it('handles AbortSignal', async () => {
        const adapterResponseDeferred = createDeferredPromise<Response>();
        const adapter = createServerAdapter(req => {
          req.signal.addEventListener('abort', () => {
            adapterResponseDeferred.resolve(
              Response.json({
                message: "You're so late!",
              }),
            );
          });
          return adapterResponseDeferred.promise;
        });
        const controller = new AbortController();
        const signal = controller.signal;
        const promise = adapter.fetch('http://localhost', { signal });
        controller.abort();
        await expect(promise).rejects.toThrow(/aborted/);
      });

      it('should provide a unique context for each request', async () => {
        const contexts: any[] = [];
        const requestHandler = jest.fn((_req: Request, _ctx: any) => {
          contexts.push(_ctx);
          return Response.json({
            hello: 'world',
          });
        });
        const sharedCtxPart1 = { foo: 'bar' };
        const sharedCtxPart2 = { bar: 'baz' };
        const adapter = createServerAdapter(requestHandler);
        const request1 = new Request('http://localhost:8080/');
        const response1 = await adapter.fetch(request1, sharedCtxPart1, sharedCtxPart2);
        const response1Body = await response1.json();
        expect(response1Body).toEqual({ hello: 'world' });
        const request2 = new Request('http://localhost:8080/');
        const response2 = await adapter.fetch(request2, sharedCtxPart1, sharedCtxPart2);
        const response2Body = await response2.json();
        expect(response2Body).toEqual({ hello: 'world' });
        expect(requestHandler).toHaveBeenCalledTimes(2);
        expect(contexts).toHaveLength(2);
        expect(contexts[0]).not.toBe(contexts[1]);
      });

      describe('Disposal', () => {
        const hookNames = [
          DisposableSymbols.asyncDispose,
          DisposableSymbols.dispose,
          'onDispose',
        ] as const;
        it('handles explicit resource management (await using)', async () => {
          for (const disposalHookName of hookNames) {
            const disposeFn = jest.fn();
            {
              await using serverAdapter = createServerAdapter(() => new Response('Hello world!'), {
                plugins: [
                  {
                    [disposalHookName]: disposeFn,
                  },
                ],
              });
              await serverAdapter.fetch('http://localhost:8080/');
            }
            expect(disposeFn).toHaveBeenCalledTimes(1);
          }
        });
        const methodNames = [DisposableSymbols.asyncDispose, 'dispose'] as const;
        hookNames.forEach(hookName => {
          methodNames.forEach(methodName => {
            it(`handles ${hookName.toString()} hook (with ${methodName.toString()} method)`, async () => {
              const hookNames = [
                DisposableSymbols.asyncDispose,
                DisposableSymbols.dispose,
                'onDispose',
              ];
              for (const disposalHookName of hookNames) {
                const disposeFn = jest.fn();
                const serverAdapter = createServerAdapter(() => new Response('Hello world!'), {
                  plugins: [
                    {
                      [disposalHookName]: disposeFn,
                    },
                  ],
                });
                await serverAdapter.fetch('http://localhost:8080/');
                await serverAdapter[methodName]();
                expect(disposeFn).toHaveBeenCalledTimes(1);
              }
            });
          });
        });
      });
    },
    { noLibCurl: true, noUndici: true },
  );
});
