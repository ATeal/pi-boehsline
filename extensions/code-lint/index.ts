import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const LINT_HOOK = fileURLToPath(
  new URL("../../plugins/code-lint/hooks/lint.sh", import.meta.url),
);
const MAX_HOOK_OUTPUT_BYTES = 50 * 1024;

interface HookResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}

function runLintHook(
  filePath: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "/bin/bash",
      [LINT_HOOK],
      {
        cwd,
        env: process.env,
        maxBuffer: MAX_HOOK_OUTPUT_BYTES,
        signal,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? error.code : error ? null : 0;

        resolve({
          code,
          stdout,
          stderr,
          error: error?.message,
        });
      },
    );

    child.stdin?.end(
      JSON.stringify({
        tool_input: { file_path: filePath },
      }),
    );
  });
}

function hookFeedback(result: HookResult): string | undefined {
  if (result.code === 0) return undefined;

  const output = [result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join("\n");

  if (output) {
    return `Post-write lint reported issues:\n${output}`;
  }

  return `Post-write lint hook failed${
    result.code === null ? "" : ` with exit code ${result.code}`
  }: ${result.error ?? "no output"}`;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    if (event.isError) return;

    const filePath = event.input.path;
    if (typeof filePath !== "string" || filePath.length === 0) return;

    const result = await runLintHook(filePath, ctx.cwd, ctx.signal);
    const feedback = hookFeedback(result);
    if (!feedback) return;

    return {
      content: [...event.content, { type: "text" as const, text: feedback }],
    };
  });
}
