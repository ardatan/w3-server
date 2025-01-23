import { PassThrough, Readable } from 'node:stream';
import { isUint8Array } from 'node:util/types';
import { createBrotliDecompress, createGunzip, createInflate, createInflateRaw } from 'node:zlib';
import { fetchNodeHttp } from './fetchNodeHttp.js';
import { PonyfillRequest } from './Request.js';
import { PonyfillResponse } from './Response.js';
import { PonyfillURL } from './URL.js';
import { createDeferredPromise, getHeadersObj, isNodeReadable } from './utils.js';

export function createFetchUndici(getGlobalDispatcher: () => import('undici').Dispatcher) {
  return function fetchUndici<TResponseJSON = any, TRequestJSON = any>(
    fetchRequest: PonyfillRequest<TRequestJSON>,
  ): Promise<PonyfillResponse<TResponseJSON>> {
    const dispatcher = fetchRequest.dispatcher || getGlobalDispatcher();
    if (!dispatcher) {
      if (process.env.DEBUG) {
        console.debug(
          '[@whatwg-node/node-fetch] - native undici dispatcher not available, falling back to node:http',
        );
      }
      return fetchNodeHttp(fetchRequest);
    }
    const deferred = createDeferredPromise<PonyfillResponse<TResponseJSON>>();
    let abortListener: EventListener;
    let passthrough: PassThrough;
    let response: PonyfillResponse<TResponseJSON>;

    let body:
      | string
      | Readable
      | Buffer<ArrayBufferLike>
      | Uint8Array<ArrayBufferLike>
      | FormData
      | null = null;
    const bodyInit = fetchRequest['bodyInit'];
    if (bodyInit != null) {
      if (
        typeof bodyInit === 'string' ||
        Buffer.isBuffer(bodyInit) ||
        isUint8Array(bodyInit) ||
        bodyInit instanceof Readable
      ) {
        body = bodyInit;
      } else if (fetchRequest.body != null) {
        if (isNodeReadable(fetchRequest.body?.readable)) {
          body = fetchRequest.body.readable;
        } else {
          body = Readable.from(fetchRequest.body);
        }
      }
    }
    function setPassthrough(contentEncoding: string | string[] | undefined) {
      switch (contentEncoding) {
        case 'x-gzip':
        case 'gzip':
          passthrough = createGunzip();
          break;
        case 'x-deflate':
        case 'deflate':
          passthrough = createInflate();
          break;
        case 'x-deflate-raw':
        case 'deflate-raw':
          passthrough = createInflateRaw();
          break;
        case 'br':
          passthrough = createBrotliDecompress();
          break;
        default:
          passthrough = new PassThrough();
      }
      return passthrough;
    }
    function onAbort(e: any) {
      fetchRequest['_signal']?.removeEventListener('abort', abortListener);
      passthrough?.destroy(e);
      deferred.reject(e);
    }
    const headersSerializer: typeof getHeadersObj =
      (fetchRequest.headersSerializer as any) || getHeadersObj;
    const nodeHeaders = headersSerializer(fetchRequest.headers);
    if (nodeHeaders['accept-encoding'] == null) {
      nodeHeaders['accept-encoding'] = 'gzip, deflate, br';
    }
    const dispatcherReturn = dispatcher.dispatch(
      {
        origin: fetchRequest.parsedUrl.origin,
        path: fetchRequest.parsedUrl.pathname,
        query: Object.fromEntries(fetchRequest.parsedUrl.searchParams),
        method: fetchRequest.method,
        headers: nodeHeaders,
        body,
      },
      {
        onRequestStart(controller) {
          abortListener = function abortListener() {
            onAbort(fetchRequest['_signal']?.reason);
            controller.abort(fetchRequest['_signal']?.reason);
          };
          fetchRequest['_signal']?.addEventListener('abort', abortListener, { once: true });
        },
        onRequestUpgrade(_controller, statusCode, headers, socket) {
          response = new PonyfillResponse<TResponseJSON>(socket, {
            status: statusCode,
            headers: headers as HeadersInit,
            url: fetchRequest.url,
          });
          deferred.resolve(response);
          fetchRequest['_signal']?.removeEventListener('abort', abortListener);
        },
        onResponseStart(controller, statusCode, headers, statusMessage) {
          if (headers.location) {
            if (fetchRequest.redirect === 'error') {
              const redirectError = new Error('Redirects are not allowed');
              deferred.reject(redirectError);
              controller.resume();
              return;
            }
            if (fetchRequest.redirect === 'follow') {
              const redirectedUrl = new PonyfillURL(
                headers.location as string,
                fetchRequest.parsedUrl || fetchRequest.url,
              );
              const redirectResponse$ = fetchUndici(
                new PonyfillRequest(redirectedUrl, fetchRequest),
              );
              deferred.resolve(
                redirectResponse$.then(redirectResponse => {
                  redirectResponse.redirected = true;
                  return redirectResponse;
                }),
              );
              controller.resume();
              return;
            }
          }
          passthrough = setPassthrough(headers['content-encoding']);
          deferred.resolve(
            new PonyfillResponse<TResponseJSON>(passthrough, {
              status: statusCode,
              statusText: statusMessage!,
              headers: headers as HeadersInit,
              url: fetchRequest.url,
            }),
          );
        },
        onResponseData(controller, chunk) {
          passthrough.write(chunk);
          if (controller.reason) {
            onAbort(controller.reason);
          }
        },
        onResponseEnd(controller, _trailers) {
          if (controller.reason) {
            onAbort(controller.reason);
          } else {
            passthrough.end();
            fetchRequest['_signal']?.removeEventListener('abort', abortListener);
          }
        },
        onResponseError(controller, error) {
          onAbort(error || controller.reason);
        },

        // Old Undici support

        onConnect(abort) {
          abortListener = function abortListener() {
            abort(fetchRequest['_signal']?.reason);
            onAbort(fetchRequest['_signal']?.reason);
          };
          fetchRequest['_signal']?.addEventListener('abort', abortListener, { once: true });
        },
        onError(error) {
          onAbort(error);
        },
        // TODO: onUpgrade
        onHeaders(statusCode, headersBuf, _resume, statusText) {
          const headers = headersBuf.map(headerBuf => {
            const header = headerBuf
              .toString('utf-8')
              .split(/:\s(.+)/)
              .slice(0, 2) as [string, string];
            if (header[0] === 'content-encoding') {
              const contentEncoding = header[1];
              setPassthrough(contentEncoding);
            }
            return header;
          });
          passthrough ||= new PassThrough();
          deferred.resolve(
            new PonyfillResponse<TResponseJSON>(passthrough, {
              status: statusCode,
              statusText,
              headers,
              url: fetchRequest.url,
            }),
          );
          return true;
        },
        onData(chunk) {
          return passthrough.write(chunk);
        },
        onComplete() {
          passthrough.end();
          fetchRequest['_signal']?.removeEventListener('abort', abortListener);
        },
      },
    );
    if (!dispatcherReturn) {
      console.warn('Undici dispatcher returned false');
    }
    return deferred.promise;
  };
}
