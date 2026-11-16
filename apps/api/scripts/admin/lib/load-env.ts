import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export function getRootEnvPath() {
  return fileURLToPath(new URL("../../../../../.env", import.meta.url));
}

// An explicit working-directory .env takes precedence over the repository root.
config({ path: [resolve(process.cwd(), ".env"), getRootEnvPath()] });
