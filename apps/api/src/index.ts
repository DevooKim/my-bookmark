import "./lib/load-env";
import { createServer } from "node:http";
import { createApp } from "./app";
import { appEnv } from "./lib/env";
import { defaultOperationalMonitor } from "./services/operational-monitor";
import { configureWebPush } from "./services/push-sender";
import { defaultReadinessService } from "./services/readiness";
import { startReminderCron } from "./services/reminder-cron";

const pushConfigured = configureWebPush();
defaultReadinessService.setPushConfigured(pushConfigured);
const server = createServer(createApp());
let reminderCron: ReturnType<typeof startReminderCron> | null = null;

server.listen(appEnv.PORT, () => {
  reminderCron = startReminderCron({
    pushConfigured,
    monitor: defaultOperationalMonitor,
  });
  if (reminderCron) defaultReadinessService.markCronStarted();
  console.log(`API listening on :${appEnv.PORT}`);
});

function shutdown() {
  reminderCron?.stop();
  defaultReadinessService.markCronStopped();
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
