import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export function getRootEnvPath() {
  return fileURLToPath(new URL("../../../../.env", import.meta.url));
}

// The URL-relative path only holds for the src layout (tsx). The bundled
// dist file sits one level deep, so also try cwd for `node dist/index.js`.
config({ path: [getRootEnvPath(), resolve(process.cwd(), ".env")] });
