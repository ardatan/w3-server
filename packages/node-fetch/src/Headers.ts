export type PonyfillHeadersInit =
  | [string, string][]
  | Record<string, string | string[] | undefined>
  | Headers;

function isHeadersLike(headers: any): headers is Headers {
  return headers && typeof headers.get === 'function';
}

export class PonyfillHeaders implements Headers {
  private map = new Map<string, string>();
  private mapIsBuilt = false;
  private objectKeysOfeadersInit: string[] = [];

  constructor(private headersInit?: PonyfillHeadersInit) {}

  // perf: we don't need to build `this.map` for Requests, as we can access the headers directly
  private _get(key: string) {
    // If the map is built, reuse it
    if (this.mapIsBuilt) {
      return this.map.get(key.toLowerCase()) || null;
    }

    // If the map is not built, try to get the value from the this.headersInit
    if (this.headersInit == null) {
      return null;
    }

    const normalized = key.toLowerCase();
    if (Array.isArray(this.headersInit)) {
      return this.headersInit.find(header => header[0] === normalized);
    } else if (isHeadersLike(this.headersInit)) {
      return this.headersInit.get(normalized);
    } else {
      const initValue = this.headersInit[key] || this.headersInit[normalized];

      if (initValue != null) {
        return initValue;
      }

      if (!this.objectKeysOfeadersInit.length) {
        this.objectKeysOfeadersInit = Object.keys(this.headersInit).map(k => k.toLowerCase());
      }
      const index = this.objectKeysOfeadersInit.indexOf(normalized);
      if (index === -1) {
        return null;
      }
      return this.headersInit[index];
    }
  }

  // perf: Build the map of headers lazily, only when we need to access all headers or write to it.
  // I could do a getter here, but I'm too lazy to type `getter`.
  private getMap() {
    if (this.mapIsBuilt) {
      return this.map;
    }

    if (this.headersInit != null) {
      if (Array.isArray(this.headersInit)) {
        this.map = new Map(this.headersInit);
      } else if (isHeadersLike(this.headersInit)) {
        this.headersInit.forEach((value, key) => {
          this.map.set(key, value);
        });
      } else {
        for (const initKey in this.headersInit) {
          const initValue = this.headersInit[initKey];
          if (initValue != null) {
            const normalizedValue = Array.isArray(initValue) ? initValue.join(', ') : initValue;
            const normalizedKey = initKey.toLowerCase();
            this.map.set(normalizedKey, normalizedValue);
          }
        }
      }
    }

    this.mapIsBuilt = true;
    return this.map;
  }

  append(name: string, value: string): void {
    const key = name.toLowerCase();
    const existingValue = this.getMap().get(key);
    const finalValue = existingValue ? `${existingValue}, ${value}` : value;
    this.getMap().set(key, finalValue);
  }

  get(name: string): string | null {
    const key = name.toLowerCase();
    const value = this._get(key);

    if (value == null) {
      return null;
    }

    if (Array.isArray(value)) {
      return value.join(', ');
    }

    return value;
  }

  has(name: string): boolean {
    const key = name.toLowerCase();
    return !!this._get(key); // we might need to check if header exists and not just check if it's not nullable
  }

  set(name: string, value: string): void {
    const key = name.toLowerCase();
    this.getMap().set(key, value);
  }

  delete(name: string): void {
    const key = name.toLowerCase();
    this.getMap().delete(key);
  }

  forEach(callback: (value: string, key: string, parent: Headers) => void): void {
    this.getMap().forEach((value, key) => {
      callback(value, key, this);
    });
  }

  entries(): IterableIterator<[string, string]> {
    return this.getMap().entries();
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.getMap().entries();
  }
}
