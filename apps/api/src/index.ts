import "./lib/load-env";
import { createServer } from "node:http";
import { createApp } from "./app";
import { appEnv } from "./lib/env";
import { configureWebPush } from "./services/push-sender";
import { startReminderCron } from "./services/reminder-cron";

configureWebPush();
const server = createServer(createApp());
let reminderCron: ReturnType<typeof startReminderCron> | null = null;

server.listen(appEnv.PORT, () => {
  reminderCron = startReminderCron();
  console.log(`API listening on :${appEnv.PORT}`);
});

function shutdown() {
  reminderCron?.stop();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
