module.exports.fetch = globalThis.fetch; // To enable: import {fetch} from 'cross-fetch'
module.exports.Headers = globalThis.Headers;
module.exports.Request = globalThis.Request;
module.exports.Response = globalThis.Response;
module.exports.FormData = globalThis.FormData;
module.exports.AbortController = globalThis.AbortController;
module.exports.ReadableStream = globalThis.ReadableStream;
module.exports.WritableStream = globalThis.WritableStream;
module.exports.TransformStream = globalThis.TransformStream;
module.exports.Blob = globalThis.Blob;
module.exports.File = globalThis.File;
module.exports.crypto = globalThis.crypto;
module.exports.btoa = globalThis.btoa;
module.exports.TextEncoder = globalThis.TextEncoder;
module.exports.TextDecoder = globalThis.TextDecoder;
module.exports.URLPattern = globalThis.URLPattern;
if (!module.exports.URLPattern) {
    const urlPatternModule = require('urlpattern-polyfill');
    module.exports.URLPattern = urlPatternModule.URLPattern;
}
module.exports.createFetch = () => globalThis;
