export function isAsyncIterable(body: any): body is AsyncIterable<any> {
  return (
    body != null && typeof body === 'object' && typeof body[Symbol.asyncIterator] === 'function'
  );
}
export function isReadableStream(stream: any): stream is ReadableStream {
  return stream != null && stream.getReader != null;
}

export function isRequestInit(val: unknown): val is RequestInit {
  return (
    val != null &&
    typeof val === 'object' &&
    ('body' in val ||
      'cache' in val ||
      'credentials' in val ||
      'headers' in val ||
      'integrity' in val ||
      'keepalive' in val ||
      'method' in val ||
      'mode' in val ||
      'redirect' in val ||
      'referrer' in val ||
      'referrerPolicy' in val ||
      'signal' in val ||
      'window' in val)
  );
}

// from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign#copying_accessors
export function completeAssign(...args: any[]) {
  const [target, ...sources] = args.filter(arg => arg != null && typeof arg === 'object');
  sources.forEach(source => {
    // modified Object.keys to Object.getOwnPropertyNames
    // because Object.keys only returns enumerable properties
    const descriptors: any = Object.getOwnPropertyNames(source).reduce((descriptors: any, key) => {
      descriptors[key] = Object.getOwnPropertyDescriptor(source, key);
      return descriptors;
    }, {});

    // By default, Object.assign copies enumerable Symbols, too
    Object.getOwnPropertySymbols(source).forEach(sym => {
      const descriptor = Object.getOwnPropertyDescriptor(source, sym);
      if (descriptor!.enumerable) {
        descriptors[sym] = descriptor;
      }
    });

    Object.defineProperties(target, descriptors);
  });
  return target;
}

export function addWaitUntil(serverContext: any, waitUntilPromises: Promise<unknown>[]): void {
  serverContext['waitUntil'] = function (promise: Promise<void> | void) {
    if (promise != null) {
      waitUntilPromises.push(promise);
    }
  };
}
