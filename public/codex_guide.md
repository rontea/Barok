# Codex Coder & ReAct Engine Integration Guide

This guide describes the core architecture of the Codex-style coder interface and how it integrates with the ReAct Engine Explorer workspace, including memory-window management and task audits.

---

## 1. Codex Coder Interface Design
The Codex Coder interface mimics high-end developer IDE workspaces with an integrated chat, structured file diffs, and transparent reasoning loops.

### Visual Styling Highlights
- **Cosmic Slate Theme:** Dark charcoal canvas (`#0b0f19`) accented by deep steel grays, glowing emerald statuses, and subtle violet tab highlights.
- **Dynamic File Diffs:** Modified lines are rendered with exact syntax diffing styles, utilizing green backdrops for additions and red/rose backdrops for deletions.
- **Memory Context Ring:** A visual representation of active token windows (e.g., 8K, 32K, 128K, 1M) indicating memory saturation levels dynamically.

---

## 2. Memory Context Window Management
The context window represents the active memory buffer sent to the underlying Gemini models (`gemini-3.5-flash` or `gemini-3.1-pro-preview`).

```
┌───────────────────────────────────────────────────────────┐
│                   Active Context Window                   │
│                                                           │
│  [ System Instruction ]  --> (Static system directive)     │
│  [ Active Thread History ] --> (Last N exchange pairs)    │
│  [ File Attachments ]     --> (Injected code block)        │
│                                                           │
│  ◀─────────── Context Slider Buffer: 8K - 1M ───────────▶ │
└───────────────────────────────────────────────────────────┘
```

### Context Buffer Mechanics
1. **Dynamic Pruning:** If the active thread history token size exceeds the selected slider threshold (e.g., 32K tokens), older thread nodes are serialized to local long-term summaries or truncated from active context.
2. **Context Compression:** When the context load rises above 80%, the system utilizes an internal "summarization pass" before dispatching to the Gemini pool.

---

## 3. Gemini API Rotation & Load Balancing Pool
The load balancing mechanism manages multiple Gemini keys dynamically to maximize rate limit quotas.

| Strategy | Description | Selection Criteria |
| :--- | :--- | :--- |
| **Round Robin** | Iterates sequentially through each active key. | Default, balanced traffic distribution. |
| **Random** | Selects a random active key for each request. | Prevents repetitive request patterns. |
| **Priority / Latency**| Prefers keys with lowest average round-trip latency. | Recommended for real-time streaming tasks. |

---

## 4. Separation of Tests & Audits
To maintain architectural separation:
- **Tests Explorer:** Hosts unit-style testing triggers (such as fallback routing, sub-agent spawning, local directory write checks) with active step-by-step progress checklists and terminal logs.
- **Run Audits:** Stores persistent historical logs of autonomous agent attempts, displaying raw console operations, exact model targets, pollen costs, and total token parameters.

---

## 5. Directory Structure Navigation
The interactive **Structure** viewer scans local workspace trees, dynamically serving files through `/api/structure` to support full-stack navigation, real-time code preview, and rapid editing.
