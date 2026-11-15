import http from "node:http";
import type { AddressInfo } from "node:net";
import supertest from "supertest";

// supertest는 요청마다 서버를 `listen(0)`으로 와일드카드(`::`)에 띄우고 `127.0.0.1:<port>`로
// 접속한다. 같은 머신의 다른 앱(Notion, Paseo 등)이 loopback 전용으로 잡고 있는 포트는
// 와일드카드 bind가 성공하지만 `127.0.0.1` 접속은 더 구체적인 쪽, 즉 그 앱으로 간다.
// macOS는 임시 포트를 순차 배정하므로 테스트 한 번이 수백 개 포트를 훑는 동안 그런 포트를
// 밟으면 요청이 엉뚱한 프로세스(404·401·socket hang up)로 가서 테스트가 간헐적으로 깨진다.
//
// 이 헬퍼는 테스트 파일(워커)마다 `127.0.0.1`에 명시 bind한 서버를 하나만 띄운다.
// loopback 전용 리스너가 있는 포트는 EADDRINUSE라 배정되지 않고, 와일드카드 리스너가 있는
// 포트에서는 우리 쪽이 더 구체적이라 우선한다. `listen(host)`는 비동기라 supertest가
// 요구하는 동기 `listen(0)`로 바꿀 수 없어서, 서버를 한 번만 띄워 두고 요청마다 헤더로
// 대상 app을 골라 넘긴다. 서버 수명은 워커와 같다(unref).

const APP_HEADER = "x-loopback-test-app";

const apps = new Map<string, http.RequestListener>();
let nextAppId = 0;

const server = http.createServer((request, response) => {
  const id = request.headers[APP_HEADER];
  delete request.headers[APP_HEADER];
  const listener = typeof id === "string" ? apps.get(id) : undefined;
  if (!listener) {
    response.statusCode = 500;
    response.end("Unknown test app");
    return;
  }
  listener(request, response);
});

await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
server.unref();

export function loopbackServerAddress(): AddressInfo {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Loopback test server is not listening");
  }
  return address;
}

// `request(app)`은 supertest.agent(app)와 같은 에이전트를 돌려준다.
// 요청마다 연결을 닫아(Connection: close) 요청당 새 서버를 쓰던 기존 동작과 맞춘다.
export function request(listener: http.RequestListener) {
  nextAppId += 1;
  const id = String(nextAppId);
  apps.set(id, listener);
  return supertest.agent(server).set(APP_HEADER, id).set("Connection", "close");
}
