/* eslint-disable @typescript-eslint/ban-types */
import * as DefaultFetchAPI from '@whatwg-node/fetch';
import { useFetchEvent } from './internal-plugins/useFetchEvent.js';
import { useNodeAdapter } from './internal-plugins/useNodeAdapter.js';
import { useUWSAdapter } from './internal-plugins/useUWSAdapter.js';
import {
  OnRequestAdapt,
  OnRequestHook,
  OnResponseHook,
  ServerAdapterPlugin,
} from './plugins/types.js';
import {
  FetchAPI,
  ServerAdapter,
  ServerAdapterBaseObject,
  ServerAdapterObject,
  ServerAdapterRequestHandler,
} from './types.js';
import { completeAssign, isRequestInit } from './utils.js';

export interface ServerAdapterOptions<TServerContext> {
  plugins?: ServerAdapterPlugin<TServerContext>[];
  fetchAPI?: Partial<FetchAPI>;
}

const EMPTY_OBJECT = {};

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

  const onRequestAdaptHooks: OnRequestAdapt<TServerContext>[] = [];
  const onRequestHooks: OnRequestHook<TServerContext>[] = [];
  const onResponseHooks: OnResponseHook<TServerContext>[] = [];

  const plugins = options?.plugins ?? [];

  (plugins as any).push(useUWSAdapter(), useNodeAdapter(), useFetchEvent());

  for (const plugin of plugins) {
    if (plugin.onRequestAdapt) {
      onRequestAdaptHooks.push(plugin.onRequestAdapt);
    }
    if (plugin.onRequest) {
      onRequestHooks.push(plugin.onRequest);
    }
    if (plugin.onResponse) {
      onResponseHooks.push(plugin.onResponse);
    }
  }

  async function handleRequest(request: Request, serverContext: TServerContext) {
    let url = new Proxy(EMPTY_OBJECT as URL, {
      get(_target, prop, _receiver) {
        url = new fetchAPI.URL(request.url, 'http://localhost');
        return Reflect.get(url, prop, url);
      },
    }) as URL;
    let requestHandler: ServerAdapterRequestHandler<any> = givenHandleRequest;
    let response: Response | undefined;
    let waitUntilPromises: Set<Promise<unknown>> | undefined;
    if ((serverContext as any)['waitUntil'] == null) {
      waitUntilPromises = new Set();
      (serverContext as any)['waitUntil'] = (promise: Promise<unknown>) => {
        waitUntilPromises!.add(promise);
        promise.then(() => {
          waitUntilPromises!.delete(promise);
        });
      };
    }
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
    if (!response) {
      response = new fetchAPI.Response(undefined, {
        status: 404,
        statusText: 'Not Found',
      });
    }
    for (const onResponseHook of onResponseHooks) {
      await onResponseHook({
        request,
        response,
        serverContext,
      });
    }
    if (waitUntilPromises?.size) {
      const waitUntils = await Promise.allSettled(waitUntilPromises);
      waitUntils.forEach(waitUntil => {
        if (waitUntil.status === 'rejected') {
          console.error(waitUntil.reason);
        }
      });
    }
    return response;
  }

  const fetchFn: ServerAdapterObject<TServerContext>['fetch'] = (
    input,
    ...maybeCtx: Partial<TServerContext>[]
  ) => {
    if (typeof input === 'string' || 'href' in input) {
      const [initOrCtx, ...restOfCtx] = maybeCtx;
      if (isRequestInit(initOrCtx)) {
        const serverContext = restOfCtx.length > 0 ? completeAssign(...restOfCtx) : {};
        return handleRequest(new fetchAPI.Request(input, initOrCtx), serverContext);
      }
      const serverContext = maybeCtx.length > 0 ? completeAssign(...maybeCtx) : {};
      return handleRequest(new fetchAPI.Request(input), serverContext);
    }
    const serverContext = maybeCtx.length > 0 ? completeAssign(...maybeCtx) : {};
    return handleRequest(input, serverContext);
  };

  const genericRequestHandler = (
    ...args: [any, ...any[]]
  ): Promise<Response> | Response | Promise<void> | void => {
    let request: Request | undefined;
    let serverContext: TServerContext | undefined;

    for (const onRequestAdapt of onRequestAdaptHooks) {
      onRequestAdapt({
        args,
        setRequest(newRequest) {
          request = newRequest;
        },
        setServerContext(newServerContext) {
          serverContext = newServerContext;
        },
        fetchAPI,
      });
    }

    if (request) {
      if (!serverContext) {
        serverContext = {} as TServerContext;
      }
      return handleRequest(request, serverContext);
    }

    return fetchFn(...args);
  };

  const adapterObj: ServerAdapterObject<TServerContext> = {
    handleRequest,
    fetch: fetchFn,
    requestListener: genericRequestHandler,
    handleNodeRequest: genericRequestHandler as any,
    handleEvent: genericRequestHandler,
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
