import { describe, expect, it, jest } from '@jest/globals';
import { runTestsForEachFetchImpl } from './test-fetch.js';

describe('Request Container', () => {
  runTestsForEachFetchImpl(
    (_, { createServerAdapter, fetchAPI: { Request } }) => {
      it('should receive correct request and container as a context', async () => {
        const handleRequest = jest.fn((_req: Request, _ctx: any) => Response.json({}));
        const adapter = createServerAdapter(handleRequest);
        const requestContainer = {
          request: new Request('http://localhost:8080'),
        };
        await adapter(requestContainer);
        expect(handleRequest).toHaveBeenCalledWith(
          requestContainer.request,
          expect.objectContaining(requestContainer),
        );
      });
      it('should accept additional parameters as server context', async () => {
        const handleRequest = jest.fn((_req: Request, _ctx: any) => Response.json({}));
        const adapter = createServerAdapter<{
          foo: string;
        }>(handleRequest);
        const requestContainer = {
          request: new Request('http://localhost:8080'),
          foo: 'bar',
        };
        await adapter(requestContainer);
        expect(handleRequest).toHaveBeenCalledWith(
          requestContainer.request,
          expect.objectContaining(requestContainer),
        );
      });
    },
    { noLibCurl: true, noUndici: true },
  );
});
