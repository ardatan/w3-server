import { Readable } from 'stream';
import { fakePromise } from './utils.js';
import { PonyfillWritableStream } from './WritableStream.js';

function createController<T>(
  desiredSize: number,
  readable: Readable,
): ReadableStreamDefaultController<T> & { _flush(): void; _closed: boolean } {
  let chunks: Buffer[] = [];
  let _closed = false;
  let flushed = false;
  return {
    desiredSize,
    enqueue(chunk: any) {
      const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (!flushed) {
        chunks.push(buf);
      } else {
        readable.push(buf);
      }
    },
    close() {
      if (chunks.length > 0) {
        this._flush();
      }
      readable.push(null);
      _closed = true;
    },
    error(error: Error) {
      if (chunks.length > 0) {
        this._flush();
      }
      readable.destroy(error);
    },
    get _closed() {
      return _closed;
    },
    _flush() {
      flushed = true;
      if (chunks.length > 0) {
        const concatenated = chunks.length > 1 ? Buffer.concat(chunks) : chunks[0];
        readable.push(concatenated);
        chunks = [];
      }
    },
  };
}

function isNodeReadable(obj: any): obj is Readable {
  return obj?.read != null;
}

function isReadableStream(obj: any): obj is ReadableStream {
  return obj?.getReader != null;
}

export class PonyfillReadableStream<T> implements ReadableStream<T> {
  readable: Readable;
  constructor(
    underlyingSource?:
      | UnderlyingSource<T>
      | Readable
      | ReadableStream<T>
      | PonyfillReadableStream<T>,
  ) {
    if (underlyingSource instanceof PonyfillReadableStream && underlyingSource.readable != null) {
      this.readable = underlyingSource.readable;
    } else if (isNodeReadable(underlyingSource)) {
      this.readable = underlyingSource as Readable;
    } else if (isReadableStream(underlyingSource)) {
      this.readable = Readable.fromWeb(underlyingSource as Parameters<typeof Readable.fromWeb>[0]);
    } else {
      let started = false;
      let ongoing = false;
      this.readable = new Readable({
        read(desiredSize) {
          if (ongoing) {
            return;
          }
          ongoing = true;
          return Promise.resolve().then(async () => {
            if (!started) {
              const controller = createController(desiredSize, this);
              started = true;
              await underlyingSource?.start?.(controller);
              controller._flush();
              if (controller._closed) {
                return;
              }
            }
            const controller = createController(desiredSize, this);
            await underlyingSource?.pull?.(controller);
            controller._flush();
            ongoing = false;
          });
        },
        destroy(err, callback) {
          if (underlyingSource?.cancel) {
            try {
              const res$ = underlyingSource.cancel(err);
              if (res$?.then) {
                return res$.then(
                  () => {
                    callback(null);
                  },
                  err => {
                    callback(err);
                  },
                );
              }
            } catch (err: any) {
              callback(err);
              return;
            }
          }
          callback(null);
        },
      });
    }
  }

  cancel(reason?: any): Promise<void> {
    this.readable.destroy(reason);
    return new Promise(resolve => this.readable.once('end', resolve));
  }

  locked = false;

  getReader(options: { mode: 'byob' }): ReadableStreamBYOBReader;
  getReader(): ReadableStreamDefaultReader<T>;
  getReader(_options?: ReadableStreamGetReaderOptions): ReadableStreamReader<T> {
    const iterator = this.readable[Symbol.asyncIterator]();
    this.locked = true;
    return {
      read() {
        return iterator.next() as Promise<ReadableStreamReadResult<T>>;
      },
      releaseLock: () => {
        if (iterator.return) {
          const retResult$ = iterator.return();
          if (retResult$.then) {
            retResult$.then(() => {
              this.locked = false;
            });
            return;
          }
        }
        this.locked = false;
      },
      cancel: reason => {
        if (iterator.return) {
          const retResult$ = iterator.return(reason);
          if (retResult$.then) {
            return retResult$.then(() => {
              this.locked = false;
            });
          }
        }
        this.locked = false;
        return fakePromise(undefined);
      },
      closed: new Promise((resolve, reject) => {
        this.readable.once('end', resolve);
        this.readable.once('error', reject);
      }),
    };
  }

  [Symbol.asyncIterator]() {
    return this.readable[Symbol.asyncIterator]();
  }

  tee(): [ReadableStream<T>, ReadableStream<T>] {
    throw new Error('Not implemented');
  }

  pipeTo(destination: WritableStream<T>): Promise<void> {
    if (isPonyfillWritableStream(destination)) {
      return new Promise((resolve, reject) => {
        this.readable.pipe(destination.writable);
        destination.writable.once('finish', resolve);
        destination.writable.once('error', reject);
      });
    } else {
      const writer = destination.getWriter();
      return Promise.resolve().then(async () => {
        try {
          for await (const chunk of this) {
            await writer.write(chunk);
          }
          await writer.close();
        } catch (err) {
          await writer.abort(err);
        }
      });
    }
  }

  pipeThrough<T2>({
    writable,
    readable,
  }: {
    writable: WritableStream<T>;
    readable: ReadableStream<T2>;
  }): ReadableStream<T2> {
    this.pipeTo(writable);
    return readable;
  }

  static [Symbol.hasInstance](instance: unknown): instance is PonyfillReadableStream<unknown> {
    return isReadableStream(instance);
  }

  [Symbol.toStringTag] = 'ReadableStream';
}

function isPonyfillWritableStream(obj: any): obj is PonyfillWritableStream {
  return obj?.writable != null;
}
