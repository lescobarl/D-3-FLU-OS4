// Activa los hooks versionados (.githooks) en el clon actual.
// Se invoca desde el script `prepare` de npm (tras `npm install` / `npm ci`).
// Nunca falla: si no hay repo git o git no esta, el install sigue.
import { execFileSync } from "node:child_process";

try {
    execFileSync("git", ["config", "core.hooksPath", ".githooks"], { stdio: "ignore" });
} catch {
    // Sin git o sin repo: los hooks no aplican (p.ej. empaquetado).
}
