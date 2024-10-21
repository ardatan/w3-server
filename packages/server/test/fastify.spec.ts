import { request } from 'http';
import { AddressInfo } from 'net';
import React from 'react';
import fastify, { FastifyReply, FastifyRequest } from 'fastify';
// @ts-expect-error Types are not available yet
import { renderToReadableStream } from 'react-dom/server.edge';
import { ServerAdapter, ServerAdapterBaseObject } from '../src/types.js';
import { runTestsForEachFetchImpl } from './test-fetch.js';
import { createDeferred, sleep } from './test-utils.js';

interface FastifyServerContext {
  req: FastifyRequest;
  reply: FastifyReply;
}

type FastifyServerAdapter = ServerAdapter<any, ServerAdapterBaseObject<any>>;

describe('Fastify', () => {
  if (process.env.LEAK_TEST) {
    it('noop', () => {});
    return;
  }
  runTestsForEachFetchImpl(
    (_, { fetchAPI: { ReadableStream, Response, TextEncoder, URL }, createServerAdapter }) => {
      let serverAdapter: FastifyServerAdapter;
      const fastifyServer = fastify();
      fastifyServer.route({
        url: '/mypath',
        method: ['GET', 'POST', 'OPTIONS'],
        handler: (req, reply) =>
          serverAdapter.handleNodeRequestAndResponse(req, reply, {
            req,
            reply,
          }),
      });
      afterAll(() => fastifyServer.close());
      it('should handle streams', async () => {
        let cnt = 0;
        const encoder = new TextEncoder();
        serverAdapter = createServerAdapter<FastifyServerContext>(
          () =>
            new Response(
              new ReadableStream({
                async pull(controller) {
                  controller.enqueue(
                    encoder.encode(
                      JSON.stringify({
                        cnt,
                      }) + '\n',
                    ),
                  );
                  cnt++;
                  await new Promise(resolve => setTimeout(resolve, 300));
                  if (cnt > 3) {
                    controller.close();
                  }
                },
              }),
            ),
        );
        const res = await fastifyServer.inject({
          url: '/mypath',
        });
        expect(res.body).toMatchInlineSnapshot(`
      "{"cnt":0}
      {"cnt":1}
      {"cnt":2}
      {"cnt":3}
      "
    `);
      });
      it('should handle GET requests with query params', async () => {
        serverAdapter = createServerAdapter((request: Request) => {
          const url = new URL(request.url);
          const searchParamsObj = Object.fromEntries(url.searchParams);
          return Response.json(searchParamsObj);
        });
        const res = await fastifyServer.inject({
          url: '/mypath?foo=bar&baz=qux',
        });
        const body = res.json();
        expect(body).toMatchObject({
          foo: 'bar',
          baz: 'qux',
        });
      });
      it('should handle headers and status', async () => {
        const headers = { 'x-custom-header': '55', 'x-cache-header': 'true' };
        const status = 300;

        serverAdapter = createServerAdapter((request: Request) => {
          const url = new URL(request.url);
          const searchParamsObj = Object.fromEntries(url.searchParams);
          return Response.json(searchParamsObj, { headers, status });
        });
        const res = await fastifyServer.inject({
          url: '/mypath',
        });
        expect(res.headers).toMatchObject(headers);
        expect(res.statusCode).toBe(status);
      });

      it('Should handle react streaming response', async () => {
        serverAdapter = createServerAdapter(async () => {
          const MyComponent = () => {
            return React.createElement('h1', null, 'Rendered in React');
          };

          const stream = await renderToReadableStream(React.createElement(MyComponent));

          return new Response(stream);
        });
        const res = await fastifyServer.inject({
          url: '/mypath',
        });
        const body = res.body;
        expect(body).toEqual('<h1>Rendered in React</h1>');
      });

      it('handles AbortSignal', async () => {
        const abortListener = jest.fn();
        const adapterDeferred = createDeferred<Response>();
        serverAdapter = createServerAdapter((request: Request) => {
          request.signal.addEventListener('abort', abortListener);
          return adapterDeferred.promise;
        });
        const abortCtrl = new AbortController();
        const res$ = fastifyServer.inject({
          url: '/mypath',
          signal: abortCtrl.signal,
        });
        expect(abortListener).toHaveBeenCalledTimes(0);
        abortCtrl.abort();
        adapterDeferred.resolve(
          new Response('This should not be sent', {
            status: 200,
            statusText: 'OK',
          }),
        );
        expect(abortListener).toHaveBeenCalledTimes(0);
        await expect(res$).rejects.toThrow('aborted');
        expect(abortListener).toHaveBeenCalledTimes(1);
      });

      it('handles AbortSignal with body', async () => {
        const abortListener = jest.fn();
        let reqText: string | undefined;
        const adapterDeferred = createDeferred<Response>();
        serverAdapter = createServerAdapter<FastifyServerContext>((request: Request) => {
          request.signal.addEventListener('abort', abortListener);
          request.text().then(text => {
            reqText = text;
          });
          return adapterDeferred.promise;
        });
        await fastifyServer.listen({ port: 0 });
        const abortCtrl = new AbortController();
        const res = request(
          `http://localhost:${(fastifyServer.server.address() as AddressInfo).port}/mypath`,
          {
            method: 'POST',
            signal: abortCtrl.signal,
          },
        );
        res.setHeader('Content-Type', 'text/plain');
        res.write('TEST');
        res.end();
        expect(abortListener).toHaveBeenCalledTimes(0);
        await sleep(300);
        abortCtrl.abort();
        await sleep(300);
        expect(reqText).toEqual('TEST');
        expect(abortListener).toHaveBeenCalledTimes(1);
      });

      it('sends POST request with body', async () => {
        serverAdapter = createServerAdapter<FastifyServerContext>(async request => {
          const text = await request.text();
          return Response.json({
            reqBody: text,
          });
        });
        const res = await fastifyServer.inject({
          url: '/mypath',
          method: 'POST',
          payload: 'TEST',
          headers: {
            'Content-Type': 'text/plain',
          },
        });
        const resBody = res.json();
        expect(resBody).toEqual({
          reqBody: 'TEST',
        });
      });
    },
  );
});
