import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isPromise } from 'node:util/types';
import { createFetchCurl } from './fetchCurl.js';
import { fetchNodeHttp } from './fetchNodeHttp.js';
import { createFetchUndici } from './fetchUndici.js';
import { PonyfillRequest, RequestPonyfillInit } from './Request.js';
import { PonyfillResponse } from './Response.js';
import { PonyfillURL } from './URL.js';
import { fakePromise } from './utils.js';

const BASE64_SUFFIX = ';base64';

function getResponseForFile(url: string) {
  const path = fileURLToPath(url);
  const readable = createReadStream(path);
  return new PonyfillResponse(readable);
}

function getResponseForDataUri(url: string) {
  const [mimeType = 'text/plain', ...datas] = url.substring(5).split(',');
  const data = decodeURIComponent(datas.join(','));
  if (mimeType.endsWith(BASE64_SUFFIX)) {
    const buffer = Buffer.from(data, 'base64url');
    const realMimeType = mimeType.slice(0, -BASE64_SUFFIX.length);
    return new PonyfillResponse(buffer, {
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': realMimeType,
      },
    });
  }
  return new PonyfillResponse(data, {
    status: 200,
    statusText: 'OK',
    headers: {
      'content-type': mimeType,
    },
  });
}

function getResponseForBlob(url: string) {
  const blob = PonyfillURL.getBlobFromURL(url);
  if (!blob) {
    throw new TypeError('Invalid Blob URL');
  }
  return new PonyfillResponse(blob, {
    status: 200,
    headers: {
      'content-type': blob.type,
      'content-length': blob.size.toString(),
    },
  });
}

function isURL(obj: any): obj is URL {
  return obj != null && obj.href != null;
}

let fetchFn$: Promise<typeof fetchNodeHttp>;
let fetchFn: typeof fetchNodeHttp;

function getNativeGlobalDispatcher(): import('undici').Dispatcher {
  // @ts-expect-error - We know it is there
  return globalThis[Symbol.for('undici.globalDispatcher.1')];
}

function createFetchFn() {
  const libcurlModuleName = 'node-libcurl';
  const undiciModuleName = 'undici';
  if (process.env.DEBUG) {
    console.debug(
      `[@whatwg-node/node-fetch] - Trying to import ${libcurlModuleName} for fetch ponyfill`,
    );
  }
  return import(libcurlModuleName).then(
    libcurl => createFetchCurl(libcurl),
    () => {
      if (process.env.DEBUG) {
        console.debug(
          `[@whatwg-node/node-fetch] - Failed to import ${libcurlModuleName}, trying ${undiciModuleName}`,
        );
      }
      return import(undiciModuleName).then(
        (undici: typeof import('undici')) => createFetchUndici(() => undici.getGlobalDispatcher()),
        () => {
          if (process.env.DEBUG) {
            console.debug(
              `[@whatwg-node/node-fetch] - Failed to import ${undiciModuleName}, falling back to built-in undici in Node`,
            );
          }
          return createFetchUndici(getNativeGlobalDispatcher);
        },
      );
    },
  );
}

function fetchNonHttp(fetchRequest: PonyfillRequest) {
  if (fetchRequest.url.startsWith('data:')) {
    const response = getResponseForDataUri(fetchRequest.url);
    return fakePromise(response);
  }

  if (fetchRequest.url.startsWith('file:')) {
    const response = getResponseForFile(fetchRequest.url);
    return fakePromise(response);
  }
  if (fetchRequest.url.startsWith('blob:')) {
    const response = getResponseForBlob(fetchRequest.url);
    return fakePromise(response);
  }
}

function normalizeInfo(info: string | PonyfillRequest | URL, init?: RequestPonyfillInit) {
  if (typeof info === 'string' || isURL(info)) {
    return new PonyfillRequest(info, init);
  }
  return info;
}

export function createFetchPonyfill(fetchFn: typeof fetchNodeHttp) {
  return function fetchPonyfill<TResponseJSON = any, TRequestJSON = any>(
    info: string | PonyfillRequest<TRequestJSON> | URL,
    init?: RequestPonyfillInit,
  ): Promise<PonyfillResponse<TResponseJSON>> {
    info = normalizeInfo(info, init);

    const nonHttpRes = fetchNonHttp(info);

    if (nonHttpRes) {
      return nonHttpRes;
    }

    return fetchFn(info);
  };
}

export function fetchPonyfill<TResponseJSON = any, TRequestJSON = any>(
  info: string | PonyfillRequest<TRequestJSON> | URL,
  init?: RequestPonyfillInit,
): Promise<PonyfillResponse<TResponseJSON>> {
  info = normalizeInfo(info, init);

  const nonHttpRes = fetchNonHttp(info);

  if (nonHttpRes) {
    return nonHttpRes;
  }

  if (!fetchFn) {
    fetchFn$ ||= createFetchFn();
    if (isPromise(fetchFn$)) {
      return fetchFn$.then(newFetchFn => {
        fetchFn = newFetchFn;
        return fetchFn(info);
      });
    }
    fetchFn = fetchFn$;
  }

  return fetchFn(info);
}
