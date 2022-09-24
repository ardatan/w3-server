import { CustomEvent } from '@whatwg-node/events';
import { Request, Response } from '@whatwg-node/fetch';
import { createServerAdapter } from '../src';

describe('FetchEvent listener', () => {
  it('should not return a promise to event listener', () => {
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
    const returnValue = adapter(fetchEvent);
    expect(returnValue).toBeUndefined();
    expect(respondWith).toHaveBeenCalledWith(response$);
  });
  it('should expose FetchEvent as server context', () => {
    const handleRequest = jest.fn();
    const adapter = createServerAdapter(handleRequest);
    const respondWith = jest.fn();
    const waitUntil = jest.fn();
    const fetchEvent = Object.assign(new CustomEvent('fetch'), {
      request: new Request('http://localhost:8080'),
      respondWith,
      waitUntil,
    });
    adapter(fetchEvent);
    expect(handleRequest).toHaveBeenCalledWith(fetchEvent.request, fetchEvent);
  });
  it('should accept additional parameters as server context', () => {
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
    adapter(fetchEvent, additionalCtx);
    expect(handleRequest).toHaveBeenCalledWith(fetchEvent.request, expect.objectContaining(additionalCtx));
  })
});
