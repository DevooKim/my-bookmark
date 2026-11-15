import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { loopbackServerAddress, request } from "./support/loopback-request";

function listen(host: string, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_request, response) => {
      response.end(`owner:${host}`);
    });
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("loopback supertest helper", () => {
  it("binds the shared test server to 127.0.0.1 only", () => {
    const address = loopbackServerAddress();
    expect(address.address).toBe("127.0.0.1");
    expect(address.family).toBe("IPv4");
  });

  it("routes each request to the app it was created for, even interleaved", async () => {
    const respondWith =
      (body: string): http.RequestListener =>
      (_request, response) => {
        response.end(body);
      };
    const [first, second, third] = await Promise.all([
      request(respondWith("first")).get("/"),
      request(respondWith("second")).get("/"),
      request(respondWith("third")).get("/"),
    ]);
    expect([first.text, second.text, third.text]).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("keeps the routing header away from the app and preserves the request", async () => {
    let seen: http.IncomingHttpHeaders | undefined;
    const response = await request((incoming, outgoing) => {
      seen = incoming.headers;
      outgoing.statusCode = 201;
      outgoing.end(`${incoming.method} ${incoming.url}`);
    })
      .post("/echo?x=1")
      .set("X-Custom", "yes");
    expect(response.status).toBe(201);
    expect(response.text).toBe("POST /echo?x=1");
    expect(seen?.["x-custom"]).toBe("yes");
    expect(seen?.["x-loopback-test-app"]).toBeUndefined();
  });

  it("cannot take a port that another local app holds on loopback", async () => {
    // 다른 앱(Notion 유형)이 loopback에서 잡고 있는 포트는 127.0.0.1 명시 bind가
    // EADDRINUSE로 거절하므로, 커널이 임시 포트로 그 포트를 배정하지 않는다.
    const foreign = await listen("127.0.0.1", 0);
    const { port } = foreign.address() as AddressInfo;
    try {
      await expect(listen("127.0.0.1", port)).rejects.toMatchObject({
        code: "EADDRINUSE",
      });
    } finally {
      await close(foreign);
    }
  });
});
