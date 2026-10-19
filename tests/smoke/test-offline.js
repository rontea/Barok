import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function runLocalTest() {
  const priorDatabasePath = process.env.REACT_ENGINE_DB_PATH;
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), "barok-offline-engine-"),
  );
  process.env.REACT_ENGINE_DB_PATH = path.join(
    temporaryDirectory,
    "react-engine.sqlite",
  );
  let testStore;

  try {
    const { parseProjectFixture } =
      await import("../../src/evals/fixtureSchema.ts");
    const { runProductionEngineFixture } =
      await import("../../src/evals/productionEngineAdapter.ts");
    const { getSQLiteAppStore } =
      await import("../../src/persistence/sqliteStore.ts");
    testStore = getSQLiteAppStore();

    console.log("=== Starting Offline Engine Verification ===");

    const testTask = `Create a temporary folder named "react_temp_test" if it does not exist, and write a test file named "test_offline.txt" inside it with the text "Engine offline test working". Verify using bash that the file exists and its contents are correct, and output the content perfectly.`;

    console.log(`Task: ${testTask}`);

    const project = parseProjectFixture({
      schemaVersion: 1,
      id: "offline-smoke-project",
      title: "Offline smoke project",
      description:
        "Disposable project used by the deterministic engine smoke test.",
      projectType: "no_git",
      packageManager: "npm",
      gitMode: "none",
      files: {
        "package.json": JSON.stringify({
          name: "offline-smoke-project",
          scripts: {
            test: "node -p require('fs').readFileSync(process.argv[1],'utf8') -- react_temp_test/test_offline.txt",
          },
        }),
        "react_temp_test/.keep": "",
      },
      expectedDiscovery: { languages: [], frameworks: [], commands: [] },
    });

    const result = await runProductionEngineFixture(project, {
      task: testTask,
      affectedFiles: ["react_temp_test/test_offline.txt"],
      actions: [
        {
          action: "Write",
          action_input: {
            file_path: "react_temp_test/test_offline.txt",
            content: "Engine offline test working",
            allowCreate: true,
          },
        },
        {
          action: "Read",
          action_input: { file_path: "react_temp_test/test_offline.txt" },
        },
        {
          action: "Bash",
          action_input: {
            command: "npm test",
          },
        },
      ],
      finalAnswer:
        "Created react_temp_test/test_offline.txt and verified its contents with the offline engine fixture.",
    });

    let verification = {};
    try {
      verification = JSON.parse(result.steps.at(-1)?.observation || "{}");
    } catch {
      verification = {};
    }
    if (
      result.success &&
      verification.success === true &&
      verification.status === "success"
    ) {
      console.log("\n=== Test Successful ===");
      console.log(`Final Answer: ${result.finalAnswer}`);
    } else {
      console.error("\n=== Test Failed ===");
      console.error(
        `Error: ${result.error || "The deterministic engine smoke scenario did not pass."}`,
      );
      console.error(
        `Steps: ${result.steps.map((step) => `${step.action}=${step.observation || "pending"}`).join(" | ")}`,
      );
      process.exitCode = 1;
    }
  } finally {
    try {
      testStore?.close();
    } finally {
      if (priorDatabasePath === undefined)
        delete process.env.REACT_ENGINE_DB_PATH;
      else process.env.REACT_ENGINE_DB_PATH = priorDatabasePath;
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }
}

runLocalTest().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
