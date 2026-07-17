import * as path from "path";

export function appLayout(userData: string) {
  return {
    root: userData,
    runs: path.join(userData, "runs"),
    mgba: path.join(userData, "mgba"),
    saves: (runId: string) => path.join(userData, "runs", runId, "saves"),
    runFile: (runId: string) => path.join(userData, "runs", runId, "run.json"),
  };
}
