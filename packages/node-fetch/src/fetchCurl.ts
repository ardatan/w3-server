import { Buffer } from 'node:buffer';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { rootCertificates } from 'node:tls';
import { PonyfillRequest } from './Request.js';
import { PonyfillResponse } from './Response.js';
import { createDeferredPromise, defaultHeadersSerializer, isNodeReadable } from './utils.js';

export function createFetchCurl(nodeLibcurl: typeof import('node-libcurl')) {
  return function fetchCurl<TResponseJSON = any, TRequestJSON = any>(
    fetchRequest: PonyfillRequest<TRequestJSON>,
  ): Promise<PonyfillResponse<TResponseJSON>> {
    const { Curl, CurlFeature, CurlPause, CurlProgressFunc } = nodeLibcurl;
    const curlHandle = new Curl();

    curlHandle.enable(CurlFeature.NoDataParsing);

    curlHandle.setOpt('URL', fetchRequest.url);

    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      curlHandle.setOpt('SSL_VERIFYPEER', false);
    }

    if (process.env.NODE_EXTRA_CA_CERTS) {
      curlHandle.setOpt('CAINFO', process.env.NODE_EXTRA_CA_CERTS);
    } else {
      curlHandle.setOpt('CAINFO_BLOB', rootCertificates.join('\n'));
    }

    curlHandle.enable(CurlFeature.StreamResponse);

    curlHandle.setStreamProgressCallback(function () {
      return fetchRequest['_signal']?.aborted
        ? process.env.DEBUG
          ? CurlProgressFunc.Continue
          : 1
        : 0;
    });

    if (fetchRequest['bodyType'] === 'String') {
      curlHandle.setOpt('POSTFIELDS', fetchRequest['bodyInit'] as string);
    } else {
      const nodeReadable = (
        fetchRequest.body != null
          ? isNodeReadable(fetchRequest.body)
            ? fetchRequest.body
            : Readable.from(fetchRequest.body)
          : null
      ) as Readable | null;

      if (nodeReadable) {
        curlHandle.setOpt('UPLOAD', true);
        curlHandle.setUploadStream(nodeReadable);
      }
    }

    if (process.env.DEBUG) {
      curlHandle.setOpt('VERBOSE', true);
    }

    curlHandle.setOpt('TRANSFER_ENCODING', false);
    curlHandle.setOpt('HTTP_TRANSFER_DECODING', true);
    curlHandle.setOpt('FOLLOWLOCATION', fetchRequest.redirect === 'follow');
    curlHandle.setOpt('MAXREDIRS', 20);
    curlHandle.setOpt('ACCEPT_ENCODING', '');
    curlHandle.setOpt('CUSTOMREQUEST', fetchRequest.method);

    const headersSerializer = fetchRequest.headersSerializer || defaultHeadersSerializer;

    let size: number | undefined;

    const curlHeaders: string[] = headersSerializer(fetchRequest.headers, value => {
      size = Number(value);
    });

    if (size != null) {
      curlHandle.setOpt('INFILESIZE', size);
    }

    curlHandle.setOpt('HTTPHEADER', curlHeaders);

    curlHandle.enable(CurlFeature.NoHeaderParsing);

    const deferredPromise = createDeferredPromise<PonyfillResponse<TResponseJSON>>();
    let streamResolved: Readable | undefined;
    function onAbort() {
      if (curlHandle.isOpen) {
        try {
          curlHandle.pause(CurlPause.Recv);
        } catch (e) {
          deferredPromise.reject(e);
        }
      }
    }
    if (fetchRequest['_signal']) {
      fetchRequest['_signal'].addEventListener('abort', onAbort, { once: true });
    }
    curlHandle.once('end', function endListener() {
      try {
        curlHandle.close();
      } catch (e) {
        deferredPromise.reject(e);
      }
      if (fetchRequest['_signal']) {
        fetchRequest['_signal'].removeEventListener('abort', onAbort);
      }
    });
    curlHandle.once('error', function errorListener(error: any) {
      if (streamResolved && !streamResolved.closed && !streamResolved.destroyed) {
        streamResolved.destroy(error);
      } else {
        if (error.message === 'Operation was aborted by an application callback') {
          error.message = 'The operation was aborted.';
        }
        deferredPromise.reject(error);
      }
      try {
        curlHandle.close();
      } catch (e) {
        deferredPromise.reject(e);
      }
    });
    curlHandle.once(
      'stream',
      function streamListener(stream: Readable, status: number, headersBuf: Buffer) {
        const outputStream = new PassThrough();

        pipeline(stream, outputStream, {
          end: true,
          signal: fetchRequest['_signal'] ?? undefined,
        })
          .then(() => {
            if (!stream.destroyed) {
              stream.resume();
            }
          })
          .catch(deferredPromise.reject);
        const headersFlat = headersBuf
          .toString('utf8')
          .split(/\r?\n|\r/g)
          .filter(headerFilter => {
            if (headerFilter && !headerFilter.startsWith('HTTP/')) {
              if (
                fetchRequest.redirect === 'error' &&
                (headerFilter.includes('location') || headerFilter.includes('Location'))
              ) {
                if (!stream.destroyed) {
                  stream.resume();
                }
                outputStream.destroy();
                deferredPromise.reject(new Error('redirect is not allowed'));
              }
              return true;
            }
            return false;
          });
        const headersInit = headersFlat.map(
          headerFlat => headerFlat.split(/:\s(.+)/).slice(0, 2) as [string, string],
        );
        const ponyfillResponse = new PonyfillResponse(outputStream, {
          status,
          headers: headersInit,
          url: curlHandle.getInfo(Curl.info.REDIRECT_URL)?.toString() || fetchRequest.url,
          redirected: Number(curlHandle.getInfo(Curl.info.REDIRECT_COUNT)) > 0,
        });
        deferredPromise.resolve(ponyfillResponse);
        streamResolved = outputStream;
      },
    );
    let count = 0;
    try {
      count = Curl.getCount();
    } catch {}
    if (count > 0) {
      setImmediate(() => {
        curlHandle.perform();
      });
    } else {
      curlHandle.perform();
    }
    return deferredPromise.promise;
  };
}
