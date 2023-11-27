import { Server } from 'bun';
import { describe, it } from 'bun:test';
import { assertDeployedEndpoint } from '../../shared-scripts/src/index';
import { createTestServerAdapter } from '../../shared-server/src/index';

let server: Server;
let url: string;
function beforeEach() {
  server = Bun.serve({
    fetch: createTestServerAdapter(),
    port: 3000,
  });
  url = `http://${server.hostname}:${server.port}`;
}

function afterEach() {
  server.stop();
}

describe('Bun', () => {
  it('works', async () => {
    beforeEach();
    try {
      await assertDeployedEndpoint(url);
    } finally {
      afterEach();
    }
  });
});
