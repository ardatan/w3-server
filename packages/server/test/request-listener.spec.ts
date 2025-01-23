import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers/promises';
import { describe, expect, it } from '@jest/globals';
import { getHeadersObj } from '../../node-fetch/src/utils.js';
import { runTestsForEachFetchImpl } from './test-fetch.js';
import { runTestsForEachServerImpl, TestServer } from './test-server.js';

const methodsWithoutBody = ['GET', 'DELETE'];

const methodsWithBody = ['POST', 'PUT', 'PATCH'];

describe('Request Listener', () => {
  runTestsForEachFetchImpl((impl, { createServerAdapter, fetchAPI }) => {
    runTestsForEachServerImpl(testServer => {
      [...methodsWithBody, ...methodsWithoutBody].forEach(method => {
        // PATCH is buggy in Native
        if (method === 'PATCH' && impl === 'native') return;
        it(`should handle regular requests with ${method}`, () => {
          const headers: Record<string, string> = {
            accept: 'application/json; charset=utf-8',
            'x-random-header': Date.now().toString(),
          };
          const requestInit: RequestInit = {
            method,
            headers,
          };
          if (methodsWithBody.includes(method)) {
            headers['content-type'] = 'application/json; charset=utf-8';
            requestInit.body = getRegularRequestBody();
          }
          const expectedResponse = new fetchAPI.Response(getRegularResponseBody(), {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'x-random-header': Date.now().toString(),
            },
          });
          return runTestForRequestAndResponse({
            requestInit,
            getRequestBody: getRegularRequestBody,
            expectedResponse,
            getResponseBody: getRegularResponseBody,
            testServer,
          });
        });

        it(`should handle incremental responses with ${method}`, () => {
          const headers: Record<string, string> = {
            accept: 'text/event-stream; charset=utf-8',
            'x-random-header': Date.now().toString(),
          };
          const requestInit: RequestInit = {
            method,
            headers,
          };
          if (methodsWithBody.includes(method)) {
            headers['content-type'] = 'application/json; charset=utf-8';
            requestInit.body = getRegularRequestBody();
          }
          const expectedResponse = new fetchAPI.Response(getIncrementalResponseBody(), {
            status: 200,
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'x-random-header': Date.now().toString(),
            },
          });
          return runTestForRequestAndResponse({
            requestInit,
            getRequestBody: getRegularRequestBody,
            expectedResponse,
            getResponseBody: getIncrementalResponseBody,
            testServer,
          });
        });

        it(`should handle incremental requests with ${method}`, () => {
          const requestInit: RequestInit = {
            method,
            headers: {
              accept: 'application/json; charset=utf-8',
              'x-random-header': Date.now().toString(),
            },
            // @ts-expect-error duplex is not part of the RequestInit type yet
            duplex: 'half',
          };
          if (methodsWithBody.includes(method)) {
            requestInit.body = getIncrementalRequestBody();
          }
          const expectedResponse = new fetchAPI.Response(getRegularResponseBody(), {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8',
              'x-random-header': Date.now().toString(),
            },
          });
          return runTestForRequestAndResponse({
            requestInit,
            getRequestBody: getIncrementalRequestBody,
            expectedResponse,
            getResponseBody: getRegularResponseBody,
            testServer,
          });
        });
      });
    });
    function compareRequest(toBeChecked: Request, expected: Request) {
      expect(toBeChecked.method).toBe(expected.method);
      // expect(toBeChecked.url).toBe(expected.url);
      const { 'content-length': contentLength1, ...toBeCheckedObj } = getHeadersObj(
        toBeChecked.headers,
      );
      const { 'content-length': contentLength2, ...expectedObj } = getHeadersObj(expected.headers);
      expect(toBeCheckedObj).toMatchObject(expectedObj);
    }

    function compareResponse(toBeChecked: Response, expected: Response) {
      const { 'content-length': contentLength1, ...toBeCheckedObj } = getHeadersObj(
        toBeChecked.headers,
      );
      const { 'content-length': contentLength2, ...expectedObj } = getHeadersObj(expected.headers);
      expect(toBeCheckedObj).toMatchObject(expectedObj);
      expect(toBeChecked.status).toBe(expected.status);
    }
    async function compareReadableStream(
      toBeCheckedStream: ReadableStream | null,
      expected: BodyInit | null,
    ) {
      const toBeCheckedValues = [];
      const expectedValues = [];
      if (toBeCheckedStream) {
        for await (const chunk of toBeCheckedStream as any) {
          if (chunk) {
            const chunkString = Buffer.from(chunk).toString('utf-8');
            if (chunkString) {
              const chunkParts = chunkString.trim().split('\n');
              for (const chunkPart of chunkParts) {
                toBeCheckedValues.push(chunkPart);
              }
            }
          }
        }
        if (expected) {
          if (typeof expected === 'string') {
            expectedValues.push(expected);
          } else {
            for await (const chunk of expected as any) {
              if (chunk) {
                const chunkString = Buffer.from(chunk).toString('utf-8');
                if (chunkString) {
                  const chunkParts = chunkString.trim().split('\n');
                  for (const chunkPart of chunkParts) {
                    expectedValues.push(chunkPart);
                  }
                }
              }
            }
          }
          const toBeCheckedValuesString = toBeCheckedValues.join('\n');
          const expectedValuesString = expectedValues.join('\n');
          expect(toBeCheckedValuesString).toBe(expectedValuesString);
        }
      }
    }

    async function runTestForRequestAndResponse({
      requestInit,
      expectedResponse,
      getRequestBody,
      getResponseBody,
      testServer,
    }: {
      requestInit: RequestInit;
      expectedResponse: Response;
      getRequestBody: () => BodyInit;
      getResponseBody: () => BodyInit;
      testServer: TestServer;
    }) {
      const adapter = createServerAdapter(async (request: Request) => {
        compareRequest(request, expectedRequest);
        if (methodsWithBody.includes(expectedRequest.method)) {
          await compareReadableStream(request.body, getRequestBody());
        }
        return expectedResponse;
      });
      await testServer.addOnceHandler(adapter);
      const expectedRequest = new fetchAPI.Request(testServer.url, requestInit);
      const returnedResponse = await fetchAPI.fetch(expectedRequest);
      compareResponse(returnedResponse, expectedResponse);
      await compareReadableStream(returnedResponse.body, getResponseBody());
    }

    function getRegularRequestBody() {
      return JSON.stringify({ requestFoo: 'requestFoo' });
    }

    function getRegularResponseBody() {
      return JSON.stringify({ responseFoo: 'responseFoo' });
    }

    function getIncrementalRequestBody() {
      let i = 5;
      return new fetchAPI.ReadableStream({
        async pull(controller) {
          await setTimeout(30);
          if (i > 0) {
            controller.enqueue(Buffer.from(`data: request_${i.toString()}\n`));
            i--;
          } else {
            controller.close();
          }
        },
      });
    }

    function getIncrementalResponseBody() {
      let i = 5;
      return new fetchAPI.ReadableStream({
        async pull(controller) {
          await setTimeout(30);
          if (i > 0) {
            controller.enqueue(Buffer.from(`data: response_${i.toString()}\n`));
            i--;
          } else {
            controller.close();
          }
        },
      });
    }
  });
});
