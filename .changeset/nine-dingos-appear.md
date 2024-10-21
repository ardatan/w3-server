---
"@whatwg-node/node-fetch": patch
"@whatwg-node/server": patch
---

Now the server adapter created with `@whatwg-node/server` can be used with Fastify easier;

```ts
import fastify from 'fastify'
import myServerAdapter from './myServerAdapter'

// This is the fastify instance you have created
const app = fastify({ logger: true })

/**
 * We pass the incoming HTTP request to our adapter
 * and handle the response using Fastify's `reply` API
 * Learn more about `reply` https://www.fastify.io/docs/latest/Reply/
 **/
app.route({
  url: '/mypath',
  method: ['GET', 'POST', 'OPTIONS'],
  handler: (req, reply) => myServerAdapter.handleNodeRequestAndResponse(req, reply, {
      req,
      reply
    })
})

app.listen(4000)
```