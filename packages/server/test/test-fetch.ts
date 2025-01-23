/* eslint-disable n/no-callback-literal */
import { globalAgent as httpGlobalAgent } from 'node:http';
import { globalAgent as httpsGlobalAgent } from 'node:https';
import { setTimeout } from 'node:timers/promises';
import type { Dispatcher } from 'undici';
import * as undici from 'undici';
import { afterAll, describe } from '@jest/globals';
import { patchSymbols } from '@whatwg-node/disposablestack';
import { createFetch } from '@whatwg-node/fetch';
import { createFetchPonyfill } from '../../node-fetch/src/fetch';
import { createFetchCurl } from '../../node-fetch/src/fetchCurl';
import { fetchNodeHttp } from '../../node-fetch/src/fetchNodeHttp';
import { createFetchUndici } from '../../node-fetch/src/fetchUndici';
import { createServerAdapter } from '../src/createServerAdapter';
import { FetchAPI } from '../src/types';

patchSymbols();
const describeIf = (condition: boolean) => (condition ? describe : describe.skip);
export function runTestsForEachFetchImpl(
  callback: (
    implementationName: string,
    api: {
      fetchAPI: FetchAPI;
      createServerAdapter: typeof createServerAdapter;
    },
  ) => void,
  opts: { noLibCurl?: boolean; noNativeFetch?: boolean; noUndici?: boolean } = {},
) {
  let noNative = opts.noNativeFetch;
  if (
    process.env.LEAK_TEST &&
    // @ts-expect-error - Only if global dispatcher is available
    !globalThis[Symbol.for('undici.globalDispatcher.1')]
  ) {
    noNative = true;
  }
  describeIf(!noNative || globalThis.Bun || globalThis.Deno)('Native', () => {
    const fetchAPI = {
      ...createFetch({ skipPonyfill: true }),
      fetch: globalThis.fetch,
    };
    callback('native', {
      fetchAPI,
      createServerAdapter: (baseObj: any, opts?: any) =>
        createServerAdapter(baseObj, {
          fetchAPI,
          ...opts,
        }),
    });
  });

  describeIf(!globalThis.Bun && !globalThis.Deno)('Ponyfill', () => {
    if (
      !opts.noLibCurl &&
      (process.env.LEAK_TEST ? globalThis.TEST_LIBCURL : true) &&
      !globalThis.Bun &&
      !globalThis.Deno
    ) {
      const nodeLibCurlName = 'node-libcurl';
      describe('libcurl', () => {
        const fetchAPI = {
          ...createFetch({ skipPonyfill: false }),
          fetch: createFetchPonyfill(
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            createFetchCurl(globalThis.TEST_LIBCURL || require(nodeLibCurlName)),
          ) as FetchAPI['fetch'],
        };
        callback('libcurl', {
          fetchAPI,
          createServerAdapter: (baseObj: any, opts?: any) =>
            createServerAdapter(baseObj, {
              fetchAPI,
              ...opts,
            }),
        });
      });
    }
    describe('node-http', () => {
      if (process.env.LEAK_TEST) {
        afterAll(() => {
          httpGlobalAgent.destroy();
          httpsGlobalAgent.destroy();
        });
      }
      const fetchAPI = {
        ...createFetch({ skipPonyfill: false }),
        fetch: createFetchPonyfill(fetchNodeHttp) as FetchAPI['fetch'],
      };
      callback('node-http', {
        fetchAPI,
        createServerAdapter: (baseObj: any, opts?: any) =>
          createServerAdapter(baseObj, {
            fetchAPI,
            ...opts,
          }),
      });
    });
    if (!opts.noUndici) {
      describe('undici', () => {
        const undiciGlobalDispatcher: Dispatcher =
          // @ts-expect-error TS types are not available yet but documented [here](https://github.com/nodejs/undici/discussions/2167#discussioncomment-6239992)
          globalThis[Symbol.for('undici.globalDispatcher.1')];
        if (undiciGlobalDispatcher) {
          const fetchAPI = {
            ...createFetch({ skipPonyfill: false }),
            fetch: createFetchPonyfill(
              // @ts-expect-error - see above
              createFetchUndici(() => globalThis[Symbol.for('undici.globalDispatcher.1')]),
            ) as FetchAPI['fetch'],
          };
          callback('undici-builtin', {
            fetchAPI,
            createServerAdapter: (baseObj: any, opts?: any) =>
              createServerAdapter(baseObj, {
                fetchAPI,
                ...opts,
              }),
          });
        }
        const fetchAPI = {
          ...createFetch({ skipPonyfill: false }),
          fetch: createFetchPonyfill(
            createFetchUndici(() => undici.getGlobalDispatcher()),
          ) as FetchAPI['fetch'],
        };
        callback('undici', {
          fetchAPI,
          createServerAdapter: (baseObj: any, opts?: any) =>
            createServerAdapter(baseObj, {
              fetchAPI,
              ...opts,
            }),
        });
      });
    }
  });
}

if (process.env.LEAK_TEST) {
  afterAll(async () => {
    globalThis?.gc?.();
    const undiciGlobalDispatcher: Dispatcher =
      // @ts-expect-error TS types are not available yet but documented [here](https://github.com/nodejs/undici/discussions/2167#discussioncomment-6239992)
      globalThis[Symbol.for('undici.globalDispatcher.1')];
    try {
      await undici.getGlobalDispatcher().close();
      await undici.getGlobalDispatcher().destroy();
      await undiciGlobalDispatcher?.close();
      await undiciGlobalDispatcher?.destroy();
      globalThis.TEST_LIBCURL.Curl?.globalCleanup();
      globalThis?.gc?.();
    } catch (_err) {}
    return setTimeout(300);
  });
}
