/* eslint-disable */
declare module '@kamilkisiela/fast-url-parser' {
  class Url {
    static queryString: {
      parse(value: string): any;
      stringify(value: any): string;
    };

    parse(urlString: string): void;
    parse(
      urlString: string,
      parseQueryString: false | undefined,
      slashesDenoteHost?: boolean,
    ): void;
    parse(urlString: string, parseQueryString: true, slashesDenoteHost?: boolean): void;
    parse(urlString: string, parseQueryString: boolean, slashesDenoteHost?: boolean): void;
    format(): string;
    auth: string;
    hash: string;
    host: string;
    hostname: string;
    href: string;
    path: string;
    pathname: string;
    protocol: string;
    search: string;
    slashes: boolean;
    port: string;
    query: string | any;
  }
  export = Url;
}

// TODO
declare var TEST_LIBCURL: any;
declare module 'scheduler/tracing' {
  export type Interaction = any;
}
