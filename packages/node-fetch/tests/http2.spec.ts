import { unlink, writeFile } from 'node:fs/promises';
import { createSecureServer, ServerHttp2Session, type Http2SecureServer } from 'node:http2';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CertificateCreationResult } from 'pem';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { fetchPonyfill } from '../src/fetch';

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);
describeIf(globalThis.TEST_LIBCURL && !process.env.LEAK_TEST && !globalThis.Deno)('http2', () => {
  let server: Http2SecureServer;
  let pemPath: string;
  const oldEnvVar = process.env.NODE_EXTRA_CA_CERTS;
  const sessions = new Set<ServerHttp2Session>();
  beforeAll(async () => {
    const { createCertificate } = await import('pem');
    const keys = await new Promise<CertificateCreationResult>((resolve, reject) => {
      createCertificate(
        {
          selfSigned: true,
          days: 1,
        },
        (err, result) => {
          if (err) {
            reject(err);
          }
          resolve(result);
        },
      );
    });
    pemPath = join(tmpdir(), 'test.pem');
    process.env.NODE_EXTRA_CA_CERTS = pemPath;
    await writeFile(pemPath, keys.certificate);
    // Create a secure HTTP/2 server
    server = createSecureServer(
      {
        allowHTTP1: false,
        key: keys.serviceKey,
        cert: keys.certificate,
      },
      (request, response) => {
        response.writeHead(200, {
          'Content-Type': 'application/json',
        });
        response.end(JSON.stringify(request.headers));
      },
    );

    server.on('session', session => {
      sessions.add(session);
      session.once('close', () => {
        sessions.delete(session);
      });
    });

    await new Promise<void>(resolve => server.listen(0, resolve));
  });
  afterAll(async () => {
    await unlink(pemPath);
    process.env.NODE_EXTRA_CA_CERTS = oldEnvVar;
    for (const session of sessions) {
      session.destroy();
    }
    await new Promise(resolve => server.close(resolve));
  });
  it('works', async () => {
    const res = await fetchPonyfill(`https://localhost:${(server.address() as AddressInfo).port}`, {
      headers: {
        'x-foo': 'bar',
      },
    });
    const resJson = await res.json();
    expect(resJson['x-foo']).toBe('bar');
  });
});
