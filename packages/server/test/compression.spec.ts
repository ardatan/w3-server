import { Buffer } from 'node:buffer';
import { describe, expect, it } from '@jest/globals';
import { useContentEncoding } from '../src/plugins/useContentEncoding';
import { getSupportedEncodings, handleResponseDecompression } from '../src/utils';
import { runTestsForEachFetchImpl } from './test-fetch';
import { runTestsForEachServerImpl } from './test-server';

describe('Compression', () => {
  const exampleData = JSON.stringify(new Array(1000).fill('Hello, World!').join(''));
  describe('Adapter', () => {
    runTestsForEachFetchImpl(
      (_, { fetchAPI, createServerAdapter }) => {
        const encodings = [...getSupportedEncodings(fetchAPI), 'none'];
        for (const encoding of encodings) {
          describe(encoding, () => {
            it('from the server to the client with "accept-encoding"', async () => {
              const adapter = createServerAdapter(() => new fetchAPI.Response(exampleData), {
                plugins: [useContentEncoding()],
              });
              let res = await adapter.fetch('http://localhost', {
                headers: {
                  'accept-encoding': encoding,
                },
              });
              res = handleResponseDecompression(res, fetchAPI);
              expect(res.status).toEqual(200);
              const resText = await res.text();
              expect(resText).toEqual(exampleData);
            });
            it('from the client to the server', async () => {
              const adapter = createServerAdapter(
                async req => {
                  const body = await req.text();
                  return fetchAPI.Response.json({
                    body,
                    contentLength: req.headers.get('content-length'),
                  });
                },
                {
                  plugins: [useContentEncoding()],
                },
              );
              if (encoding === 'none') {
                const res = await adapter.fetch('http://localhost', {
                  method: 'POST',
                  body: exampleData,
                  headers: {
                    'content-length': String(Buffer.byteLength(exampleData)),
                  },
                });
                const resJson = await res.json();
                expect(resJson).toEqual({
                  body: exampleData,
                  contentLength: String(Buffer.byteLength(exampleData)),
                });
                return;
              }
              const stream = new fetchAPI.CompressionStream(encoding as CompressionFormat);
              const writer = stream.writable.getWriter();
              writer.write(Buffer.from(exampleData));
              writer.close();
              const chunks: number[] = [];
              const reader = stream.readable.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  reader.releaseLock();
                  break;
                } else if (value) {
                  chunks.push(...value);
                }
              }
              const uint8Array = new Uint8Array(chunks);
              let res = await adapter.fetch('http://localhost', {
                method: 'POST',
                headers: {
                  'content-encoding': encoding,
                },
                body: uint8Array,
              });
              res = handleResponseDecompression(res, fetchAPI);
              const { body, contentLength } = await res.json();
              expect(body).toEqual(exampleData);
              expect(Number(contentLength)).toBeLessThan(Buffer.byteLength(body));
            });
            it('both ways', async () => {
              const adapter = createServerAdapter(
                async req => {
                  const body = await req.text();
                  return fetchAPI.Response.json({
                    body,
                    contentLength: req.headers.get('content-length'),
                  });
                },
                {
                  plugins: [useContentEncoding()],
                },
              );
              if (encoding === 'none') {
                const res = await adapter.fetch('http://localhost', {
                  method: 'POST',
                  body: exampleData,
                  headers: {
                    'content-length': String(Buffer.byteLength(exampleData)),
                  },
                });
                const resJson = await res.json();
                expect(resJson).toEqual({
                  body: exampleData,
                  contentLength: String(Buffer.byteLength(exampleData)),
                });
                return;
              }
              const stream = new fetchAPI.CompressionStream(encoding as CompressionFormat);
              const writer = stream.writable.getWriter();
              writer.write(Buffer.from(exampleData));
              writer.close();
              const chunks: number[] = [];
              const reader = stream.readable.getReader();
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  reader.releaseLock();
                  break;
                } else if (value) {
                  chunks.push(...value);
                }
              }
              const uint8Array = new Uint8Array(chunks);
              let res = await adapter.fetch('http://localhost', {
                method: 'POST',
                headers: {
                  'accept-encoding': encoding,
                  'content-encoding': encoding,
                },
                body: uint8Array,
              });
              res = handleResponseDecompression(res, fetchAPI);
              const { body, contentLength } = await res.json();
              expect(body).toEqual(exampleData);
              expect(Number(contentLength)).toBeLessThan(Buffer.byteLength(body));
            });
          });
        }
      },
      { noLibCurl: true },
    );
  });
  runTestsForEachFetchImpl((implName, { fetchAPI, createServerAdapter }) => {
    runTestsForEachServerImpl(server => {
      const skipIf = (condition: boolean) => (condition ? it.skip : it);
      // Deno's fetch does not decompress automatically
      skipIf(!!globalThis.Deno)(
        `from the server to the client without 'accept-encoding'`,
        async () => {
          let req: Request | undefined;
          const adapter = createServerAdapter(
            passedReq => {
              req = passedReq;
              return new fetchAPI.Response(exampleData);
            },
            {
              plugins: [useContentEncoding()],
            },
          );
          server.addOnceHandler(adapter);
          const res = await fetchAPI.fetch(server.url);
          const encodingSupported = encodings.some(e => e !== 'none');
          if (encodingSupported) {
            try {
              expect(res.headers.get('content-encoding')).toBeTruthy();
            } catch (e) {
              console.log({
                req: req?.headers,
                res: res.headers,
                server: server.name,
              });
              throw e;
            }
          }
          expect(res.status).toEqual(200);
          const acceptedEncodings = req?.headers.get('accept-encoding');
          expect(acceptedEncodings).toBeTruthy();
          expect(acceptedEncodings).toContain('gzip');
          expect(acceptedEncodings).toContain('deflate');
          const returnedData = await res.text();
          expect(returnedData).toEqual(exampleData);
          if (encodingSupported) {
            expect(Number(res.headers.get('content-length'))).toBeLessThan(
              Buffer.byteLength(exampleData),
            );
          }
        },
      );
      const encodings = [...getSupportedEncodings(fetchAPI), 'none'];
      for (const encoding of encodings) {
        // Skip deflate-raw with libcurl because it doesn't support it
        if (encoding === 'deflate-raw' && implName === 'libcurl') {
          continue;
        }
        describe(encoding, () => {
          // Deno's fetch does not decompress automatically
          skipIf(!!globalThis.Deno)(`from the server to the client`, async () => {
            const adapter = createServerAdapter(
              () =>
                new fetchAPI.Response(exampleData, {
                  headers: {
                    'content-length': String(Buffer.byteLength(exampleData)),
                  },
                }),
              {
                plugins: [useContentEncoding()],
              },
            );
            server.addOnceHandler(adapter);
            const res = await fetchAPI.fetch(server.url, {
              headers: {
                'accept-encoding': encoding,
              },
            });
            expect(res.headers.get('content-encoding')).toEqual(
              encoding === 'none' ? null : encoding,
            );
            expect(res.status).toEqual(200);
            const returnedData = await res.text();
            expect(returnedData).toEqual(exampleData);
            const contentLength = res.headers.get('content-length');
            const numberContentLength = Number(contentLength);
            const origSize = Buffer.byteLength(exampleData);
            if (encoding === 'none' && contentLength) {
              expect(numberContentLength).toEqual(origSize);
            } else {
              expect(numberContentLength).toBeLessThan(origSize);
            }
          });
          it(`from the client to the server`, async () => {
            const adapter = createServerAdapter(
              async req => {
                const body = await req.text();
                return fetchAPI.Response.json({
                  body,
                  contentLength: req.headers.get('content-length'),
                });
              },
              {
                plugins: [useContentEncoding()],
              },
            );
            server.addOnceHandler(adapter);
            if (encoding === 'none') {
              const res = await fetchAPI.fetch(server.url, {
                method: 'POST',
                body: exampleData,
                headers: {
                  'content-length': String(Buffer.byteLength(exampleData)),
                },
              });
              const resText = await res.text();
              let resJson: { body: string; contentLength: string };
              try {
                resJson = JSON.parse(resText);
              } catch {
                throw new Error(`Could not parse JSON: ${resText}`);
              }
              expect(resJson.body).toEqual(exampleData);
              expect(Number(resJson.contentLength)).toEqual(Buffer.byteLength(exampleData));
              return;
            }
            const stream = new fetchAPI.CompressionStream(encoding as CompressionFormat);
            const writer = stream.writable.getWriter();
            writer.write(Buffer.from(exampleData));
            writer.close();
            const chunks: number[] = [];
            const reader = stream.readable.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                reader.releaseLock();
                break;
              } else if (value) {
                chunks.push(...value);
              }
            }
            const uint8Array = new Uint8Array(chunks);
            const res = await fetchAPI.fetch(server.url, {
              method: 'POST',
              headers: {
                'content-encoding': encoding,
              },
              body: uint8Array,
            });
            const resText = await res.text();
            let resJson: { body: string; contentLength: string };
            try {
              resJson = JSON.parse(resText);
            } catch {
              throw new Error(`Could not parse JSON: ${resText}`);
            }
            expect(resJson.body).toEqual(exampleData);
            expect(Number(resJson.contentLength)).toBeLessThan(Buffer.byteLength(resJson.body));
          });
        });
      }
    });
  });
});
