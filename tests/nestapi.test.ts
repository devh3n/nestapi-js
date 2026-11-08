import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ApiError,
  ApiResponse,
  NestApi,
  RateLimitError,
  ServerError,
  ServiceNotFoundError,
  TransportError,
  ValidationError,
} from "../src/index.js";
import type { NestApiOptions, ServiceMethod } from "../src/index.js";

const OK =
  '{"success":true,"data":{"bmi":22.86,"input":{"age":30,"note":null},' +
  '"items":[{"id":7}]},"meta":{"page":2},"source":{"name":"NestAPI","version":"3.0.0"}}';

const ROOT = "https://open.nestapi.ir";

type Body = string | Uint8Array<ArrayBuffer>;

/** An injected fetch answering every request with one canned response. */
function fake(body: Body = OK, status = 200) {
  const calls: { url: string; init: RequestInit; self: unknown }[] = [];

  const fetch = async function (this: unknown, url: string | URL | Request, init?: RequestInit) {
    calls.push({ url: String(url), init: init ?? {}, self: this });

    return new Response(body, { status });
  };

  return {
    calls,
    fetch: fetch as typeof globalThis.fetch,
    api: (version = 1) => new NestApi({ version, fetch: fetch as typeof globalThis.fetch }),
    get url() {
      return calls.at(-1)?.url ?? "";
    },
    get query() {
      return this.url.split("?")[1] ?? "";
    },
  };
}

function respond(body: Body, status = 200) {
  return fake(body, status).api().foo();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("routing", () => {
  it.each([
    ["ip_info", "ip-info"],
    ["search_shazam", "search-shazam"],
    ["ipInfo", "ip-info"],
    ["chatAi", "chat-ai"],
    ["ChatAi", "chat-ai"],
    ["chatAI", "chat-a-i"],
    ["bmi", "bmi"],
    ["Bmi", "bmi"],
    ["num2words", "num2words"],
    ["soundcloudDownloadV2", "soundcloud-download-v2"],
    ["soundcloud_download_v2", "soundcloud-download-v2"],
    ["a__b", "a--b"],
    ["Then", "then"],
  ])("turns %s into %s", async (method, route) => {
    const server = fake();

    await server.api()[method]!();

    expect(server.url).toBe(`${ROOT}/apis-1/${route}`);
    expect(server.calls[0]?.init.method).toBe("GET");
  });

  it("sends nothing until a service is called", () => {
    const server = fake();

    const service = server.api().bmi;

    expect(typeof service).toBe("function");
    expect(server.calls).toEqual([]);
  });

  it("keeps a detached service working", async () => {
    const server = fake();
    const { bmi } = server.api();

    await bmi({ age: 30 });

    expect(server.url).toBe(`${ROOT}/apis-1/bmi?age=30`);
  });

  it("keeps detached public methods working", async () => {
    const server = fake();
    const { call, request, version } = server.api();

    await call("bmi");
    expect(server.url).toBe(`${ROOT}/apis-1/bmi`);

    await request("POST", "bmi");
    expect(server.calls[1]?.init.method).toBe("POST");

    await version(2).bmi();
    expect(server.url).toBe(`${ROOT}/apis-2/bmi`);
  });

  it.each([
    "then",
    "toJSON",
    "_x",
    "__x",
    "_",
    "__wrapped__",
  ])("does not treat %s as a service", (name) => {
    const api = fake().api() as unknown as Record<string, unknown>;

    expect(api[name]).toBeUndefined();
  });

  it("does not treat symbols as services", () => {
    const api = fake().api() as unknown as Record<symbol, unknown>;

    expect(api[Symbol("x")]).toBeUndefined();
    expect(api[Symbol.toPrimitive]).toBeUndefined();
    expect(api[Symbol.iterator]).toBeUndefined();
    expect(api[Symbol.asyncIterator]).toBeUndefined();
  });

  it("keeps the Object.prototype members", () => {
    const api = fake().api() as unknown as Record<string, unknown>;

    expect(api["constructor"]).toBe(NestApi);
    expect(api["toString"]).toBe(Object.prototype.toString);
    expect(api["valueOf"]).toBe(Object.prototype.valueOf);
    expect(api["hasOwnProperty"]).toBe(Object.prototype.hasOwnProperty);
    expect(api["isPrototypeOf"]).toBe(Object.prototype.isPrototypeOf);
    expect(api["toLocaleString"]).toBe(Object.prototype.toLocaleString);
    expect(api["propertyIsEnumerable"]).toBe(Object.prototype.propertyIsEnumerable);
    expect(api["__proto__"]).toBe(NestApi.prototype);
  });

  it("is an instance of NestApi", () => {
    const api = new NestApi();

    expect(api).toBeInstanceOf(NestApi);
    expect(api.version(2)).toBeInstanceOf(NestApi);
    expect(NestApi.name).toBe("NestApi");
  });

  it("exposes only the documented public names", () => {
    const names = Object.getOwnPropertyNames(NestApi.prototype);

    expect(names.sort()).toEqual(["call", "constructor", "request", "version"]);
    expect(Object.keys(new NestApi())).toEqual([]);
  });
});

describe("the client as a value", () => {
  it("resolves to itself when awaited", async () => {
    const server = fake();
    const api = server.api();

    expect(await api).toBe(api);
    expect(server.calls).toEqual([]);
  });

  it("survives Promise.resolve", async () => {
    const server = fake();
    const api = server.api();

    expect(await Promise.resolve(api)).toBe(api);
    expect(server.calls).toEqual([]);
  });

  it("can be returned from an async function", async () => {
    const server = fake();
    const api = server.api();
    const make = async () => api;

    const made = await make();

    expect(made).toBe(api);
    expect(server.calls).toEqual([]);

    await made.bmi();
    expect(server.calls).toHaveLength(1);
  });

  it("sends nothing through JSON.stringify or String", () => {
    const server = fake();
    const api = server.api();

    expect(JSON.stringify(api)).toBe("{}");
    expect(JSON.stringify({ api })).toBe('{"api":{}}');
    expect(String(api)).toBe("[object Object]");
    expect(`${api}`).toBe("[object Object]");
    expect(server.calls).toEqual([]);
  });
});

describe("parameters", () => {
  it("sends an object as a query string", async () => {
    const server = fake();

    await server.api().bmi({ age: 30, weight: 70, height: 175 });

    expect(server.url).toBe(`${ROOT}/apis-1/bmi?age=30&weight=70&height=175`);
  });

  it("allows calling without arguments", async () => {
    const server = fake();

    await server.api().bmi();
    await server.api().bmi({});

    expect(server.calls.map((call) => call.url)).toEqual([
      `${ROOT}/apis-1/bmi`,
      `${ROOT}/apis-1/bmi`,
    ]);
  });

  it("accepts objects without a prototype", async () => {
    const server = fake();

    await server.api().bmi(Object.assign(Object.create(null), { age: 30 }));

    expect(server.query).toBe("age=30");
  });

  it("does not confuse a service input called key with a license key", async () => {
    const server = fake();

    await server.api().search_shazam({ key: "abc" });

    expect(server.url).toBe(`${ROOT}/apis-1/search-shazam?key=abc`);
  });

  class Custom {
    age = 30;
  }

  const invalid: [string, unknown[]][] = [
    ["a number", [30]],
    ["two numbers", [30, 70]],
    ["a string", ["a"]],
    ["null", [null]],
    ["undefined", [undefined]],
    ["a boolean", [true]],
    ["an array", [[30, 70]]],
    ["an empty array", [[]]],
    ["a Map", [new Map([["age", 30]])]],
    ["a Set", [new Set()]],
    ["a Date", [new Date()]],
    ["a class instance", [new Custom()]],
    ["a function", [() => 1]],
    ["two objects", [{ age: 30 }, { weight: 70 }]],
    ["an object and a number", [{ age: 30 }, 70]],
    ["an object and undefined", [{ age: 30 }, undefined]],
  ];

  it.each(invalid)("rejects %s with no request", async (_name, args) => {
    const server = fake();
    const service = server.api().bmi as unknown as (...params: unknown[]) => Promise<ApiResponse>;

    let promise: Promise<ApiResponse> | undefined;

    expect(() => {
      promise = service(...args);
    }).not.toThrow();

    await expect(promise).rejects.toBeInstanceOf(TypeError);
    expect(server.calls).toEqual([]);
  });

  it.each([
    ["number", 5],
    ["string", "a=1"],
    ["null", null],
    ["array", [1]],
    ["Map", new Map()],
  ])("rejects a %s in call() and request() with no request", async (_name, params) => {
    const server = fake();
    const api = server.api();
    const bad = params as object;

    await expect(api.call("bmi", bad)).rejects.toBeInstanceOf(TypeError);
    await expect(api.request("GET", "bmi", bad)).rejects.toBeInstanceOf(TypeError);
    expect(server.calls).toEqual([]);
  });

  it("rejects a non-string method or service", async () => {
    const server = fake();
    const api = server.api();

    await expect(api.call(5 as unknown as string)).rejects.toBeInstanceOf(TypeError);
    await expect(api.request(5 as unknown as string, "bmi")).rejects.toBeInstanceOf(TypeError);
    expect(server.calls).toEqual([]);
  });

  it("sends booleans as words", async () => {
    const server = fake();

    await server.api().foo({ on: true, off: false });

    expect(server.query).toBe("on=true&off=false");
  });

  it("keeps zero, false and the empty string", async () => {
    const server = fake();

    await server.api().foo({ zero: 0, no: false, empty: "", real: 1.5 });

    expect(server.query).toBe("zero=0&no=false&empty=&real=1.5");
  });

  it("does not send null or undefined, even nested", async () => {
    const server = fake();

    await server.api().foo({
      a: null,
      b: undefined,
      c: 1,
      d: [null, 2, undefined],
      e: { f: null, g: undefined },
    });

    expect(server.query).toBe("c=1&d=2");
  });

  it("sends no query when only null and undefined remain", async () => {
    const server = fake();

    await server.api().foo({ a: null, b: undefined, c: [], d: {} });

    expect(server.url).toBe(`${ROOT}/apis-1/foo`);
  });

  it("sends arrays as repeated keys", async () => {
    const server = fake();

    await server.api().foo({ ids: [1, 2], flags: [true, false], empty: [] });

    expect(server.query).toBe("ids=1&ids=2&flags=true&flags=false");
  });

  it("sends nested objects with encoded brackets", async () => {
    const server = fake();

    await server.api().foo({ x: { key: 1, on: true, deep: { y: [1, 2] } }, z: [{ a: 1 }] });

    expect(server.query).toBe(
      "x%5Bkey%5D=1&x%5Bon%5D=true&x%5Bdeep%5D%5By%5D=1&x%5Bdeep%5D%5By%5D=2&z%5B0%5D%5Ba%5D=1",
    );
  });

  it("keeps the index of objects inside arrays", async () => {
    const server = fake();

    await server.api().foo({ x: [{ a: 1 }, { a: 2 }] });

    expect([...new URL(server.url).searchParams]).toEqual([
      ["x[0][a]", "1"],
      ["x[1][a]", "2"],
    ]);
  });

  it("encodes spaces as %20 and Persian text as UTF-8", async () => {
    const server = fake();

    await server.api().foo({ q: "a b&c=[0]=+", fa: "سلام دنیا" });

    expect(server.query).toBe(
      "q=a%20b%26c%3D%5B0%5D%3D%2B&fa=%D8%B3%D9%84%D8%A7%D9%85%20%D8%AF%D9%86%DB%8C%D8%A7",
    );
    expect(new URL(server.url).searchParams.get("fa")).toBe("سلام دنیا");
  });

  it("encodes the characters encodeURIComponent leaves alone", async () => {
    const server = fake();

    await server.api().foo({ q: "!'()*", safe: "-_.~" });

    expect(server.query).toBe("q=%21%27%28%29%2A&safe=-_.~");
  });

  it("does not decode a percent sign on the way", async () => {
    const server = fake();

    await server.api().foo({ q: "100%25" });

    expect(server.query).toBe("q=100%2525");
  });

  it("encodes parameter names", async () => {
    const server = fake();

    await server.api().foo({ "a b": 1 });

    expect(server.query).toBe("a%20b=1");
  });

  it("sends a bigint", async () => {
    const server = fake();

    await server.api().foo({ id: 12345678901234567890n });

    expect(server.query).toBe("id=12345678901234567890");
  });

  it.each([
    ["Map", new Map()],
    ["Date", new Date()],
    ["function", () => 1],
    ["symbol", Symbol("x")],
  ])("rejects a nested %s instead of sending it as text", async (_name, value) => {
    const server = fake();

    await expect(server.api().foo({ a: value })).rejects.toBeInstanceOf(TypeError);
    await expect(server.api().foo({ a: [value] })).rejects.toBeInstanceOf(TypeError);
    expect(server.calls).toEqual([]);
  });

  it("rejects circular and malformed values with no request", async () => {
    const server = fake();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    await expect(server.api().foo(circular)).rejects.toBeInstanceOf(Error);
    await expect(server.api().foo({ q: "\ud800" })).rejects.toBeInstanceOf(Error);
    expect(server.calls).toEqual([]);
  });
});

describe("public methods", () => {
  it("call() uses the exact route", async () => {
    const server = fake();
    const api = server.api();

    await api.call("MobileSearch", { q: "x" });
    expect(server.url).toBe(`${ROOT}/apis-1/MobileSearch?q=x`);

    await api.call("snake_case");
    expect(server.url).toBe(`${ROOT}/apis-1/snake_case`);
    expect(server.calls[0]?.init.method).toBe("GET");
  });

  it.each([
    "call",
    "request",
    "version",
    "then",
    "toJSON",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ])("reaches a service named %s through call()", async (service) => {
    const server = fake();

    await server.api().call(service);

    expect(server.url).toBe(`${ROOT}/apis-1/${service}`);
  });

  it("does not let a service name change the URL", async () => {
    const server = fake();

    await server.api().call("a b?x=1#y", { q: 1 });

    expect(server.url).toBe(`${ROOT}/apis-1/a%20b%3Fx%3D1%23y?q=1`);
  });

  it("keeps a slash in a service name", async () => {
    const server = fake();

    await server.api().call("group/sub");

    expect(server.url).toBe(`${ROOT}/apis-1/group/sub`);
  });

  it("request() uppercases the method and keeps params in the query", async () => {
    const server = fake();

    await server.api().request("post", "upload-file", { a: 1 });

    const call = server.calls[0];
    expect(call?.init.method).toBe("POST");
    expect(call?.url).toBe(`${ROOT}/apis-1/upload-file?a=1`);
    expect(call?.init.body).toBeUndefined();
  });

  it("sends the Accept header", async () => {
    const server = fake();

    await server.api().bmi();
    await server.api().request("POST", "bmi");

    for (const call of server.calls) {
      expect(call.init.headers).toEqual({ Accept: "application/json" });
    }
  });

  it("has no close()", () => {
    expect(Object.getOwnPropertyNames(NestApi.prototype)).not.toContain("close");
  });
});

describe("version", () => {
  it("defaults to 1", async () => {
    const server = fake();

    await new NestApi({ fetch: server.fetch }).bmi();

    expect(server.url).toBe(`${ROOT}/apis-1/bmi`);
  });

  it("can be set in the constructor", async () => {
    const server = fake();

    await server.api(2).bmi();

    expect(server.url).toBe(`${ROOT}/apis-2/bmi`);
  });

  it("version() returns a copy and leaves the original unchanged", async () => {
    const server = fake();
    const api = server.api();
    const other = api.version(3);

    expect(other).not.toBe(api);

    await other.bmi();
    expect(server.url).toBe(`${ROOT}/apis-3/bmi`);

    await api.bmi();
    expect(server.url).toBe(`${ROOT}/apis-1/bmi`);

    await other.version(4).version(5).bmi();
    expect(server.url).toBe(`${ROOT}/apis-5/bmi`);

    await other.bmi();
    expect(server.url).toBe(`${ROOT}/apis-3/bmi`);
  });

  it("copies keep the fetch and the settings", async () => {
    const server = fake();
    const api = new NestApi({ baseUrl: "https://example.test/proxy/", fetch: server.fetch });

    await api.version(2).call("bmi");

    expect(server.url).toBe("https://example.test/proxy/apis-2/bmi");
  });

  it("copies keep the default timeout", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(OK));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", fetch);

    await new NestApi({ timeout: 1234 }).version(2).bmi();

    expect(timeout).toHaveBeenCalledWith(1234);
    timeout.mockRestore();
  });

  it("copies are real clients", async () => {
    const server = fake();
    const copy = server.api().version(2);

    expect(await copy).toBe(copy);
    expect(JSON.stringify(copy)).toBe("{}");
    expect(copy.then).toBeUndefined();
    expect(server.calls).toEqual([]);
  });

  it.each([0, -1, -100])("gives RangeError for %s", (version) => {
    const api = fake().api();

    expect(() => new NestApi({ version })).toThrow(RangeError);
    expect(() => api.version(version)).toThrow(RangeError);
  });

  it.each([
    ["a float", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["negative Infinity", Number.NEGATIVE_INFINITY],
    ['"1"', "1"],
    ['"apis-1"', "apis-1"],
    ["true", true],
    ["null", null],
    ["an object", {}],
  ])("gives TypeError for %s", (_name, version) => {
    const bad = version as number;
    const api = fake().api();

    expect(() => new NestApi({ version: bad })).toThrow(TypeError);
    expect(() => api.version(bad)).toThrow(TypeError);
  });

  it("version() throws synchronously for undefined too", () => {
    const api = fake().api();

    expect(() => api.version(undefined as unknown as number)).toThrow(TypeError);
  });

  it("does not take the version from source.version", async () => {
    const server = fake('{"success":true,"data":1,"source":{"version":"9.9.9"}}');
    const api = server.api();

    await api.bmi();
    await api.bmi();

    expect(server.url).toBe(`${ROOT}/apis-1/bmi`);
  });
});

describe("configuration", () => {
  it("works without any setup", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(OK));
    vi.stubGlobal("fetch", fetch);

    const result = await new NestApi().bmi();

    expect(result).toBeInstanceOf(ApiResponse);
    expect(fetch.mock.calls[0]?.[0]).toBe(`${ROOT}/apis-1/bmi`);
  });

  it("strips the trailing slash of baseUrl", async () => {
    const server = fake();

    await new NestApi({ baseUrl: "https://example.test/", fetch: server.fetch }).bmi();
    expect(server.url).toBe("https://example.test/apis-1/bmi");

    await new NestApi({ baseUrl: "https://example.test//", fetch: server.fetch }).bmi();
    expect(server.url).toBe("https://example.test/apis-1/bmi");
  });

  it("rejects options that are not an object", () => {
    expect(() => new NestApi(2 as unknown as NestApiOptions)).toThrow(TypeError);
  });

  it("calls the injected fetch on its own", async () => {
    const server = fake();

    await server.api().bmi();

    expect(server.calls[0]?.self).toBeUndefined();
  });

  it("calls the global fetch on its own and reads it at each request", async () => {
    const seen: string[] = [];
    const stub = (name: string) =>
      function (this: unknown) {
        expect(this).toBeUndefined();
        seen.push(name);
        return Promise.resolve(new Response(OK));
      };

    const api = new NestApi();

    vi.stubGlobal("fetch", stub("first"));
    await api.bmi();

    vi.stubGlobal("fetch", stub("second"));
    await api.bmi();

    expect(seen).toEqual(["first", "second"]);
  });

  it("applies a 30 second timeout to the default fetch", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(OK));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal("fetch", fetch);

    await new NestApi().bmi();

    expect(timeout).toHaveBeenCalledWith(30000);
    expect(fetch.mock.calls[0]?.[1].signal).toBeInstanceOf(AbortSignal);
    timeout.mockRestore();
  });

  it("does not apply the timeout to an injected fetch", async () => {
    const server = fake();

    await new NestApi({ timeout: 5, fetch: server.fetch }).bmi();

    expect(server.calls[0]?.init.signal).toBeUndefined();
  });

  it("turns a timeout into a TransportError", async () => {
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });

    const failure = await new NestApi({ timeout: 5 }).bmi().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransportError);
    expect(((failure as TransportError).cause as Error).name).toBe("TimeoutError");
  });
});

describe("ApiResponse", () => {
  it("exposes data, meta and source", async () => {
    const res = await fake().api().bmi();

    expect(res).toBeInstanceOf(ApiResponse);
    expect(res.data.bmi).toBe(22.86);
    expect(res.meta).toEqual({ page: 2 });
    expect(res.source["name"]).toBe("NestAPI");
  });

  it("has only getters", () => {
    for (const name of ["data", "meta", "source"]) {
      const property = Object.getOwnPropertyDescriptor(ApiResponse.prototype, name);

      expect(property?.get).toBeTypeOf("function");
      expect(property?.set).toBeUndefined();
    }
  });

  it.each(["data", "meta", "source"])("cannot reassign %s", async (name) => {
    const res = (await fake().api().bmi()) as unknown as Record<string, unknown>;

    expect(() => {
      res[name] = "x";
    }).toThrow(TypeError);
  });

  it("cannot gain new properties", async () => {
    const res = (await fake().api().bmi()) as unknown as Record<string, unknown>;

    expect(() => {
      res["other"] = "x";
    }).toThrow(TypeError);
  });

  it("deeply freezes data, meta and source", async () => {
    const res = await respond(
      '{"success":true,"data":{"a":{"b":[{"c":1}]}},"meta":{"d":{"e":1}},"source":{"f":{"g":1}}}',
    );

    expect(Object.isFrozen(res.data)).toBe(true);
    expect(Object.isFrozen(res.data.a)).toBe(true);
    expect(Object.isFrozen(res.data.a.b)).toBe(true);
    expect(Object.isFrozen(res.data.a.b[0])).toBe(true);
    expect(Object.isFrozen(res.meta.d)).toBe(true);
    expect(Object.isFrozen(res.source["f"])).toBe(true);

    expect(() => {
      res.data.a.b[0].c = 2;
    }).toThrow(TypeError);
    expect(() => res.data.a.b.push(1)).toThrow(TypeError);
  });

  it("freezes data nested deeper than the call stack", async () => {
    const depth = 200000;
    const res = await respond(`{"success":true,"data":${"[".repeat(depth)}${"]".repeat(depth)}}`);

    expect(Array.isArray(res.data)).toBe(true);
  });

  it("fromObject() fills in missing fields", () => {
    const res = ApiResponse.fromObject({ success: true });

    expect(res.data).toBeNull();
    expect(res.meta).toBeNull();
    expect(res.source).toEqual({});
  });

  it.each([
    ["a string", "x"],
    ["an array", [1]],
    ["null", null],
    ["a number", 5],
  ])("fromObject() replaces %s as source", (_name, source) => {
    const res = ApiResponse.fromObject({ source });

    expect(res.source).toEqual({});
    expect(Object.isFrozen(res.source)).toBe(true);
  });

  it("get() reads dot paths with a default", async () => {
    const res = await fake().api().bmi();

    expect(res.get("bmi")).toBe(22.86);
    expect(res.get("input.age")).toBe(30);
    expect(res.get("items.0.id")).toBe(7);
    expect(res.get("input.missing", "d")).toBe("d");
    expect(res.get("bmi.deeper", "d")).toBe("d");
    expect(res.get("items.1.id", "d")).toBe("d");
    expect(res.get("items.x", "d")).toBe("d");
    expect(res.get("items.-1", "d")).toBe("d");
    expect(res.get("items.1e0", "d")).toBe("d");
    expect(res.get("missing")).toBeNull();
  });

  it("get() returns an existing null rather than the default", async () => {
    const res = await fake().api().bmi();

    expect(res.get("input.note", "d")).toBeNull();
  });

  it("has() checks top-level keys", async () => {
    const res = await fake().api().bmi();

    expect(res.has("bmi")).toBe(true);
    expect(res.has("missing")).toBe(false);
    expect(res.has("input.age")).toBe(false);
  });

  it("has() is true for a key holding null", async () => {
    const res = await respond('{"success":true,"data":{"a":null},"source":{}}');

    expect(res.has("a")).toBe(true);
    expect(res.get("a", "d")).toBeNull();
  });

  it.each(['"hello"', "null", "5", "true"])("handles non-container data %s", async (value) => {
    const res = await respond(`{"success":true,"data":${value},"source":{}}`);

    expect(res.data).toEqual(JSON.parse(value));
    expect(res.get("a", "d")).toBe("d");
    expect(res.get("length", "d")).toBe("d");
    expect(res.get("0", "d")).toBe("d");
    expect(res.has("a")).toBe(false);
    expect(res.has("length")).toBe(false);
    expect(res.has("0")).toBe(false);
  });

  it("handles array data by index", async () => {
    const res = await respond('{"success":true,"data":[{"id":1}],"source":{}}');

    expect(res.get("0.id")).toBe(1);
    expect(res.has("0")).toBe(true);
    expect(res.has(0)).toBe(true);
    expect(res.has("1")).toBe(false);
    expect(res.has("-1")).toBe(false);
  });

  it.each([
    "constructor",
    "__proto__",
    "toString",
    "hasOwnProperty",
    "input.constructor",
    "input.__proto__",
    "items.constructor",
    "items.length",
    "items.push",
    "items.__proto__",
    "bmi.toFixed",
  ])("treats %s as missing", async (path) => {
    const res = await fake().api().bmi();

    expect(res.get(path, "d")).toBe("d");
    expect(res.has(path)).toBe(false);
  });

  it("length is missing on arrays, but a real key called length is found", async () => {
    const array = await respond('{"success":true,"data":[1],"source":{}}');
    const object = await respond('{"success":true,"data":{"length":3},"source":{}}');

    expect(array.get("length", "d")).toBe("d");
    expect(array.has("length")).toBe(false);
    expect(object.get("length", "d")).toBe(3);
    expect(object.has("length")).toBe(true);
  });

  it("is not a Proxy: unknown properties are simply undefined", async () => {
    const res = (await fake().api().bmi()) as unknown as Record<string, unknown>;

    expect(res["bmi"]).toBeUndefined();
  });

  it("serializes to JSON", async () => {
    const res = await respond('{"success":true,"data":{"a":1},"source":{"name":"x"}}');

    expect(JSON.parse(JSON.stringify(res))).toEqual({
      data: { a: 1 },
      meta: null,
      source: { name: "x" },
    });
  });
});

describe("errors", () => {
  it.each<[string, number, typeof ApiError]>([
    ["NOT_FOUND", 404, ServiceNotFoundError],
    ["PARAM_NOT_FOUND", 400, ValidationError],
    ["VALIDATION_ERROR", 422, ValidationError],
    ["RATE_LIMITED", 429, RateLimitError],
    ["RATE_LIMIT_EXCEEDED", 429, RateLimitError],
    ["NOT_FOUND", 500, ServiceNotFoundError],
    ["VALIDATION_ERROR", 502, ValidationError],
    ["RATE_LIMITED", 503, RateLimitError],
    ["DATABASE_ERROR", 500, ServerError],
    ["SERVICE_UNAVAILABLE", 503, ServerError],
    ["VOICES_FETCH_FAILED", 502, ServerError],
    ["INVALID_IP", 400, ApiError],
    ["FORBIDDEN", 403, ApiError],
    ["SOMETHING", 499, ApiError],
    ["constructor", 400, ApiError],
    ["__proto__", 500, ServerError],
  ])("maps %s with status %i", async (code, status, ErrorClass) => {
    const body = JSON.stringify({
      success: false,
      error: { code, message: "m", details: ["x"] },
    });

    const failure = (await respond(body, status).catch((error: unknown) => error)) as ApiError;

    expect(failure.constructor).toBe(ErrorClass);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toBeInstanceOf(Error);
    expect(failure.name).toBe(ErrorClass.name);
    expect(failure.errorCode).toBe(code);
    expect(failure.status).toBe(status);
    expect(failure.details).toEqual(["x"]);
    expect(failure.message).toBe("m");
  });

  it("depends on the code, not the message", async () => {
    const body = '{"success":false,"error":{"code":"VALIDATION_ERROR","message":"Route not found"}}';

    await expect(respond(body, 400)).rejects.toBeInstanceOf(ValidationError);
  });

  it("treats success: false with status 200 as an error", async () => {
    const body = '{"success":false,"error":{"code":"VALIDATION_ERROR","message":"m"}}';

    await expect(respond(body)).rejects.toBeInstanceOf(ValidationError);
  });

  it("keeps object details", async () => {
    const body =
      '{"success":false,"error":{"code":"VALIDATION_ERROR","message":"m","details":{"query.age":"too big"}}}';

    await expect(respond(body, 422)).rejects.toMatchObject({
      details: { "query.age": "too big" },
    });
  });

  it("has null details when the server sends none", async () => {
    const body = '{"success":false,"error":{"code":"NOT_FOUND","message":"m"}}';

    await expect(respond(body, 404)).rejects.toMatchObject({ details: null });
  });

  it.each<[string, number, typeof ApiError]>([
    ['{"success":false}', 400, ApiError],
    ['{"success":false,"error":"boom"}', 400, ApiError],
    ['{"success":false,"error":[]}', 400, ApiError],
    ['{"success":false,"error":{"message":"m"}}', 400, ApiError],
    ['{"success":false,"error":{"code":5}}', 400, ApiError],
    ['{"success":false,"error":{"code":["NOT_FOUND"]}}', 404, ApiError],
    ['{"success":false,"error":null}', 499, ApiError],
    ['{"success":false}', 500, ServerError],
    ['{"success":false,"error":{"message":"m"}}', 503, ServerError],
  ])("handles %s with status %i", async (body, status, ErrorClass) => {
    const failure = (await respond(body, status).catch((error: unknown) => error)) as ApiError;

    expect(failure.constructor).toBe(ErrorClass);
    expect(failure.errorCode).toBe("");
    expect(failure.status).toBe(status);
    expect(failure.message).not.toBe("");
  });

  it("builds a default message when message is not a string", async () => {
    const body = '{"success":false,"error":{"code":"X","message":5}}';

    await expect(respond(body, 418)).rejects.toMatchObject({
      message: "API error (HTTP 418).",
    });
  });

  it("has safe constructor defaults", () => {
    const error = new ApiError("m");

    expect(error.errorCode).toBe("");
    expect(error.status).toBe(0);
    expect(error.details).toBeNull();
  });
});

describe("transport", () => {
  it.each<[string, Body, number]>([
    ["HTML", "<html>502 Bad Gateway</html>", 502],
    ["an empty body", "", 200],
    ["truncated JSON", '{"success":tr', 200],
    ["no success field", '{"data":1}', 200],
    ["an empty object", "{}", 200],
    ["an array", "[1,2]", 200],
    ["a string", '"ok"', 200],
    ["null", "null", 200],
    ["a number", "5", 200],
    ["null success", '{"success":null}', 200],
    ["string success", '{"success":"true","data":1}', 200],
    ["numeric success", '{"success":1,"data":1}', 200],
    ["NaN", '{"success":true,"data":NaN}', 200],
    ["invalid UTF-8 in a string", new TextEncoder().encode('{"success":true,"data":"퟿"}').fill(0xff, 24, 27), 200],
    ["binary", new Uint8Array([0xff, 0xfe, 0xfa]), 200],
    ["runaway nesting", "[".repeat(200000), 200],
  ])("raises TransportError for %s", async (_name, body, status) => {
    const failure = await respond(body, status).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransportError);
    expect(failure).not.toBeInstanceOf(ApiError);
    expect((failure as Error).name).toBe("TransportError");
  });

  it("keeps the JSON error in cause", async () => {
    const failure = (await respond("<html>").catch((error: unknown) => error)) as TransportError;

    expect(failure.cause).toBeInstanceOf(SyntaxError);
  });

  it("keeps a network failure in cause", async () => {
    const cause = new TypeError("fetch failed");
    const api = new NestApi({ fetch: () => Promise.reject(cause) });

    const failure = (await api.bmi().catch((error: unknown) => error)) as TransportError;

    expect(failure).toBeInstanceOf(TransportError);
    expect(failure.cause).toBe(cause);
    expect(failure.message).toContain("fetch failed");
  });

  it("turns a fetch that throws synchronously into a TransportError", async () => {
    const cause = new Error("boom");
    const api = new NestApi({
      fetch: () => {
        throw cause;
      },
    });

    await expect(api.bmi()).rejects.toMatchObject({ name: "TransportError", cause });
  });

  it("keeps a body read failure in cause", async () => {
    const cause = new Error("connection reset");
    const response = new Response(OK);
    vi.spyOn(response, "arrayBuffer").mockRejectedValue(cause);

    const api = new NestApi({ fetch: async () => response });

    await expect(api.bmi()).rejects.toMatchObject({ name: "TransportError", cause });
  });

  it("keeps a thrown non-Error in cause", async () => {
    const api = new NestApi({ fetch: () => Promise.reject("nope") });

    await expect(api.bmi()).rejects.toMatchObject({ name: "TransportError", cause: "nope" });
  });

  it("is separate from ApiError", () => {
    expect(new TransportError("m")).not.toBeInstanceOf(ApiError);
    expect(new ApiError("m")).not.toBeInstanceOf(TransportError);
  });
});

describe("concurrency", () => {
  it("keeps the order of results with Promise.all", async () => {
    const fetch = async (url: string | URL | Request) => {
      const age = Number(new URL(String(url)).searchParams.get("age"));

      await new Promise((resolve) => setTimeout(resolve, (5 - age) * 3));

      return new Response(JSON.stringify({ success: true, data: { age } }));
    };

    const api = new NestApi({ fetch: fetch as typeof globalThis.fetch });

    const results = await Promise.all([0, 1, 2, 3, 4].map((age) => api.bmi({ age })));

    expect(results.map((res) => res.get("age"))).toEqual([0, 1, 2, 3, 4]);
  });

  it("runs requests at the same time", async () => {
    let active = 0;
    let peak = 0;

    const fetch = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;

      return new Response(OK);
    };

    const api = new NestApi({ fetch });

    await Promise.all([api.a(), api.b(), api.version(2).c(), api.call("d")]);

    expect(peak).toBe(4);
  });
});

// These also run under `tsc --noEmit`, which is what checks the @ts-expect-error lines.
describe("types", () => {
  it("types dynamic services and public methods", () => {
    const api = new NestApi({ fetch: fake().fetch });

    expectTypeOf(api).toEqualTypeOf<NestApi>();
    expectTypeOf(api.anyService).toEqualTypeOf<ServiceMethod>();
    expectTypeOf(api.anyService({ a: 1 })).toEqualTypeOf<Promise<ApiResponse>>();
    expectTypeOf(api.any_other()).toEqualTypeOf<Promise<ApiResponse>>();

    expectTypeOf(api.call("x")).toEqualTypeOf<Promise<ApiResponse>>();
    expectTypeOf(api.call("x", { a: 1 })).toEqualTypeOf<Promise<ApiResponse>>();
    expectTypeOf(api.request("POST", "x", { a: 1 })).toEqualTypeOf<Promise<ApiResponse>>();
    expectTypeOf(api.version(2)).toEqualTypeOf<NestApi>();
    expectTypeOf(api.version(2).anyService()).toEqualTypeOf<Promise<ApiResponse>>();

    expectTypeOf(api.then).toEqualTypeOf<undefined>();
    expectTypeOf(api.toJSON).toEqualTypeOf<undefined>();
  });

  it("does not make the client look like a promise", async () => {
    const api = new NestApi({ fetch: fake().fetch });
    const awaited = await api;
    const made = await (async () => api)();

    expectTypeOf(awaited).toEqualTypeOf<NestApi>();
    expectTypeOf(made).toEqualTypeOf<NestApi>();
  });

  it("types responses for direct access", async () => {
    const res = await new NestApi({ fetch: fake().fetch }).bmi();

    const bmi: number = res.data.bmi;
    const name: string = res.source["name"];

    expect(bmi).toBe(22.86);
    expect(name).toBe("NestAPI");
    expectTypeOf(res.has("bmi")).toEqualTypeOf<boolean>();
  });

  it("rejects wrong usage at compile time", () => {
    const api = new NestApi({ fetch: fake().fetch });

    const unused = () => {
      // @ts-expect-error a number is not a parameter object
      void api.bmi(30);
      // @ts-expect-error only one argument is allowed
      void api.bmi(30, 70);
      // @ts-expect-error only one argument is allowed
      void api.bmi({ a: 1 }, { b: 2 });
      // @ts-expect-error a string is not a parameter object
      void api.bmi("a");
      // @ts-expect-error null is not a parameter object
      void api.bmi(null);
      // @ts-expect-error the version is a number
      void api.version("1");
      // @ts-expect-error the version is a number
      void new NestApi({ version: "1" });
      // @ts-expect-error unknown option
      void new NestApi({ verify: false });
      // @ts-expect-error then is not a service
      void api.then();
      // @ts-expect-error toJSON is not a service
      void api.toJSON();
      // @ts-expect-error the response is read-only
      (undefined as unknown as ApiResponse).data = 1;
    };

    expect(unused).toBeTypeOf("function");
  });

  it("exports the option type", () => {
    const options: NestApiOptions = { version: 1, baseUrl: ROOT, timeout: 1, fetch: fake().fetch };

    expect(options.version).toBe(1);
  });
});
