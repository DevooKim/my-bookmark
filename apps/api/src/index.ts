import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app";
import { appEnv } from "./lib/env";

const server = createServer(createApp());

server.listen(appEnv.PORT, () => {
  console.log(`API listening on :${appEnv.PORT}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});
