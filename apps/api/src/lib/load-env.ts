import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export function getRootEnvPath() {
  return fileURLToPath(new URL("../../../../.env", import.meta.url));
}

// The URL-relative path only holds for the src layout (tsx); from the
// bundled dist it points outside the repo. cwd comes first so an explicit
// working-directory .env always wins over that stray location.
config({ path: [resolve(process.cwd(), ".env"), getRootEnvPath()] });
