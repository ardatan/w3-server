import { CustomEvent } from '@whatwg-node/events';
import { Request, Response } from '@whatwg-node/fetch';
import { createServerAdapter } from '../src/index.js';

describe('FetchEvent listener', () => {
  it.skip('should not return a promise to event listener', async () => {
    const response = new Response();
    const response$ = Promise.resolve(response);
    const adapter = createServerAdapter(() => response$);
    const respondWith = jest.fn();
    const waitUntil = jest.fn();
    const fetchEvent = Object.assign(new CustomEvent('fetch'), {
      request: new Request('http://localhost:8080'),
      respondWith,
      waitUntil,
    });
    const returnValue = await adapter(fetchEvent);
    expect(returnValue).toBeUndefined();
    const returnedResponse = await respondWith.mock.calls[0][0];
    expect(returnedResponse).toBe(response);
  });
  it('should expose FetchEvent as server context', async () => {
    const handleRequest = jest.fn();
    const adapter = createServerAdapter(handleRequest);
    const respondWith = jest.fn();
    const waitUntil = jest.fn();
    const fetchEvent = Object.assign(new CustomEvent('fetch'), {
      request: new Request('http://localhost:8080'),
      respondWith,
      waitUntil,
    });
    await adapter(fetchEvent);
    expect(handleRequest).toHaveBeenCalledWith(fetchEvent.request, fetchEvent);
  });
  it('should accept additional parameters as server context', async () => {
    const handleRequest = jest.fn();
    const adapter = createServerAdapter<{
      foo: string;
    }>(handleRequest);
    const respondWith = jest.fn();
    const waitUntil = jest.fn();
    const fetchEvent = Object.assign(new CustomEvent('fetch'), {
      request: new Request('http://localhost:8080'),
      respondWith,
      waitUntil,
    });
    const additionalCtx = { foo: 'bar' };
    await adapter(fetchEvent, additionalCtx);
    expect(handleRequest).toHaveBeenCalledWith(
      fetchEvent.request,
      expect.objectContaining(additionalCtx),
    );
  });
});
