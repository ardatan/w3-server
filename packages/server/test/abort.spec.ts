import { describe, it } from '@jest/globals';
import { createDeferredPromise } from '../src/utils';
import { runTestsForEachFetchImpl } from './test-fetch';
import { runTestsForEachServerImpl } from './test-server';

describe('Request Abort', () => {
  runTestsForEachServerImpl(server => {
    runTestsForEachFetchImpl((_, { fetchAPI, createServerAdapter }) => {
      it('calls body.cancel on request abort', () => {
        const deferred = createDeferredPromise();
        const adapter = createServerAdapter(
          () =>
            new fetchAPI.Response(
              new fetchAPI.ReadableStream({
                cancel() {
                  deferred.resolve();
                },
              }),
            ),
        );
        server.addOnceHandler(adapter);
        const abortCtrl = new AbortController();
        fetchAPI.fetch(server.url, { signal: abortCtrl.signal }).then(
          () => {},
          e => {
            if (!e.toString().includes('abort')) {
              deferred.reject(e);
            }
          },
        );
        setTimeout(() => {
          abortCtrl.abort();
        }, 300);
        return deferred.promise;
      }, 1000);
    });
  });
});
