import { describe, expect, it, jest } from '@jest/globals';
import { useErrorHandling } from '../src/plugins/useErrorHandling.js';
import { runTestsForEachFetchImpl } from './test-fetch.js';

describe('useErrorHandling', () => {
  runTestsForEachFetchImpl(
    (_, { createServerAdapter, fetchAPI }) => {
      it('should return error response when error is thrown', async () => {
        const errorHandler = jest.fn(() => {});
        let request: Request | undefined;
        const router = createServerAdapter(
          req => {
            request = req;
            throw new Error('Unexpected error');
          },
          {
            plugins: [useErrorHandling(errorHandler)],
            fetchAPI,
          },
        );
        const response = await router.fetch('http://localhost/greetings/John');
        const errRes = fetchAPI.Response.error();
        expect(response.status).toBe(errRes.status);
        expect(response.statusText).toBe(errRes.statusText);
        const text = await response.text();
        expect(text).toHaveLength(0);
        expect(errorHandler).toHaveBeenCalledWith(new Error('Unexpected error'), request, {
          waitUntil: expect.any(Function),
        });
      });
    },
    { noLibCurl: true, noUndici: true },
  );
});
