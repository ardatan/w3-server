import { Agent as HTTPAgent } from 'node:http';
import { Agent as HTTPSAgent } from 'node:https';
import { BodyPonyfillInit, PonyfillBody, PonyfillBodyOptions } from './Body.js';
import { isHeadersLike, PonyfillHeaders, PonyfillHeadersInit } from './Headers.js';
import { PonyfillURL } from './URL.js';

function isRequest(input: any): input is PonyfillRequest {
  return input[Symbol.toStringTag] === 'Request';
}

export type RequestPonyfillInit = PonyfillBodyOptions &
  Omit<RequestInit, 'body' | 'headers'> & {
    body?: BodyPonyfillInit | null | undefined;
    duplex?: 'half' | 'full' | undefined;
    headers?: PonyfillHeadersInit | undefined;
    headersSerializer?: HeadersSerializer | undefined;
    agent?: HTTPAgent | HTTPSAgent | false | undefined;
  };

type HeadersSerializer = (
  headers: Headers,
  onContentLength?: (contentLength: string) => void,
) => string[];

function isURL(obj: any): obj is URL {
  return obj?.href != null;
}

export class PonyfillRequest<TJSON = any> extends PonyfillBody<TJSON> implements Request {
  constructor(input: RequestInfo | URL, options?: RequestPonyfillInit) {
    let _url: string | undefined;
    let _parsedUrl: URL | undefined;
    let bodyInit: BodyPonyfillInit | null = null;
    let requestInit: RequestPonyfillInit | undefined;

    if (typeof input === 'string') {
      _url = input;
    } else if (isURL(input)) {
      _parsedUrl = input;
    } else if (isRequest(input)) {
      if (input._parsedUrl) {
        _parsedUrl = input._parsedUrl;
      } else if (input._url) {
        _url = input._url;
      } else {
        _url = input.url;
      }
      bodyInit = input.body;
      requestInit = input;
    }

    if (options != null) {
      bodyInit = options.body || null;
      requestInit = options;
    }

    super(bodyInit, options);

    this._url = _url;
    this._parsedUrl = _parsedUrl;

    this.cache = requestInit?.cache || 'default';
    this.credentials = requestInit?.credentials || 'same-origin';
    this.headers =
      requestInit?.headers && isHeadersLike(requestInit.headers)
        ? requestInit.headers
        : new PonyfillHeaders(requestInit?.headers);
    this.integrity = requestInit?.integrity || '';
    this.keepalive = requestInit?.keepalive != null ? requestInit?.keepalive : false;

    this.method = requestInit?.method?.toUpperCase() || 'GET';
    this.mode = requestInit?.mode || 'cors';
    this.redirect = requestInit?.redirect || 'follow';
    this.referrer = requestInit?.referrer || 'about:client';
    this.referrerPolicy = requestInit?.referrerPolicy || 'no-referrer';
    this._signal = requestInit?.signal;
    this.headersSerializer = requestInit?.headersSerializer;
    this.duplex = requestInit?.duplex || 'half';

    this.destination = 'document';
    this.priority = 'auto';

    if (this.method !== 'GET' && this.method !== 'HEAD') {
      this.handleContentLengthHeader(true);
    }

    if (requestInit?.agent != null) {
      const protocol = _parsedUrl?.protocol || _url || this.url;
      if (requestInit.agent === false) {
        this.agent = false;
      } else if (protocol.startsWith('http:') && requestInit.agent instanceof HTTPAgent) {
        this.agent = requestInit.agent;
      } else if (protocol.startsWith('https:') && requestInit.agent instanceof HTTPSAgent) {
        this.agent = requestInit.agent;
      }
    }
  }

  headersSerializer?: HeadersSerializer | undefined;
  cache: RequestCache;
  credentials: RequestCredentials;
  destination: RequestDestination;
  headers: Headers;
  integrity: string;
  keepalive: boolean;
  method: string;
  mode: RequestMode;
  priority: 'auto' | 'high' | 'low';
  redirect: RequestRedirect;
  referrer: string;
  referrerPolicy: ReferrerPolicy;
  _url: string | undefined;
  get url(): string {
    if (this._url == null) {
      if (this._parsedUrl) {
        this._url = this._parsedUrl.toString();
      } else {
        throw new TypeError('Invalid URL');
      }
    }
    return this._url;
  }

  _parsedUrl: URL | undefined;
  get parsedUrl(): URL {
    if (this._parsedUrl == null) {
      if (this._url != null) {
        this._parsedUrl = new PonyfillURL(this._url, 'http://localhost');
      } else {
        throw new TypeError('Invalid URL');
      }
    }
    return this._parsedUrl;
  }

  duplex: 'half' | 'full';

  agent: HTTPAgent | HTTPSAgent | false | undefined;

  dispatcher: import('undici').Dispatcher | undefined;

  private _signal: AbortSignal | undefined | null;

  get signal() {
    // Create a new signal only if needed
    // Because the creation of signal is expensive
    if (!this._signal) {
      this._signal = new AbortController().signal;
    }
    return this._signal!;
  }

  clone(): PonyfillRequest<TJSON> {
    return this;
  }

  [Symbol.toStringTag] = 'Request';
}
