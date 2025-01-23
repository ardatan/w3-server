import { describe, expect, it } from '@jest/globals';
import { runTestsForEachFetchImpl } from './test-fetch';

describe('Server Context', () => {
  runTestsForEachFetchImpl(
    (_, { createServerAdapter, fetchAPI: { Request, Response } }) => {
      it('should be passed to the handler', async () => {
        const exampleStaticCtx = { foo: 'bar' };
        const seenCtx = new Set();
        const adapter = createServerAdapter<typeof exampleStaticCtx>(function handler(_req, ctx) {
          seenCtx.add(ctx);
          ctx.foo = 'baz';
          return new Response('ok');
        });
        const res = await adapter(new Request('https://example.com'), exampleStaticCtx);
        expect(res.status).toBe(200);
        expect(seenCtx.size).toBe(1);
        expect(seenCtx.has(exampleStaticCtx)).toBe(false);
        expect(exampleStaticCtx.foo).toBe('bar');
        const res2 = await adapter(new Request('https://example.com'), exampleStaticCtx);
        expect(res2.status).toBe(200);
        expect(seenCtx.size).toBe(2);
        expect(seenCtx.has(exampleStaticCtx)).toBe(false);
        expect(exampleStaticCtx.foo).toBe('bar');
      });
      it('filters empty ctx', async () => {
        const adapter = createServerAdapter<any>(function handler(_req, ctx) {
          return Response.json(ctx);
        });
        const ctxParts: any[] = [undefined, undefined, { foo: 'bar' }, undefined, { bar: 'baz' }];
        const res = await adapter(new Request('https://example.com'), ...ctxParts);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ foo: 'bar', bar: 'baz' });
      });
      it('retains the prototype in case of `Object.create`', async () => {
        class MyContext {}
        await using serverAdapter = createServerAdapter((_req, context0: MyContext) => {
          return Response.json({
            isMyContext: context0 instanceof MyContext,
          });
        });
        const res = await serverAdapter.fetch('http://localhost', new MyContext());
        const resJson = await res.json();
        expect(resJson).toEqual({
          isMyContext: true,
        });
      });
      it('Do not pollute the original object in case of `Object.create`', async () => {
        await using serverAdapter = createServerAdapter((_req, context0: any) => {
          context0.i = 0;
          const context1 = Object.create(context0);
          context1.i = 1;
          const context2 = Object.create(context0);
          context2.i = 2;
          return Response.json({
            i0: context0.i,
            i1: context1.i,
            i2: context2.i,
          });
        });
        const res = await serverAdapter.fetch('http://localhost');
        const resJson = await res.json();
        expect(resJson).toEqual({
          i0: 0,
          i1: 1,
          i2: 2,
        });
      });
      it('Do not pollute the original object in case of `Object.create` and `Object.defineProperty`', async () => {
        await using serverAdapter = createServerAdapter((_req, context0: any) => {
          const context1 = Object.create(context0);
          Object.defineProperty(context1, 'i', { value: 1, configurable: true });
          const context2 = Object.create(context0);
          Object.defineProperty(context2, 'i', { value: 2, configurable: true });
          return Response.json({
            i1: context1.i,
            i2: context2.i,
          });
        });
        const res = await serverAdapter.fetch('http://localhost');
        const resJson = await res.json();
        expect(resJson).toEqual({
          i1: 1,
          i2: 2,
        });
      });
    },
    { noLibCurl: true, noUndici: true },
  );
});
