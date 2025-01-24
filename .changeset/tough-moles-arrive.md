---
'@whatwg-node/node-fetch': patch
---

When `fetch('file:///...')` is used to read files;
- 404 is returned if the file is missing
- 403 is returned if the file is not accessible