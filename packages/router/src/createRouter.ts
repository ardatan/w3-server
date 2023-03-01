import * as DefaultFetchAPI from '@whatwg-node/fetch';
import { createServerAdapter, ServerAdapterOptions } from '@whatwg-node/server';
import { HTTPMethod, TypedRequest, TypedResponse } from '@whatwg-node/typed-fetch';
import type {
  AddRouteWithSchemasOpts,
  OnRouteHook,
  OnRouterInitHook,
  RouteHandler,
  Router,
  RouterBaseObject,
  RouterPlugin,
  RouterSDK,
  RouteSchemas,
} from './types';

export interface RouterOptions<TServerContext = {}> extends ServerAdapterOptions<TServerContext> {
  base?: string;
  plugins?: RouterPlugin<TServerContext>[];
}

const HTTP_METHODS: HTTPMethod[] = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'DELETE',
  'CONNECT',
  'OPTIONS',
  'TRACE',
  'PATCH',
];

export function createRouterBase({
  fetchAPI: givenFetchAPI,
  base: basePath = '/',
  plugins = [],
}: RouterOptions<any> = {}): RouterBaseObject<any, any> {
  const fetchAPI = {
    ...DefaultFetchAPI,
    ...givenFetchAPI,
  };
  const __onRouterInitHooks: OnRouterInitHook<any>[] = [];
  const onRouteHooks: OnRouteHook<any>[] = [];
  for (const plugin of plugins) {
    if (plugin.onRouterInit) {
      __onRouterInitHooks.push(plugin.onRouterInit);
    }
    if (plugin.onRoute) {
      onRouteHooks.push(plugin.onRoute);
    }
  }
  const routesByMethod = new Map<HTTPMethod, Map<URLPattern, RouteHandler<any>[]>>();
  function addHandlersToMethod({
    operationId,
    description,
    method,
    path,
    schemas,
    handlers,
  }: {
    operationId?: string;
    description?: string;
    method: HTTPMethod;
    path: string;
    schemas?: RouteSchemas;
    handlers: RouteHandler<any>[];
  }) {
    for (const onRouteHook of onRouteHooks) {
      onRouteHook({
        operationId,
        description,
        method,
        path,
        schemas,
        handlers,
      });
    }
    let methodPatternMaps = routesByMethod.get(method);
    if (!methodPatternMaps) {
      methodPatternMaps = new Map();
      routesByMethod.set(method, methodPatternMaps);
    }
    let fullPath = '';
    if (basePath === '/') {
      fullPath = path;
    } else if (path === '/') {
      fullPath = basePath;
    } else {
      fullPath = `${basePath}${path}`;
    }
    const pattern = new fetchAPI.URLPattern({ pathname: fullPath });
    methodPatternMaps.set(pattern, handlers);
  }
  return {
    async handle(request: Request, context: any) {
      let _parsedUrl: URL;
      function getParsedUrl() {
        if (!_parsedUrl) {
          _parsedUrl = new fetchAPI.URL(request.url, 'http://localhost');
        }
        return _parsedUrl;
      }
      const methodPatternMaps = routesByMethod.get(request.method as HTTPMethod);
      if (methodPatternMaps) {
        const queryProxy = new Proxy(
          {},
          {
            get(_, prop) {
              const parsedUrl = getParsedUrl();
              const allQueries = parsedUrl.searchParams.getAll(prop.toString());
              return allQueries.length === 1 ? allQueries[0] : allQueries;
            },
            has(_, prop) {
              const parsedUrl = getParsedUrl();
              return parsedUrl.searchParams.has(prop.toString());
            },
          },
        );
        for (const [pattern, handlers] of methodPatternMaps) {
          // Do not parse URL if not needed
          const match = request.url.endsWith(pattern.pathname)
            ? { pathname: { groups: {} } }
            : pattern.exec(getParsedUrl());
          console.log(pattern);
          if (match) {
            const routerRequest = new Proxy(request as any, {
              get(target, prop: keyof TypedRequest) {
                if (prop === 'parsedUrl') {
                  return getParsedUrl();
                }
                if (prop === 'params') {
                  return new Proxy(match.pathname.groups, {
                    get(_, prop) {
                      const value = match.pathname.groups[prop.toString()] as any;
                      if (value != null) {
                        return decodeURIComponent(value);
                      }
                      return value;
                    },
                  });
                }
                if (prop === 'query') {
                  return queryProxy;
                }
                const targetProp = target[prop] as any;
                if (typeof targetProp === 'function') {
                  return targetProp.bind(target);
                }
                return targetProp;
              },
              has(target, prop) {
                return (
                  prop in target || prop === 'parsedUrl' || prop === 'params' || prop === 'query'
                );
              },
            });
            for (const handler of handlers) {
              const result = await handler(routerRequest, context);
              if (result) {
                return result;
              }
            }
          }
        }
      }
      return new fetchAPI.Response(null, { status: 404 });
    },
    route(
      opts: AddRouteWithSchemasOpts<
        any,
        RouteSchemas,
        HTTPMethod,
        string,
        TypedRequest,
        TypedResponse
      >,
    ) {
      const { operationId, description, method, path, schemas, handler } = opts;
      const handlers = Array.isArray(handler) ? handler : [handler];
      if (!method) {
        for (const method of HTTP_METHODS) {
          addHandlersToMethod({
            operationId,
            description,
            method,
            path,
            schemas,
            handlers,
          });
        }
      } else {
        addHandlersToMethod({
          operationId,
          description,
          method,
          path,
          schemas,
          handlers,
        });
      }
      return this as any;
    },
    __sdk: {},
    __onRouterInitHooks,
  };
}

export function createRouter<
  TServerContext,
  TRouterSDK extends RouterSDK<string, TypedRequest, TypedResponse> = {
    [TKey: string]: never;
  },
>(options?: RouterOptions<TServerContext>): Router<TServerContext, TRouterSDK> {
  const routerBaseObject = createRouterBase(options);
  const router = createServerAdapter(routerBaseObject, options);
  for (const onRouterInitHook of routerBaseObject.__onRouterInitHooks) {
    onRouterInitHook(router);
  }
  return router;
}
