# @barok/plugin-deepseek

This local DeepSeek Harness bundle registers two read-only tools backed by `@barok/core` and adds coding-workflow guidance to the Harness system prompt. It does not call a language model or need an API key. A model API key is needed only when you want Harness to make model requests in chat.

## Tools

| Tool | Purpose | Example input |
|---|---|---|
| `barok_classify_task` | Classifies a task using Barok Core task policy. | `{"task":"Fix the crash when saving a file"}` |
| `barok_normalize_file_paths` | Normalizes and deduplicates candidate paths. It does not read or change files. | `{"paths":["src\\index.ts","src/index.ts"]}` |

Ask the Harness agent to use one by name, for example: “Use `barok_classify_task` to classify this request: …”

## Coding workflow guidance

The plugin adds a system-prompt section that tells Harness to act on implementation requests using its workspace file tools in the same turn. It names `read` for inspecting existing files, `write` with `file_path` and `content` for creating files, and `edit` with `file_path`, `old_string`, and `new_string` for focused changes. It asks the model to keep source out of assistant messages, report tool failures instead of falling back to chat code, and summarize only after successful tool results. Explanation, review, and sample-only requests remain chat-only.

This is guidance, not a file-writing capability or a guarantee that the model will call a tool. Harness must have its filesystem tools loaded, the current session must permit workspace writes, and Windows must allow the Harness process to modify the selected workspace. The plugin itself remains read-only. Start a new chat after rebuilding and restarting the profile so the updated system prompt is assembled for that session.

## Windows folder permission errors

For the Windows sandbox error `SetNamedSecurityInfoW failed (Win32 5): grantWrite(...)`, the plugin tells Harness to stop retrying the failed write and use Harness's bundled `diagnose-windows-sandbox-acl` skill when it is available. The skill inspects the failing path and its ancestors, asks for approval for its repair command, limits changes to the approved `-AllowRoot`, and writes DACL recovery files before changing folder permissions. Its repair can add Full Control for the signed-in user where DSH lacks the rights it needs and remove explicit allow entries belonging to other AppContainer packages within scope. Barok does not implement a second ACL editor or elevate the Harness process.

The workflow uses the active session workspace as `-AllowRoot`, the exact reported failure path as `-Path`, and a persistent recovery directory under `$env:LOCALAPPDATA\Barok\DeepSeekHarness\acl-recovery`. It must stop if approval is refused, the skill refuses the repair, or the required change falls outside the active workspace. A verified repair is followed by one retry of the original operation. This cannot override Windows ownership or elevation requirements: if the signed-in Harness process lacks the rights needed by the repair, the skill reports that failure and the plugin does not bypass it.

## Requirements

- DeepSeek Harness checkout (tested version is `0.2.0-rc.2`, including `@deepseek-ai/dsh-system-prompt`).
- Barok checkout with the Core and plugin packages built.
- Node.js and pnpm as required by the Harness checkout.

The tested Harness dependency versions are Cordis `4.0.4` and `@deepseek-ai/dsh-tools` `0.2.0-rc.2`. This records the tested development line, not support for every version in the declared peer ranges.

## Install into a local Harness profile

The package is currently private and depends on the local `@barok/core` workspace version `0.0.1-experimental`. Install it from your Barok checkout path; it is not yet available from public npm.

The commands below create a separate Harness home and a Web profile named `barok-web-dev`. Replace `<path-to-deepseek-harness>` and `<path-to-barok>` with your local paths. Set `DSH_HOME` in the same terminal where you run `pnpm dsh`.

### Git Bash on Windows / Linux

```bash
cd <path-to-deepseek-harness>
export DSH_HOME="$(cygpath -w "$LOCALAPPDATA/Barok/DeepSeekHarness")"

# Run once to create the profile from Harness's Web template.
pnpm dsh --profile barok-web-dev --from-default-profile web --dump-config

# Install the local Barok bundle into that profile.
pnpm dsh plugin --profile barok-web-dev add '<path-to-barok>/packages/plugin-deepseek'

# Start the profile.
pnpm dsh --profile barok-web-dev
```

Skip the profile-creation command if `barok-web-dev` already exists. Re-run the install command after removing the plugin or when setting up another profile. After changing the plugin or Core code, rebuild them from your Barok repository, then restart the Harness profile:

```bash
cd <path-to-barok>
npm run build:core
npm run build:plugin-deepseek
```

### PowerShell on Windows

```powershell
Set-Location <path-to-deepseek-harness>
$env:DSH_HOME = Join-Path $env:LOCALAPPDATA 'Barok\DeepSeekHarness'

# Run once to create the profile from Harness's Web template.
pnpm dsh --profile barok-web-dev --from-default-profile web --dump-config

# Install the local Barok bundle into that profile.
pnpm dsh plugin --profile barok-web-dev add '<path-to-barok>\packages\plugin-deepseek'

# Start the profile.
pnpm dsh --profile barok-web-dev
```

The profile manager adds the bundle to the profile's `dsh.profile.bundles` list. Starting the profile after installation loads the tools into Harness's tool registry. The compatibility record for the local install and tool calls is in [`docs/compatibility/HARNESS_COMPATIBILITY.md`](../../docs/compatibility/HARNESS_COMPATIBILITY.md).

## Configure the DeepSeek API key

The plugin itself does not use the API. To let the Harness agent send requests to DeepSeek:

1. Start `barok-web-dev` using one of the command blocks above.
2. Open **Settings → Models** in the Harness Web UI.
3. Enter a key from the [DeepSeek Platform](https://platform.deepseek.com/) in the **DeepSeek** card, then save it.

Harness stores the key under `$DSH_HOME/.credentials.yaml`; it does not put the secret into the profile's plugin configuration. The key field is write-only. Do not put API keys in this repository or commit them.

For a one-run override, set `DEEPSEEK_API_KEY` in the same shell before launching Harness. This takes precedence over the saved key for that run.

Git Bash:

```bash
export DEEPSEEK_API_KEY='sk-your-key'
pnpm dsh --profile barok-web-dev
```

PowerShell:

```powershell
$env:DEEPSEEK_API_KEY = 'sk-your-key'
pnpm dsh --profile barok-web-dev
```

Replace the example value with your key. For another provider or a custom-compatible endpoint, use **Settings → Models → Add model provider**; that is Harness model configuration and is separate from this Barok plugin.

## Build the plugin

From the Barok repository root:

```bash
npm run build:core
npm run build:plugin-deepseek
```

The bundle entry is declared in `cordis.patch.yml`. It registers its two read-only tools through Harness's `tools` service and contributes coding and Windows ACL recovery guidance through `systemPrompt`. The folder repair itself is handled by Harness's bundled ACL diagnosis skill after approval; this plugin does not directly access the filesystem or change permissions. It does not start another agent loop or access Harness session databases, credentials, settings, or durable storage.

## Release status

Nothing has been published. Before release, `@barok/core` needs a released semver version; then update this package's Core dependency, inspect the package contents, and complete the published-profile install checks listed in [`barok_move_todo/todo_1.md`](../../barok_move_todo/todo_1.md).
