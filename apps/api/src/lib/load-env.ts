import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export function getRootEnvPath() {
  return fileURLToPath(new URL("../../../../.env", import.meta.url));
}

config({ path: getRootEnvPath() });
