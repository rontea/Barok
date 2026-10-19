import { mkdir, writeFile } from "fs/promises";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "path";
import { spawn } from "child_process";
import { createServer as createTcpServer } from "node:net";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "barok-target-folder-"));
const workspace = resolve(temporaryDirectory, "workspace");
const nestedDir = join(workspace, "nested");
const fixtureContent = "target folder check ok";

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForServer(url, timeoutMs = 15000) {
  const started = Date.now();
  let lastError;

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(300);
  }

  throw lastError || new Error("Server did not start in time");
}

async function findAvailablePort() {
  const probe = createTcpServer();
  await new Promise((resolvePort, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolvePort);
  });
  const address = probe.address();
  if (!address || typeof address === "string")
    throw new Error("Could not allocate a local test port");
  await new Promise((resolveClose) => probe.close(resolveClose));
  return address.port;
}

async function main() {
  console.log("=== Starting Target Folder Verification ===");

  const port = await findAvailablePort();
  await mkdir(nestedDir, { recursive: true });
  await writeFile(join(nestedDir, "target-check.txt"), fixtureContent, "utf8");

  const server = spawn(
    process.execPath,
    ["--import", "tsx", "server.ts", "--port", String(port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REACT_TARGET_FOLDER: workspace,
        REACT_ENGINE_DB_PATH: join(temporaryDirectory, "react-engine.sqlite"),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let serverOutput = "";
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  try {
    const baseUrl = `http://localhost:${port}`;
    await waitForServer(`${baseUrl}/api/workspace/default`);

    const defaultRes = await fetch(`${baseUrl}/api/workspace/default`);
    if (!defaultRes.ok) {
      throw new Error(
        `Default target request failed with HTTP ${defaultRes.status}`,
      );
    }

    const defaultWorkspace = await defaultRes.json();
    if (defaultWorkspace.workspace !== workspace) {
      throw new Error(
        `Default target folder mismatch: expected ${workspace}, got ${defaultWorkspace.workspace}`,
      );
    }

    const treeRes = await fetch(`${baseUrl}/api/workspace/tree`);
    if (!treeRes.ok) {
      throw new Error(`Tree request failed with HTTP ${treeRes.status}`);
    }

    const treeResponse = await treeRes.json();
    const tree = Array.isArray(treeResponse) ? treeResponse : treeResponse.tree;
    if (!Array.isArray(tree)) {
      throw new Error(
        `Tree response did not contain a tree array: ${JSON.stringify(treeResponse)}`,
      );
    }
    const nested = tree.find(
      (node) => node.name === "nested" && node.type === "directory",
    );
    if (!nested || nested.path !== "nested") {
      throw new Error(
        `Nested directory path was not workspace-relative: ${JSON.stringify(nested)}`,
      );
    }

    const targetFile = nested.children?.find(
      (node) => node.name === "target-check.txt" && node.type === "file",
    );
    if (!targetFile?.path) {
      throw new Error(
        `Target file was not returned in workspace tree: ${JSON.stringify(nested)}`,
      );
    }

    if (tree.some((node) => node.name === "package.json")) {
      throw new Error(
        "Workspace tree returned the application codebase instead of the target folder",
      );
    }

    const fileRes = await fetch(
      `${baseUrl}/api/workspace/file?path=${encodeURIComponent(targetFile.path)}`,
    );
    if (!fileRes.ok) {
      throw new Error(`File request failed with HTTP ${fileRes.status}`);
    }

    const file = await fileRes.json();
    if (file.content.trim() !== fixtureContent) {
      throw new Error(
        `Unexpected file content: ${JSON.stringify(file.content)}`,
      );
    }

    console.log("Target folder tree and file read checks passed.");
  } catch (error) {
    console.error(serverOutput.trim());
    throw error;
  } finally {
    if (server) {
      server.kill();
      await new Promise((resolveExit) => {
        if (server.exitCode !== null || server.signalCode !== null)
          resolveExit();
        else server.once("exit", resolveExit);
      });
    }
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
