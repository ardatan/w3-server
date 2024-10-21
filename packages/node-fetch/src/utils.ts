import { Readable } from 'stream';

function isHeadersInstance(obj: any): obj is Headers {
  return obj?.forEach != null;
}

export function patchReadableFromWeb() {
  try {
    const originalReadableFromWeb = Readable.fromWeb;
    // eslint-disable-next-line no-inner-declarations
    function ReadableFromWebPatchedByWhatWgNode(stream: any): Readable {
      if (stream.readable instanceof Readable) {
        return stream.readable;
      }
      return originalReadableFromWeb(stream as any);
    }
    if (originalReadableFromWeb.name !== 'ReadableFromWebPatchedByWhatWgNode') {
      if (
        typeof jest === 'object' &&
        typeof beforeEach === 'function' &&
        typeof afterEach === 'function'
      ) {
        // To relax jest, we should remove the patch after each test
        beforeEach(() => {
          if (Readable.fromWeb.name !== 'ReadableFromWebPatchedByWhatWgNode') {
            Readable.fromWeb = ReadableFromWebPatchedByWhatWgNode;
          }
        });
        afterEach(() => {
          if (Readable.fromWeb.name === 'ReadableFromWebPatchedByWhatWgNode') {
            Readable.fromWeb = originalReadableFromWeb;
          }
        });
      } else {
        Readable.fromWeb = ReadableFromWebPatchedByWhatWgNode;
      }
    }
  } catch (e) {
    console.warn(
      'Could not patch Readable.fromWeb, so this might break Readable.fromWeb usage with the whatwg-node and the integrations like Fastify',
      e,
    );
  }
}

export function getHeadersObj(headers: Headers): Record<string, string> {
  if (headers == null || !isHeadersInstance(headers)) {
    return headers as any;
  }
  const obj: Record<string, string> = {};
  headers.forEach((value, key) => {
    obj[key] = value;
  });
  return obj;
}

export function defaultHeadersSerializer(
  headers: Headers,
  onContentLength?: (value: string) => void,
): string[] {
  const headerArray: string[] = [];
  headers.forEach((value, key) => {
    if (onContentLength && key === 'content-length') {
      onContentLength(value);
    }
    headerArray.push(`${key}: ${value}`);
  });
  return headerArray;
}

function isPromise<T>(val: T | Promise<T>): val is Promise<T> {
  return (val as any)?.then != null;
}

export function fakePromise<T>(value: T): Promise<T> {
  if (isPromise(value)) {
    return value;
  }
  // Write a fake promise to avoid the promise constructor
  // being called with `new Promise` in the browser.
  return {
    then(resolve: (value: T) => any) {
      if (resolve) {
        const callbackResult = resolve(value);
        if (isPromise(callbackResult)) {
          return callbackResult;
        }
        return fakePromise(callbackResult);
      }
      return this;
    },
    catch() {
      return this;
    },
    finally(cb) {
      if (cb) {
        const callbackResult = cb();
        if (isPromise(callbackResult)) {
          return callbackResult.then(() => value);
        }
        return fakePromise(value);
      }
      return this;
    },
    [Symbol.toStringTag]: 'Promise',
  };
}

export function isArrayBufferView(obj: any): obj is ArrayBufferView {
  return obj != null && obj.buffer != null && obj.byteLength != null && obj.byteOffset != null;
}

export function isNodeReadable(obj: any): obj is Readable {
  return obj != null && obj.pipe != null;
}

export interface DeferredPromise<T = void> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export function createDeferredPromise<T = void>(): DeferredPromise<T> {
  let resolveFn: (value: T) => void;
  let rejectFn: (reason: any) => void;
  const promise = new Promise<T>(function deferredPromiseExecutor(resolve, reject) {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return {
    promise,
    get resolve() {
      return resolveFn;
    },
    get reject() {
      return rejectFn;
    },
  };
}
