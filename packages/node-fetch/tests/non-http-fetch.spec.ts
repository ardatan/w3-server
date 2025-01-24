import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from '@jest/globals';
import { fetchPonyfill } from '../src/fetch.js';

describe('File protocol', () => {
  it('reads', async () => {
    const response = await fetchPonyfill(
      pathToFileURL(join(process.cwd(), './packages/node-fetch/tests/fixtures/test.json')),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.foo).toBe('bar');
  });
  it('returns 404 if file does not exist', async () => {
    const response = await fetchPonyfill(
      pathToFileURL(join(process.cwd(), './packages/node-fetch/tests/fixtures/missing.json')),
    );
    expect(response.status).toBe(404);
  });
  it('returns 403 if file is not accessible', async () => {
    const response = await fetchPonyfill(pathToFileURL('/etc/shadow'));
    expect(response.status).toBe(403);
  });
});

describe('data uris', () => {
  it('should accept base64-encoded gif data uri', async () => {
    const mimeType = 'image/gif';
    const base64Part = 'R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
    const length = 35;
    const b64 = `data:${mimeType};base64,${base64Part}`;
    const res = await fetchPonyfill(b64);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe(mimeType);
    expect(res.headers.get('Content-Length')).toBe(length.toString());
    const buf = await res.bytes();
    expect(Buffer.from(buf).toString('base64')).toBe(base64Part);
  });
  it('should accept data uri with specified charset', async () => {
    const r = await fetchPonyfill('data:text/plain;charset=UTF-8;page=21,the%20data:1234,5678');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('text/plain;charset=UTF-8;page=21');

    const b = await r.text();
    expect(b).toBe('the data:1234,5678');
  });

  it('should accept data uri of plain text', async () => {
    const r = await fetchPonyfill('data:,Hello%20World!');
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toBe('Hello World!');
  });
});
