import nodeLibCurl from 'node-libcurl';
import Undici from 'undici';
import { fetchPonyfill as fetch } from '../../packages/node-fetch/src/fetch';
import { createFetchCurl } from '../../packages/node-fetch/src/fetchCurl';
import { fetchNodeHttp } from '../../packages/node-fetch/src/fetchNodeHttp';
import { createFetchUndici } from '../../packages/node-fetch/src/fetchUndici';
import { PonyfillRequest } from '../../packages/node-fetch/src/Request';

type FetchType = 'native' | 'nodeHttp' | 'undici' | 'curl';

export const fetchTypes: Record<FetchType, typeof fetchNodeHttp> = {
  native: globalThis.fetch as any,
  nodeHttp: fetchNodeHttp,
  undici: createFetchUndici(() => Undici.getGlobalDispatcher()),
  curl: createFetchCurl(nodeLibCurl),
};

export const scenarios = {
  async noConsumeBody(url: string, fetchType: FetchType) {
    const req = new PonyfillRequest<any>(url, { method: 'POST', body: '{ "hello": "world" }' });
    await fetchTypes[fetchType](req);
  },
  async consumeBody(url: string, fetchType: FetchType) {
    const req = new PonyfillRequest<any>(url, { method: 'POST', body: '{ "hello": "world" }' });
    const res = await fetchTypes[fetchType](req);
    await res.text();
  },
} as const;
