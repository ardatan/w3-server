import { FetchAPI, ServerAdapterRequestHandler } from '../types.js';

export interface ServerAdapterPlugin<TServerContext = {}> {
  onRequestAdapt?: OnRequestAdapt<TServerContext>;
  onRequest?: OnRequestHook<TServerContext>;
  onResponse?: OnResponseHook<TServerContext>;
}

export type OnRequestAdapt<TServerContext> = (
  payload: OnRequestAdaptEventPayload<TServerContext>,
) => Promise<void> | void;

export interface RequestAdapterResult<TServerContext> {
  serverContext: TServerContext;
  request: Request;
}

export type RequestAdapter<TServerContext> = () => RequestAdapterResult<TServerContext>;

export interface OnRequestAdaptEventPayload<TServerContext> {
  args: unknown[];
  setRequest(request: Request): void;
  setServerContext(serverContext: TServerContext): void;
  fetchAPI: FetchAPI;
}

export type OnRequestHook<TServerContext> = (
  payload: OnRequestEventPayload<TServerContext>,
) => Promise<void> | void;

export interface OnRequestEventPayload<TServerContext> {
  request: Request;
  serverContext: TServerContext | undefined;
  fetchAPI: FetchAPI;
  requestHandler: ServerAdapterRequestHandler<TServerContext>;
  setRequestHandler(newRequestHandler: ServerAdapterRequestHandler<TServerContext>): void;
  endResponse(response: Response): void;
  url: URL;
}

export type OnResponseHook<TServerContext> = (
  payload: OnResponseEventPayload<TServerContext>,
) => Promise<void> | void;

export interface OnResponseEventPayload<TServerContext> {
  request: Request;
  serverContext: TServerContext | undefined;
  response: Response;
}
