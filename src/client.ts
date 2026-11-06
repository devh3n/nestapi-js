import {
  ApiError,
  RateLimitError,
  ServerError,
  ServiceNotFoundError,
  TransportError,
  ValidationError,
} from "./errors.js";
import { ApiResponse, isPlainObject } from "./response.js";

const DEFAULT_BASE_URL = "https://open.nestapi.ir";

const DEFAULT_TIMEOUT = 30000;

const HEADERS = { Accept: "application/json" };

// A Map, so that codes like "constructor" find nothing.
const ERROR_CLASSES = new Map<string, typeof ApiError>([
  ["NOT_FOUND", ServiceNotFoundError],
  ["PARAM_NOT_FOUND", ValidationError],
  ["VALIDATION_ERROR", ValidationError],
  ["RATE_LIMITED", RateLimitError],
  ["RATE_LIMIT_EXCEEDED", RateLimitError],
]);

const PUBLIC_METHODS = ["call", "request", "version"] as const;

// Fatal, so that invalid UTF-8 is a bad body rather than replacement characters.
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface NestApiOptions {
  /** API version; the `apis-` prefix is added automatically. Defaults to 1. */
  version?: number;

  /** Root of the API. */
  baseUrl?: string;

  /**
   * Milliseconds; defaults to 30000. Applies to the default fetch only: an
   * injected fetch brings its own timeout.
   */
  timeout?: number;

  /** Used instead of the global `fetch`. */
  fetch?: typeof globalThis.fetch;
}

/** A service: takes no arguments or a single plain object of parameters. */
export interface ServiceMethod {
  (): Promise<ApiResponse>;
  (params: object): Promise<ApiResponse>;
}

interface ClientState {
  readonly version: number;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly fetch: typeof globalThis.fetch | undefined;
}

// Kept outside the instance, as #private fields fail behind a Proxy.
const states = new WeakMap<object, ClientState>();

const routing: ProxyHandler<NestApiClient> = {
  get(target, key, receiver) {
    if (
      typeof key === "symbol" ||
      key in target ||
      key.startsWith("_") ||
      key === "then" ||
      key === "toJSON"
    ) {
      return Reflect.get(target, key, receiver);
    }

    const route = toRoute(key);

    // Async, so that bad arguments reject instead of throwing.
    return async (...args: unknown[]): Promise<ApiResponse> => {
      if (args.length > 1 || (args.length === 1 && !isPlainObject(args[0]))) {
        throw new TypeError("Parameters must be a single plain object.");
      }

      return target.call(route, args[0] as object | undefined);
    };
  },
};

/**
 * Dynamic NestAPI client.
 *
 * Any property is a service: its name is turned into a route, so services can
 * come and go without changes here. Getting a property sends nothing; only the
 * call does.
 *
 *     await api.ip_info({ ip: "8.8.8.8" });  // GET /apis-1/ip-info?ip=8.8.8.8
 *     await api.ipInfo({ ip: "8.8.8.8" });   // the same route
 *
 * Names starting with `_` are never services. Services named `call`, `request`,
 * `version`, `then`, `toJSON`, or after a member of `Object.prototype` such as
 * `constructor` or `toString`, must be reached through {@link call}, e.g.
 * `await api.call("version")`.
 */
class NestApiClient {
  constructor(options: NestApiOptions = {}) {
    if (!isPlainObject(options)) {
      throw new TypeError("Options must be a plain object.");
    }

    const {
      version = 1,
      baseUrl = DEFAULT_BASE_URL,
      timeout = DEFAULT_TIMEOUT,
      fetch,
    } = options as NestApiOptions;

    return bind(this, {
      version: checkVersion(version),
      baseUrl: baseUrl.replace(/\/+$/, ""),
      timeout,
      fetch: fetch ?? undefined,
    });
  }

  /** GET a service by its exact route name, without any conversion. */
  call(service: string, params?: object): Promise<ApiResponse> {
    return this.request("GET", service, params);
  }

  /** Send any HTTP method. Parameters still go in the query string. */
  async request(method: string, service: string, params?: object): Promise<ApiResponse> {
    if (typeof method !== "string" || typeof service !== "string") {
      throw new TypeError("The method and the service must be strings.");
    }

    const state = states.get(this) as ClientState;
    const url = buildUrl(state, service, params);
    const init: RequestInit = { method: method.toUpperCase(), headers: HEADERS };

    let status: number;
    let body: ArrayBuffer;

    try {
      // Called on its own, since a browser rejects fetch as a method of another object.
      const send = state.fetch ?? globalThis.fetch;
      const response = await send(
        url,
        state.fetch ? init : { ...init, signal: AbortSignal.timeout(state.timeout) },
      );

      status = response.status;
      body = await response.arrayBuffer();
    } catch (error) {
      throw new TransportError(`Request failed: ${describe(error)}`, { cause: error });
    }

    return parse(body, status);
  }

  /** Return a copy bound to another API version; this instance is unchanged. */
  version(version: number): this {
    const state = states.get(this) as ClientState;
    const checked = checkVersion(version);
    const copy = Object.assign(Object.create(Object.getPrototypeOf(this)), this);

    return bind(copy, { ...state, version: checked }) as this;
  }
}

Object.defineProperty(NestApiClient, "name", { value: "NestApi" });

/** Any property that is not a public method is a service, except these. */
type Services = {
  readonly then?: undefined;
  readonly toJSON?: undefined;
} & {
  [service: string]: ServiceMethod;
};

/**
 * Dynamic NestAPI client; see {@link NestApiClient}.
 *
 * Services named `call`, `request`, `version`, `then`, `toJSON`, or after a
 * member of `Object.prototype`, must be reached through `api.call()`.
 */
export type NestApi = NestApiClient & Services;

/**
 * Dynamic NestAPI client; see {@link NestApiClient}.
 *
 * Services named `call`, `request`, `version`, `then`, `toJSON`, or after a
 * member of `Object.prototype`, must be reached through `api.call()`.
 */
export const NestApi = NestApiClient as unknown as new (options?: NestApiOptions) => NestApi;

function bind(target: NestApiClient, state: ClientState): NestApiClient {
  const client = new Proxy(target, routing);

  states.set(client, state);

  // Bound, so that `const { call } = api` works like `const { bmi } = api`.
  for (const name of PUBLIC_METHODS) {
    const method = target[name] as (...args: never[]) => unknown;

    Object.defineProperty(target, name, {
      value: method.bind(client),
      configurable: true,
      writable: true,
    });
  }

  return client;
}

function checkVersion(version: unknown): number {
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new TypeError(`API version must be an integer, got ${String(version)}.`);
  }

  if (version < 1 || !Number.isSafeInteger(version)) {
    throw new RangeError(`API version must be a positive integer, got ${version}.`);
  }

  return version;
}

function toRoute(name: string): string {
  return name
    .replace(/\p{Lu}/gu, (char, index: number) => (index ? `-${char}` : char))
    .replaceAll("_", "-")
    .toLowerCase();
}

function buildUrl(state: ClientState, service: string, params: object | undefined): string {
  if (params !== undefined && !isPlainObject(params)) {
    throw new TypeError("Parameters must be a plain object.");
  }

  const path = service.split("/").map(encode).join("/");
  const url = `${state.baseUrl}/apis-${state.version}/${path}`;
  const query = buildQuery(params ?? {});

  return query ? `${url}?${query}` : url;
}

/**
 * Encode parameters the same way as the PHP and Python clients.
 *
 * Booleans become `true`/`false`, the only form the server accepts. Arrays
 * become repeated keys (`a=1&a=2`), nested objects become `a[b]=1`, and null and
 * undefined are left out. Spaces are sent as `%20`.
 */
function buildQuery(params: object): string {
  const pairs: string[] = [];

  for (const [name, item] of Object.entries(params)) {
    for (const [key, value] of flatten(name, item)) {
      pairs.push(`${encode(key)}=${encode(value)}`);
    }
  }

  return pairs.join("&");
}

function* flatten(key: string, value: unknown): Generator<[string, string]> {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const nested = typeof item === "object" && item !== null;

      yield* flatten(nested ? `${key}[${index}]` : key, item);
    }
  } else if (isPlainObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      yield* flatten(`${key}[${name}]`, item);
    }
  } else if (["object", "function", "symbol"].includes(typeof value)) {
    throw new TypeError(`Parameter "${key}" cannot be sent in a query string.`);
  } else {
    yield [key, String(value)];
  }
}

// encodeURIComponent leaves !'()* alone, which PHP's rawurlencode does not.
function encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parse(body: ArrayBuffer, status: number): ApiResponse {
  let payload: unknown;

  try {
    payload = JSON.parse(decoder.decode(body));
  } catch (error) {
    throw new TransportError(`Response is not valid JSON (HTTP ${status}).`, { cause: error });
  }

  if (!isPlainObject(payload) || typeof payload["success"] !== "boolean") {
    throw new TransportError(`Response has no "success" field (HTTP ${status}).`);
  }

  if (payload["success"]) {
    return ApiResponse.fromObject(payload);
  }

  throw toError(payload["error"], status);
}

function toError(error: unknown, status: number): ApiError {
  const fields = isPlainObject(error) ? error : {};
  const code = typeof fields["code"] === "string" ? fields["code"] : "";
  const message =
    typeof fields["message"] === "string" ? fields["message"] : `API error (HTTP ${status}).`;
  const ErrorClass = ERROR_CLASSES.get(code) ?? (status >= 500 ? ServerError : ApiError);

  return new ErrorClass(message, code, status, fields["details"] ?? null);
}
