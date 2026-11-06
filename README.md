# NestAPI JavaScript Client

[![npm version](https://img.shields.io/npm/v/@devh3n/nestapi?logo=npm)](https://www.npmjs.com/package/@devh3n/nestapi)
[![CI](https://github.com/devh3n/nestapi-js/actions/workflows/ci.yml/badge.svg)](https://github.com/devh3n/nestapi-js/actions/workflows/ci.yml)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18-5FA04E?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A small, fully dynamic TypeScript/JavaScript client for the [NestAPI](https://nestapi.ir/api-usage) web services.

The library contains no service names: any method you call becomes a route. New services work the moment they go live, and removed ones need no code change.

## Features

- **Dynamic routing:** `api.ip_info()` and `api.ipInfo()` call `ip-info` with no per-service classes or models
- **Promise based:** every request is async, so there is one `NestApi` class
- **Plain object parameters**, with validation left to the server
- **Immutable version switching** through `version()`
- **Deeply frozen responses** with dot-path access
- **Typed errors** mapped from the API's `error.code`
- **No runtime dependencies:** built on `fetch`, for Node.js and the browser
- **Written in TypeScript**, with ESM and CommonJS builds

## Requirements

Node.js 18 or higher, or a browser with `fetch` and `AbortSignal.timeout`.

## Installation

```bash
npm install @devh3n/nestapi
```

Or with another package manager:

```bash
pnpm add @devh3n/nestapi
```

```bash
yarn add @devh3n/nestapi
```

## Quick start

ES modules:

```js
import { NestApi } from "@devh3n/nestapi";

const api = new NestApi();
const result = await api.bmi({ age: 30, weight: 70, height: 175 });

console.log(result.data.bmi);          // 22.86
console.log(result.get("input.age"));  // 30
```

CommonJS:

```js
const { NestApi } = require("@devh3n/nestapi");

async function main() {
  const api = new NestApi();
  const result = await api.bmi({ age: 30, weight: 70, height: 175 });

  console.log(result.data.bmi);  // 22.86
}

main();
```

## Routing

The route is built from the method name. Every `_` becomes `-`, every uppercase letter except the first starts a new `-` segment, and the result is lowercase.

| Method | Route |
|---|---|
| `ip_info`, `ipInfo` | `ip-info` |
| `search_shazam` | `search-shazam` |
| `chatAi`, `ChatAi` | `chat-ai` |
| `chatAI` | `chat-a-i` |

Getting a method sends nothing. The request goes out when you call it.

Pass parameters as one plain object, or nothing at all. Anything else rejects with a `TypeError` and sends no request. These errors are always rejected promises, so `catch` and `try`/`await` behave the same.

```js
await api.bmi({ age: 30, weight: 70, height: 175 });
await api.some_service();

await api.bmi(30, 70);             // TypeError
await api.bmi([30, 70]);           // TypeError
await api.bmi(null);               // TypeError
await api.bmi(new Map());          // TypeError
```

### Explicit calls

```js
// GET with the exact route name, no conversion
await api.call("ip-info", { ip: "8.8.8.8" });

// Any other HTTP method; parameters still go in the query string
await api.request("POST", "some-service", { a: 1 });
```

The service name in `call()` and `request()` is URL-encoded and `/` is kept, so `?` or `#` cannot change the address.

> [!NOTE]
> Services named `call`, `request`, `version`, `then`, `toJSON`, or after a member of `Object.prototype` such as `constructor`, `toString`, `valueOf` or `hasOwnProperty` cannot be reached as methods. Use `call()`, for example `api.call("version")`. The same goes for names starting with `_`.

Without these exceptions, `await api` and `JSON.stringify(api)` would send requests. With them, you can await the client, return it from an async function and pass it around like any other object.

### Parameter values

| JavaScript value | Sent as | Notes |
|---|---|---|
| `true` / `false` | `x=true` / `x=false` | The server rejects `1` and `0` |
| `null` / `undefined` | Not sent | Also skipped inside arrays and objects |
| `0`, `""` | `x=0`, `x=` | Always sent |
| Array | `x=1&x=2` | Repeated keys. Not yet verified against the live API, as no documented service takes an array input |
| Object | `x[key]=1` | Same format as the PHP and Python clients. Inside an array: `x[0][a]=1`. Not yet verified against the live API |

Spaces are encoded as `%20`, and non-ASCII text is sent as UTF-8. Values with no query string form, such as a `Date`, `Map`, function or symbol, reject with a `TypeError`, so convert them to strings first.

## Versions

The default version is `1`, and the `apis-` prefix is added for you. `version()` returns a copy with the same `fetch` and settings, and leaves the original instance unchanged. It is synchronous, so its errors are thrown.

```js
const api = new NestApi({ version: 2 });

const v3 = api.version(3);

await v3.bmi({ age: 30, weight: 70, height: 175 });  // /apis-3/bmi
await api.bmi({ age: 30, weight: 70, height: 175 }); // /apis-2/bmi
```

An integer below `1` raises `RangeError`. Anything else that is not an integer raises `TypeError`, including `1.5`, `NaN`, `Infinity`, `"1"` and `"apis-1"`.

There is no automatic "latest version" mode. The `source.version` field in responses is unrelated to the version in the URL.

## Responses

A successful call resolves to a read-only `ApiResponse`.

```js
const result = await api.bmi({ age: 30, weight: 70, height: 175 });

result.data                  // Object, array, string or null
result.meta                  // Optional, service-defined; null when absent
result.source                // { name: "NestAPI", ... }

result.data.bmi              // 22.86

result.get("input.age")      // 30
result.get("input.nope", 0)  // 0
result.get("items.0.title")  // Paths can index into arrays

result.has("bmi")            // true
result.has("nope")           // false

result.data = {}             // TypeError in strict mode
result.data.bmi = 1          // TypeError in strict mode: deeply frozen
```

- A key that exists with a null value gives `null`, not the default.
- If `data` is not an object or array, `get()` returns the default and `has()` returns `false`.
- `get()` and `has()` only see the object's own keys, so `constructor`, `__proto__`, `toString` and an array's `length` count as missing.
- `JSON.stringify(result)` gives `data`, `meta` and `source`.

## Error handling

Branch on `errorCode`, not on the message, because message text can change.

| Error | Raised for |
|---|---|
| `ServiceNotFoundError` | `NOT_FOUND`: unknown service or API version |
| `ValidationError` | `PARAM_NOT_FOUND`, `VALIDATION_ERROR` |
| `RateLimitError` | `RATE_LIMITED`, `RATE_LIMIT_EXCEEDED` |
| `ServerError` | Any other code with HTTP status 500 or above |
| `ApiError` | Base class of the above, and any other code such as `INVALID_IP` |
| `TransportError` | Network failure, timeout, unreadable or non-JSON body, or a body outside the API format |

`TransportError` is separate from `ApiError`, so catch it as well if you want to handle every failure.

```js
import { ApiError, TransportError, ValidationError } from "@devh3n/nestapi";

try {
  await api.bmi({ age: 500, weight: 70, height: 175 });
} catch (error) {
  if (error instanceof ValidationError) {
    error.errorCode;  // "VALIDATION_ERROR"
    error.status;     // 422
    error.details;    // { "query.age": "Must be less than or equal to 120" }
  } else if (error instanceof ApiError) {
    // Any other error reported by the API
  } else if (error instanceof TransportError) {
    // No usable response arrived; the original error is in error.cause
  }
}
```

`details` is an array for `PARAM_NOT_FOUND` and an object for `VALIDATION_ERROR`.

## Configuration

`new NestApi()` works without any setup. Every option can be set through the constructor:

```js
const api = new NestApi({
  version: 1,
  baseUrl: "https://open.nestapi.ir",
  timeout: 30000,             // Milliseconds, default fetch only
  fetch: myFetch,             // Optional
});
```

A `fetch` you inject brings its own timeout, so `timeout` has no effect on it. `globalThis.fetch` is otherwise read at each request.

SSL verification is left to `fetch`, and there is no option to turn it off. There is no `close()` either, because `fetch` gives the client no connection to close.

## TypeScript

Types are included. Any service name is typed as a method, and the public methods keep their own signatures.

```ts
import { NestApi, type ApiResponse } from "@devh3n/nestapi";

const api = new NestApi();

const result: ApiResponse = await api.anyService({ a: 1 });
```

`data` and `meta` are typed as `any`, because their shape depends on the service.

Dynamic names rely on an index signature, so two compiler options reject them: `noUncheckedIndexedAccess` and `noPropertyAccessFromIndexSignature`. With either one on, use `api.call("any-service", { a: 1 })`.

## Testing

```bash
npm install
```

```bash
npm test
```

```bash
npm run typecheck
```

## License

Released under the [MIT License](LICENSE).
