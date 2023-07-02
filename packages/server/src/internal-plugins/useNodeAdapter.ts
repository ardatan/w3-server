import { IncomingMessage, ServerResponse } from 'node:http';
import { Http2ServerRequest, Http2ServerResponse } from 'node:http2';
import { Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { URL } from '@whatwg-node/fetch';
import type { ServerAdapterPlugin } from '../plugins/types.js';
import { completeAssign, isAsyncIterable } from '../utils.js';

interface NodeServerContext {
  req: NodeRequest;
  res?: NodeResponse;
}

export function useNodeAdapter(): ServerAdapterPlugin<NodeServerContext> {
  const nodeResponseMap = new WeakMap<Request, NodeResponse>();
  return {
    onRequestAdapt({ args: [req, res, ...restOfCtx], setRequest, setServerContext, fetchAPI }) {
      if (isNodeRequest(req)) {
        const defaultServerContext: NodeServerContext = {
          req,
        };
        const request = normalizeNodeRequest(req, fetchAPI.Request);
        setRequest(request);
        let ctxParams = restOfCtx;
        if (isServerResponse(res)) {
          defaultServerContext.res = res;
          nodeResponseMap.set(request, res);
        } else {
          ctxParams = [res, ...restOfCtx];
        }
        const serverContext =
          ctxParams.length > 0 ? completeAssign(...ctxParams) : defaultServerContext;
        setServerContext(serverContext);
      }
    },
    onResponse({ request, response }) {
      const nodeResponse = nodeResponseMap.get(request);
      if (nodeResponse) {
        return sendNodeResponse(response, nodeResponse);
      }
    },
  };
}

export interface NodeRequest {
  protocol?: string;
  hostname?: string;
  body?: any;
  url?: string;
  originalUrl?: string;
  method?: string;
  headers?: any;
  req?: IncomingMessage | Http2ServerRequest;
  raw?: IncomingMessage | Http2ServerRequest;
  socket?: Socket;
  query?: any;
}

export type NodeResponse = ServerResponse | Http2ServerResponse;

export function isReadable(stream: any): stream is Readable {
  return stream.read != null;
}

export function isNodeRequest(request: any): request is NodeRequest {
  return isReadable(request);
}

export function isServerResponse(stream: any): stream is NodeResponse {
  // Check all used functions are defined
  return (
    stream != null &&
    stream.setHeader != null &&
    stream.end != null &&
    stream.once != null &&
    stream.write != null
  );
}

function getPort(nodeRequest: NodeRequest) {
  if (nodeRequest.socket?.localPort) {
    return nodeRequest.socket?.localPort;
  }
  const hostInHeader = nodeRequest.headers?.[':authority'] || nodeRequest.headers?.host;
  const portInHeader = hostInHeader?.split(':')?.[1];
  if (portInHeader) {
    return portInHeader;
  }
  return 80;
}

function getHostnameWithPort(nodeRequest: NodeRequest) {
  if (nodeRequest.headers?.[':authority']) {
    return nodeRequest.headers?.[':authority'];
  }
  if (nodeRequest.headers?.host) {
    return nodeRequest.headers?.host;
  }
  const port = getPort(nodeRequest);
  if (nodeRequest.hostname) {
    return nodeRequest.hostname + ':' + port;
  }
  const localIp = nodeRequest.socket?.localAddress;
  if (localIp && !localIp?.includes('::') && !localIp?.includes('ffff')) {
    return `${localIp}:${port}`;
  }
  return 'localhost';
}

function buildFullUrl(nodeRequest: NodeRequest) {
  const hostnameWithPort = getHostnameWithPort(nodeRequest);
  const protocol = nodeRequest.protocol || 'http';
  const endpoint = nodeRequest.originalUrl || nodeRequest.url || '/graphql';

  return `${protocol}://${hostnameWithPort}${endpoint}`;
}

function isRequestBody(body: any): body is BodyInit {
  const stringTag = body[Symbol.toStringTag];
  if (
    typeof body === 'string' ||
    stringTag === 'Uint8Array' ||
    stringTag === 'Blob' ||
    stringTag === 'FormData' ||
    stringTag === 'URLSearchParams' ||
    isAsyncIterable(body)
  ) {
    return true;
  }
  return false;
}

export function normalizeNodeRequest(
  nodeRequest: NodeRequest,
  RequestCtor: typeof Request,
): Request {
  const rawRequest = nodeRequest.raw || nodeRequest.req || nodeRequest;
  let fullUrl = buildFullUrl(rawRequest);
  if (nodeRequest.query) {
    const url = new URL(fullUrl);
    for (const key in nodeRequest.query) {
      url.searchParams.set(key, nodeRequest.query[key]);
    }
    fullUrl = url.toString();
  }

  if (nodeRequest.method === 'GET' || nodeRequest.method === 'HEAD') {
    return new RequestCtor(fullUrl, {
      method: nodeRequest.method,
      headers: nodeRequest.headers,
    });
  }

  /**
   * Some Node server frameworks like Serverless Express sends a dummy object with body but as a Buffer not string
   * so we do those checks to see is there something we can use directly as BodyInit
   * because the presence of body means the request stream is already consumed and,
   * rawRequest cannot be used as BodyInit/ReadableStream by Fetch API in this case.
   */
  const maybeParsedBody = nodeRequest.body;
  if (maybeParsedBody != null && Object.keys(maybeParsedBody).length > 0) {
    if (isRequestBody(maybeParsedBody)) {
      return new RequestCtor(fullUrl, {
        method: nodeRequest.method,
        headers: nodeRequest.headers,
        body: maybeParsedBody,
      });
    }
    const request = new RequestCtor(fullUrl, {
      method: nodeRequest.method,
      headers: nodeRequest.headers,
    });
    if (!request.headers.get('content-type')?.includes('json')) {
      request.headers.set('content-type', 'application/json; charset=utf-8');
    }
    return new Proxy(request, {
      get: (target, prop: keyof Request, receiver) => {
        switch (prop) {
          case 'json':
            return async () => maybeParsedBody;
          case 'text':
            return async () => JSON.stringify(maybeParsedBody);
          default:
            return Reflect.get(target, prop, receiver);
        }
      },
    });
  }

  // perf: instead of spreading the object, we can just pass it as is and it performs better
  return new RequestCtor(fullUrl, {
    method: nodeRequest.method,
    headers: nodeRequest.headers,
    body: rawRequest as any,
  });
}

function configureSocket(rawRequest: NodeRequest) {
  rawRequest?.socket?.setTimeout?.(0);
  rawRequest?.socket?.setNoDelay?.(true);
  rawRequest?.socket?.setKeepAlive?.(true);
}

function endResponse(serverResponse: NodeResponse) {
  // @ts-expect-error Avoid arguments adaptor trampoline https://v8.dev/blog/adaptor-frame
  serverResponse.end(null, null, null);
}

async function sendAsyncIterable(
  serverResponse: NodeResponse,
  asyncIterable: AsyncIterable<Uint8Array>,
) {
  for await (const chunk of asyncIterable) {
    if (
      !serverResponse
        // @ts-expect-error http and http2 writes are actually compatible
        .write(chunk)
    ) {
      break;
    }
  }
  endResponse(serverResponse);
}

export function sendNodeResponse(fetchResponse: Response, serverResponse: NodeResponse) {
  serverResponse.statusCode = fetchResponse.status;
  serverResponse.statusMessage = fetchResponse.statusText;

  fetchResponse.headers.forEach((value, key) => {
    if (key === 'set-cookie') {
      const setCookies = fetchResponse.headers.getSetCookie?.();
      if (setCookies) {
        serverResponse.setHeader('set-cookie', setCookies);
        return;
      }
    }
    serverResponse.setHeader(key, value);
  });

  // Optimizations for node-fetch
  if (
    (fetchResponse as any).bodyType === 'Buffer' ||
    (fetchResponse as any).bodyType === 'String' ||
    (fetchResponse as any).bodyType === 'Uint8Array'
  ) {
    // @ts-expect-error http and http2 writes are actually compatible
    serverResponse.write(fetchResponse.bodyInit);
    endResponse(serverResponse);
    return;
  }

  // Other fetch implementations
  const fetchBody = fetchResponse.body;
  if (fetchBody == null) {
    endResponse(serverResponse);
    return;
  }

  if ((fetchBody as any)[Symbol.toStringTag] === 'Uint8Array') {
    serverResponse
      // @ts-expect-error http and http2 writes are actually compatible
      .write(fetchBody);
    endResponse(serverResponse);
    return;
  }

  configureSocket(serverResponse.req);

  if (isReadable(fetchBody)) {
    serverResponse.once('close', () => {
      fetchBody.destroy();
    });
    fetchBody.pipe(serverResponse);
    return;
  }

  if (isAsyncIterable(fetchBody)) {
    return sendAsyncIterable(serverResponse, fetchBody);
  }
}
