/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { PonyfillReadableStream } from './ReadableStream.js';
import { fakePromise, isArrayBufferView } from './utils.js';

interface BlobOptions {
  /**
   * @default 'utf8'
   */
  encoding?: BufferEncoding | undefined;
  /**
   * The Blob content-type. The intent is for `type` to convey
   * the MIME media type of the data, however no validation of the type format
   * is performed.
   */
  type?: string | undefined;
  /**
   * The size of the Blob object in bytes.
   */
  size?: number | null;
}

function getBlobPartAsBuffer(blobPart: Exclude<BlobPart, Blob>) {
  if (typeof blobPart === 'string') {
    return Buffer.from(blobPart);
  } else if (Buffer.isBuffer(blobPart)) {
    return blobPart;
  } else if (isArrayBufferView(blobPart)) {
    return Buffer.from(blobPart.buffer, blobPart.byteOffset, blobPart.byteLength);
  } else {
    return Buffer.from(blobPart);
  }
}

export function hasBufferMethod(obj: any): obj is { buffer(): Promise<Buffer> } {
  return obj != null && obj.buffer != null;
}

export function hasArrayBufferMethod(obj: any): obj is { arrayBuffer(): Promise<ArrayBuffer> } {
  return obj != null && obj.arrayBuffer != null;
}

export function hasBytesMethod(obj: any): obj is { bytes(): Promise<Uint8Array> } {
  return obj != null && obj.bytes != null;
}

export function hasTextMethod(obj: any): obj is { text(): Promise<string> } {
  return obj != null && obj.text != null;
}

export function hasSizeProperty(obj: any): obj is { size: number } {
  return obj != null && typeof obj.size === 'number';
}

export function hasStreamMethod(obj: any): obj is { stream(): any } {
  return obj != null && obj.stream != null;
}

export function hasBlobSignature(obj: any): obj is Blob {
  return obj != null && obj[Symbol.toStringTag] === 'Blob';
}

// Will be removed after v14 reaches EOL
// Needed because v14 doesn't have .stream() implemented
export class PonyfillBlob implements Blob {
  type: string;
  private encoding: BufferEncoding;
  private _size: number | null = null;
  constructor(
    private blobParts: BlobPart[],
    options?: BlobOptions,
  ) {
    this.type = options?.type || 'application/octet-stream';
    this.encoding = options?.encoding || 'utf8';
    this._size = options?.size || null;
    if (blobParts.length === 1 && hasBlobSignature(blobParts[0])) {
      return blobParts[0] as PonyfillBlob;
    }
  }

  _buffer: Buffer | null = null;

  buffer() {
    if (this._buffer) {
      return fakePromise(this._buffer);
    }
    if (this.blobParts.length === 1) {
      const blobPart = this.blobParts[0];
      if (hasBufferMethod(blobPart)) {
        return blobPart.buffer().then(buf => {
          this._buffer = buf;
          return this._buffer;
        });
      }
      if (hasBytesMethod(blobPart)) {
        return blobPart.bytes().then(bytes => {
          this._buffer = Buffer.from(bytes);
          return this._buffer;
        });
      }
      if (hasArrayBufferMethod(blobPart)) {
        return blobPart.arrayBuffer().then(arrayBuf => {
          this._buffer = Buffer.from(arrayBuf, undefined, blobPart.size);
          return this._buffer;
        });
      }
      this._buffer = getBlobPartAsBuffer(blobPart);
      return fakePromise(this._buffer);
    }

    const jobs: Promise<void>[] = [];
    const bufferChunks: Buffer[] = this.blobParts.map((blobPart, i) => {
      if (hasBufferMethod(blobPart)) {
        jobs.push(
          blobPart.buffer().then(buf => {
            bufferChunks[i] = buf;
          }),
        );
        return undefined as any;
      } else if (hasArrayBufferMethod(blobPart)) {
        jobs.push(
          blobPart.arrayBuffer().then(arrayBuf => {
            bufferChunks[i] = Buffer.from(arrayBuf, undefined, blobPart.size);
          }),
        );
        return undefined as any;
      } else if (hasBytesMethod(blobPart)) {
        jobs.push(
          blobPart.bytes().then(bytes => {
            bufferChunks[i] = Buffer.from(bytes);
          }),
        );
        return undefined as any;
      } else {
        return getBlobPartAsBuffer(blobPart);
      }
    });
    if (jobs.length > 0) {
      return Promise.all(jobs).then(() => Buffer.concat(bufferChunks, this._size || undefined));
    }
    return fakePromise(Buffer.concat(bufferChunks, this._size || undefined));
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return this.buffer();
  }

  _text: string | null = null;

  text() {
    if (this._text) {
      return fakePromise(this._text);
    }
    if (this.blobParts.length === 1) {
      const blobPart = this.blobParts[0];
      if (typeof blobPart === 'string') {
        this._text = blobPart;
        return fakePromise(this._text);
      }
      if (hasTextMethod(blobPart)) {
        return blobPart.text().then(text => {
          this._text = text;
          return this._text;
        });
      }
      const buf = getBlobPartAsBuffer(blobPart);
      this._text = buf.toString(this.encoding);
      return fakePromise(this._text);
    }
    return this.buffer().then(buf => {
      this._text = buf.toString(this.encoding);
      return this._text;
    });
  }

  get size() {
    if (this._size == null) {
      this._size = 0;
      for (const blobPart of this.blobParts) {
        if (typeof blobPart === 'string') {
          this._size += Buffer.byteLength(blobPart);
        } else if (hasSizeProperty(blobPart)) {
          this._size += blobPart.size;
        } else if (isArrayBufferView(blobPart)) {
          this._size += blobPart.byteLength;
        }
      }
    }
    return this._size;
  }

  stream(): any {
    if (this.blobParts.length === 1) {
      const blobPart = this.blobParts[0];
      if (hasStreamMethod(blobPart)) {
        return blobPart.stream();
      }
      const buf = getBlobPartAsBuffer(blobPart);
      return new PonyfillReadableStream({
        start: controller => {
          controller.enqueue(buf);
          controller.close();
        },
      });
    }
    if (this._buffer != null) {
      return new PonyfillReadableStream({
        start: controller => {
          controller.enqueue(this._buffer!);
          controller.close();
        },
      });
    }
    let blobPartIterator: Iterator<BlobPart> | undefined;
    return new PonyfillReadableStream({
      start: controller => {
        if (this.blobParts.length === 0) {
          controller.close();
          return;
        }
        blobPartIterator = this.blobParts[Symbol.iterator]();
      },
      pull: controller => {
        const { value: blobPart, done } = blobPartIterator!.next();
        if (done) {
          controller.close();
          return;
        }
        if (blobPart) {
          if (hasBufferMethod(blobPart)) {
            return blobPart.buffer().then(buf => {
              controller.enqueue(buf);
            });
          }
          if (hasBytesMethod(blobPart)) {
            return blobPart.bytes().then(bytes => {
              const buf = Buffer.from(bytes);
              controller.enqueue(buf);
            });
          }
          if (hasArrayBufferMethod(blobPart)) {
            return blobPart.arrayBuffer().then(arrayBuffer => {
              const buf = Buffer.from(arrayBuffer, undefined, blobPart.size);
              controller.enqueue(buf);
            });
          }
          const buf = getBlobPartAsBuffer(blobPart);
          controller.enqueue(buf);
        }
      },
    });
  }

  slice(): any {
    throw new Error('Not implemented');
  }
}

export interface PonyfillBlob {
  prototype: Blob;
  new (blobParts?: BlobPart[], options?: BlobPropertyBag): Blob;
}
