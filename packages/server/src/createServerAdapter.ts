/* eslint-disable @typescript-eslint/ban-types */
import { Readable } from 'stream';
import * as DefaultFetchAPI from '@whatwg-node/fetch';
import { OnRequestHook, OnResponseHook, ServerAdapterPlugin } from './plugins/types.js';
import {
  FetchAPI,
  FetchEvent,
  ServerAdapter,
  ServerAdapterBaseObject,
  ServerAdapterObject,
  ServerAdapterRequestHandler,
} from './types.js';
import {
  isFetchEvent,
  isNodeRequest,
  isRequestInit,
  isServerResponse,
  NodeRequest,
  NodeResponse,
  normalizeNodeRequest,
  sendNodeResponse,
} from './utils.js';
import { isUWSResponse, UWSRequest, UWSResponse } from './uwebsockets.js';

async function handleWaitUntils(waitUntilPromises: Promise<unknown>[]) {
  const waitUntils = await Promise.allSettled(waitUntilPromises);
  waitUntils.forEach(waitUntil => {
    if (waitUntil.status === 'rejected') {
      console.error(waitUntil.reason);
    }
  });
}

type RequestContainer = { request: Request };

// Required for envs like nextjs edge runtime
function isRequestAccessible(serverContext: any): serverContext is RequestContainer {
  try {
    return !!serverContext?.request;
  } catch {
    return false;
  }
}

export interface ServerAdapterOptions<TServerContext> {
  plugins?: ServerAdapterPlugin<TServerContext>[];
  fetchAPI?: Partial<FetchAPI>;
}

function createServerAdapter<
  TServerContext = {},
  THandleRequest extends ServerAdapterRequestHandler<TServerContext> = ServerAdapterRequestHandler<TServerContext>,
>(
  serverAdapterRequestHandler: THandleRequest,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, ServerAdapterBaseObject<TServerContext, THandleRequest>>;
function createServerAdapter<
  TServerContext,
  TBaseObject extends ServerAdapterBaseObject<TServerContext>,
>(
  serverAdapterBaseObject: TBaseObject,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, TBaseObject>;
function createServerAdapter<
  TServerContext = {},
  THandleRequest extends ServerAdapterRequestHandler<TServerContext> = ServerAdapterRequestHandler<TServerContext>,
  TBaseObject extends ServerAdapterBaseObject<
    TServerContext,
    THandleRequest
  > = ServerAdapterBaseObject<TServerContext, THandleRequest>,
>(
  serverAdapterBaseObject: TBaseObject | THandleRequest,
  options?: ServerAdapterOptions<TServerContext>,
): ServerAdapter<TServerContext, TBaseObject> {
  const fetchAPI = {
    ...DefaultFetchAPI,
    ...options?.fetchAPI,
  };
  const givenHandleRequest =
    typeof serverAdapterBaseObject === 'function'
      ? serverAdapterBaseObject
      : serverAdapterBaseObject.handle;

  const onRequestHooks: OnRequestHook<TServerContext>[] = [];
  const onResponseHooks: OnResponseHook<TServerContext>[] = [];

  if (options?.plugins != null) {
    for (const plugin of options.plugins) {
      if (plugin.onRequest) {
        onRequestHooks.push(plugin.onRequest);
      }
      if (plugin.onResponse) {
        onResponseHooks.push(plugin.onResponse);
      }
    }
  }

  async function handleRequest(request: Request, serverContext: TServerContext) {
    let url = new Proxy({} as URL, {
      get: (_target, prop, _receiver) => {
        url = new fetchAPI.URL(request.url, 'http://localhost');
        return Reflect.get(url, prop, url);
      },
    }) as URL;
    let requestHandler: ServerAdapterRequestHandler<TServerContext> = givenHandleRequest;
    let response: Response | undefined;
    for (const onRequestHook of onRequestHooks) {
      await onRequestHook({
        request,
        serverContext,
        fetchAPI,
        url,
        requestHandler,
        setRequestHandler(newRequestHandler) {
          requestHandler = newRequestHandler;
        },
        endResponse(newResponse) {
          response = newResponse;
        },
      });
      if (response) {
        break;
      }
    }
    if (!response) {
      response = await requestHandler(request, serverContext);
    }
    for (const onResponseHook of onResponseHooks) {
      await onResponseHook({
        request,
        response,
        serverContext,
      });
    }
    return response;
  }

  function handleNodeRequest(nodeRequest: NodeRequest, ...ctx: Partial<TServerContext>[]) {
    const serverContext = ctx.length > 1 ? completeAssign({}, ...ctx) : ctx[0];
    const request = normalizeNodeRequest(nodeRequest, fetchAPI.Request);
    return handleRequest(request, serverContext);
  }

  async function requestListener(
    nodeRequest: NodeRequest,
    serverResponse: NodeResponse,
    ...ctx: Partial<TServerContext>[]
  ) {
    const waitUntilPromises: Promise<unknown>[] = [];
    const defaultServerContext = {
      req: nodeRequest,
      res: serverResponse,
      waitUntil(promise: Promise<void> | void) {
        if (promise != null) {
          waitUntilPromises.push(promise);
        }
      },
    };
    const response = await handleNodeRequest(nodeRequest, defaultServerContext as any, ...ctx);
    if (response) {
      await sendNodeResponse(response, serverResponse, nodeRequest);
    } else {
      await new Promise<void>(resolve => {
        serverResponse.statusCode = 404;
        serverResponse.once('end', resolve);
        serverResponse.end();
      });
    }
    if (waitUntilPromises.length > 0) {
      await handleWaitUntils(waitUntilPromises);
    }
  }

  async function handleUWS(res: UWSResponse, req: UWSRequest, ...ctx: Partial<TServerContext>[]) {
    const waitUntilPromises: Promise<unknown>[] = [];
    const serverContext = completeAssign(
      {
        res,
        req,
        waitUntil(promise: Promise<void> | void) {
          if (promise != null) {
            waitUntilPromises.push(promise);
          }
        },
      },
      ...ctx,
    );
    let body: (ReadableStream & { readable: Readable }) | undefined;
    const method = req.getMethod();
    let resAborted = false;
    res.onAborted(function () {
      resAborted = true;
      body?.readable.push(null);
    });
    if (method !== 'get' && method !== 'head') {
      body = new fetchAPI.ReadableStream({}) as ReadableStream & { readable: Readable };
      res.onData(function (chunk, isLast) {
        body?.readable.push(Buffer.from(chunk, 0, chunk.byteLength));
        if (isLast) {
          body?.readable.push(null);
        }
      });
    }
    const headers: Record<string, string> = {};
    req.forEach((key, value) => {
      headers[key] = value;
    });
    const url = `http://localhost${req.getUrl()}`;
    const request = new fetchAPI.Request(url, {
      method,
      headers,
      body,
    });
    const response = await handleRequest(request, serverContext);
    if (resAborted) {
      return;
    }
    if (!response) {
      res.writeStatus('404 Not Found');
      res.end();
      return;
    }
    res.cork(() => {
      res.writeStatus(`${response.status} ${response.statusText}`);
    });
    response.headers.forEach((value, key) => {
      // content-length causes an error with Node.js's fetch
      if (key.toLowerCase() !== 'content-length') {
        res.cork(() => {
          res.writeHeader(key, value);
        });
      }
    });
    if (!response.body) {
      res.end();
      return;
    }
    if ((response as any).bodyType === 'String' || (response as any).bodyType === 'Uint8Array') {
      res.cork(() => {
        res.end((response as any).bodyInit);
      });
      return;
    }
    for await (const chunk of (response.body as any).readable) {
      if (resAborted) {
        return;
      }
      res.cork(() => {
        res.write(chunk);
      });
    }
    res.cork(() => {
      res.end();
    });
  }

  function handleEvent(event: FetchEvent, ...ctx: Partial<TServerContext>[]): void {
    if (!event.respondWith || !event.request) {
      throw new TypeError(`Expected FetchEvent, got ${event}`);
    }
    const serverContext = ctx.length > 0 ? Object.assign({}, event, ...ctx) : event;
    const response$ = handleRequest(event.request, serverContext);
    event.respondWith(response$);
  }

  function handleRequestWithWaitUntil(request: Request, ...ctx: Partial<TServerContext>[]) {
    const serverContext = ctx.length > 1 ? completeAssign({}, ...ctx) : ctx[0] || {};
    if (!('waitUntil' in serverContext)) {
      const waitUntilPromises: Promise<void>[] = [];
      const response$ = handleRequest(request, {
        ...serverContext,
        waitUntil(promise: Promise<void> | void) {
          if (promise != null) {
            waitUntilPromises.push(promise);
          }
        },
      });
      if (waitUntilPromises.length > 0) {
        return handleWaitUntils(waitUntilPromises).then(() => response$);
      }
      return response$;
    }
    return handleRequest(request, serverContext);
  }

  const fetchFn: ServerAdapterObject<TServerContext>['fetch'] = (
    input,
    ...maybeCtx: Partial<TServerContext>[]
  ) => {
    if (typeof input === 'string' || 'href' in input) {
      const [initOrCtx, ...restOfCtx] = maybeCtx;
      if (isRequestInit(initOrCtx)) {
        return handleRequestWithWaitUntil(new fetchAPI.Request(input, initOrCtx), ...restOfCtx);
      }
      return handleRequestWithWaitUntil(new fetchAPI.Request(input), ...maybeCtx);
    }
    return handleRequestWithWaitUntil(input, ...maybeCtx);
  };

  const genericRequestHandler = (
    input:
      | Request
      | FetchEvent
      | NodeRequest
      | ({ request: Request } & Partial<TServerContext>)
      | UWSResponse,
    ...maybeCtx: Partial<TServerContext>[]
  ): Promise<Response> | Response | Promise<void> | void => {
    // If it is a Node request
    const [initOrCtxOrRes, ...restOfCtx] = maybeCtx;
    if (isUWSResponse(input)) {
      return handleUWS(input, initOrCtxOrRes as any, ...restOfCtx);
    }

    if (isNodeRequest(input)) {
      if (!isServerResponse(initOrCtxOrRes)) {
        throw new TypeError(`Expected ServerResponse, got ${initOrCtxOrRes}`);
      }
      return requestListener(input, initOrCtxOrRes, ...restOfCtx);
    }

    if (isServerResponse(initOrCtxOrRes)) {
      throw new TypeError('Got Node response without Node request');
    }

    // Is input a container object over Request?
    if (isRequestAccessible(input)) {
      // Is it FetchEvent?
      if (isFetchEvent(input)) {
        return handleEvent(input, ...maybeCtx);
      }
      // In this input is also the context
      return handleRequestWithWaitUntil(input.request, input, ...maybeCtx);
    }

    // Or is it Request itself?
    // Then ctx is present and it is the context
    return fetchFn(input, ...maybeCtx);
  };

  const adapterObj: ServerAdapterObject<TServerContext> = {
    handleRequest,
    fetch: fetchFn,
    handleNodeRequest,
    requestListener,
    handleEvent,
    handleUWS,
    handle: genericRequestHandler as ServerAdapterObject<TServerContext>['handle'],
  };

  const serverAdapter = new Proxy(genericRequestHandler, {
    // It should have all the attributes of the handler function and the server instance
    has: (_, prop) => {
      return (
        prop in adapterObj ||
        prop in genericRequestHandler ||
        (serverAdapterBaseObject && prop in serverAdapterBaseObject)
      );
    },
    get: (_, prop) => {
      const adapterProp = (adapterObj as any)[prop];
      if (adapterProp) {
        if (adapterProp.bind) {
          return adapterProp.bind(adapterObj);
        }
        return adapterProp;
      }
      const handleProp = (genericRequestHandler as any)[prop];
      if (handleProp) {
        if (handleProp.bind) {
          return handleProp.bind(genericRequestHandler);
        }
        return handleProp;
      }
      if (serverAdapterBaseObject) {
        const serverAdapterBaseObjectProp = (serverAdapterBaseObject as any)[prop];
        if (serverAdapterBaseObjectProp) {
          if (serverAdapterBaseObjectProp.bind) {
            return function (...args: any[]) {
              const returnedVal = (serverAdapterBaseObject as any)[prop](...args);
              if (returnedVal === serverAdapterBaseObject) {
                return serverAdapter;
              }
              return returnedVal;
            };
          }
          return serverAdapterBaseObjectProp;
        }
      }
    },
    apply(_, __, args: Parameters<ServerAdapterObject<TServerContext>['handle']>) {
      return genericRequestHandler(...args);
    },
  });
  return serverAdapter as any;
}

export { createServerAdapter };

// from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#copying_accessors
function completeAssign(target: any, ...sources: any[]) {
  sources.forEach(source => {
    if (source != null && typeof source === 'object') {
      // modified Object.keys to Object.getOwnPropertyNames
      // because Object.keys only returns enumerable properties
      const descriptors: any = Object.getOwnPropertyNames(source).reduce(
        (descriptors: any, key) => {
          descriptors[key] = Object.getOwnPropertyDescriptor(source, key);
          return descriptors;
        },
        {},
      );

      // By default, Object.assign copies enumerable Symbols, too
      Object.getOwnPropertySymbols(source).forEach(sym => {
        const descriptor = Object.getOwnPropertyDescriptor(source, sym);
        if (descriptor!.enumerable) {
          descriptors[sym] = descriptor;
        }
      });

      Object.defineProperties(target, descriptors);
    }
  });
  return target;
}
