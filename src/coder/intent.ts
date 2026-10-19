import type { LLMCompletionOptions, LLMProvider } from '../di/types.js';
import {
  analyzeCoderTask,
  clarificationMessageForAnalysis,
  isCoderActionRequest,
  isCoderInformationRequest,
  normalizeCoderRequest,
  type ApprovalPolicy,
  type CoderTaskAnalysis,
} from './taskAnalysis.js';
import type { ProjectFileMap } from './projectFileMap.js';
import { getGeminiSameProviderFallbackModelIds } from '../config/geminiModels.js';
import { isNvidiaModel } from '../config/nvidiaModels.js';
import { isNvidiaTargetModelValue } from '../config/nvidiaTargets.js';
import { isOpenRouterFreeModel } from '../config/openRouterTargets.js';
import { normalizeCoderModelSelection } from '../config/providerSelection.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';

export type CoderMode = 'chat' | 'agent' | 'auto';
export type CoderRespondMode = 'chat' | 'execute' | 'clarify';

function usesNvidiaRuntimeModel(model: string): boolean {
  return isNvidiaModel(model) || isNvidiaTargetModelValue(model);
}

function usesFreeTierResilience(model: string): boolean {
  return usesNvidiaRuntimeModel(model) || isOpenRouterFreeModel(model);
}

export interface CoderImagePayload {
  url: string;
  name?: string;
  size?: number;
  mimeType?: string;
}

export interface CoderRespondThreadMessage {
  role?: string;
  content?: string;
  status?: string;
  images?: CoderImagePayload[];
}

export interface CoderRespondRequest {
  message: string;
  images?: CoderImagePayload[];
  thread?: CoderRespondThreadMessage[];
  workspace?: string;
  model?: string;
  geminiProfileId?: string;
  mode?: CoderMode;
  projectFileMap?: ProjectFileMap;
  approvalPolicy?: ApprovalPolicy;
}

export type CoderRespondResponse =
  | {
      mode: 'chat';
      reply: string;
      reasoningSummary?: string;
      reason?: string;
      confidence?: number;
      analysis?: CoderTaskAnalysis;
    }
  | {
      mode: 'execute';
      executionTask: string;
      reason?: string;
      confidence?: number;
      analysis?: CoderTaskAnalysis;
    }
  | {
      mode: 'clarify';
      reply: string;
      reasoningSummary?: string;
      reason?: string;
      confidence?: number;
      analysis?: CoderTaskAnalysis;
    };

const EXECUTE_PATTERNS = [
  /\b(inspect|analy[sz]e|investigate|review|audit|check|scan|look\s+(?:at|into)|explore)\b.*\b(workspace|repo|repository|project|codebase|files?|folders?|directory|src|ui|server|database)\b/i,
  /\b(fix|repair|implement|add|create|build|generate|update|modify|change|refactor|remove|delete|move|rename|write|edit)\b/i,
  /\b(run|execute|start|launch)\b.*\b(test|tests|build|lint|typecheck|server|dev|npm|pnpm|yarn|command|script)\b/i,
  /\b(npm|pnpm|yarn|node|tsx|tsc|jest|vitest|eslint|playwright)\b/i,
  /\b(continue|resume)\b.*\b(run|task|work|execution|previous)\b/i,
  /\b(open|read|show)\b.*\b[A-Za-z0-9_.@/-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml)\b/i,
  /\b[A-Za-z0-9_.@/-]+\.(?:tsx|ts|jsx|js|json|md|css|html|cjs|mjs|yml|yaml)\b.*\b(fix|update|inspect|review|edit|change|read)\b/i,
];

const CHAT_PATTERNS = [
  /^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening))[\s!.?]*$/i,
  /\b(thanks|thank you|appreciate it)\b/i,
  /\bwhat (are|r) you doing\b/i,
  /\bwho are you\b/i,
  /\bhow (are|r) you\b/i,
  /\b(just an inquiry|quick question|question only|general question)\b/i,
  /\b(can you help|help me|i need help)\b/i,
];

const AMBIGUOUS_PROJECT_PATTERNS = [
  /\b(this|the)\s+(project|repo|repository|workspace|codebase|app|system)\b/i,
  /\bmy\s+(project|repo|repository|workspace|codebase|app|system)\b/i,
];

export function classifyCoderIntent(message: string): { mode: CoderRespondMode; reason: string; executionTask?: string; confidence: number } {
  const cleanedForIntent = message
    .replace(/!\[(.*?)\]\(data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+\)/g, '')
    .replace(/data:image\/[a-zA-Z0-9+.-]+;base64,[A-Za-z0-9+/=]+/g, '')
    .trim();
  const trimmed = cleanedForIntent || message.trim();
  const interpreted = normalizeCoderRequest(trimmed);
  const classificationMessage = interpreted.normalized;

  if (!trimmed) {
    return { mode: 'clarify', reason: 'Empty message; ask for a concrete request.', confidence: 1 };
  }

  if (interpreted.isInformationRequest || isCoderInformationRequest(classificationMessage)) {
    return {
      mode: 'chat',
      reason: 'The message asks for information, so answer the underlying question without workspace execution.',
      confidence: 0.86,
    };
  }

  if (isCoderActionRequest(trimmed)) {
    return {
      mode: 'execute',
      executionTask: interpreted.frame === 'direct' ? trimmed : classificationMessage,
      reason: 'The message contains a concrete action or implementation directive.',
      confidence: 0.82,
    };
  }

  if (EXECUTE_PATTERNS.some((pattern) => pattern.test(classificationMessage))) {
    return {
      mode: 'execute',
      executionTask: interpreted.frame === 'direct' ? trimmed : classificationMessage,
      reason: 'The message clearly asks for workspace actions or tool-backed execution.',
      confidence: 0.86,
    };
  }

  if (CHAT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return { mode: 'chat', reason: 'The message is conversational or exploratory.', confidence: 0.78 };
  }

  if (AMBIGUOUS_PROJECT_PATTERNS.some((pattern) => pattern.test(classificationMessage))) {
    return {
      mode: 'chat',
      reason: 'The message references the project but does not clearly authorize workspace inspection.',
      confidence: 0.58,
    };
  }

  if (trimmed.length < 28 || /\?$/.test(trimmed)) {
    return { mode: 'chat', reason: 'The message is short or question-like and should stay conversational.', confidence: 0.62 };
  }

  return {
    mode: 'chat',
    reason: 'No concrete workspace action was detected; use the chat model to interpret the request instead of returning a canned clarification.',
    confidence: 0.5,
  };
}

export function buildCoderChatReply(request: CoderRespondRequest, reason: string): string {
  const message = request.message.trim();
  const lower = message.toLowerCase();
  const interpreted = normalizeCoderRequest(message);
  const recentAssistant = [...(request.thread || [])]
    .reverse()
    .find((item) => item.role === 'assistant' && item.content?.trim());

  if (/^hi|^hello|^hey|^yo|good\s+(morning|afternoon|evening)/i.test(message)) {
    return "Hey. I'm here and in chat mode right now, so I won't inspect files or run tools unless you ask me to. Tell me what you're curious about, or say something like \"inspect the workspace\" if you want me to start working.";
  }

  if (/\bwhat (are|r) you doing\b/i.test(message)) {
    return "Right now I'm waiting in Coder Chat. I can answer questions normally, help shape a plan, or run the ReAct workspace agent when you explicitly ask me to inspect, edit, build, test, or verify something.";
  }

  if (/\b(can you help|help me|i need help)\b/i.test(lower)) {
    return "Yes. What would you like help with? If it's a question, ask it here. If you want me to work in the workspace, tell me the action you want, such as inspecting files, fixing code, running tests, or generating a workplan.";
  }

  if (interpreted.isInformationRequest) {
    return `Understood — you are asking about “${interpreted.normalized}”. I’ll keep this read-only and answer the underlying question from the available conversation context. Ask me to inspect the workspace if the answer requires current files or run evidence.`;
  }

  if (AMBIGUOUS_PROJECT_PATTERNS.some((pattern) => pattern.test(message))) {
    return "I can help with that, but I should not inspect the workspace until you ask me to. Do you want a general answer, or should I run a workspace inspection?";
  }

  if (recentAssistant) {
    return `I can answer that conversationally first. I have the current thread context, but I have not inspected the workspace for this message. If you want me to take action, ask me to inspect, edit, run, or verify something.\n\nWhat specifically would you like to know?`;
  }

  return `I can help, but I need a little more direction before running workspace actions. What would you like to know or do?\n\nReason: ${reason}`;
}

const buildChatMessages = (request: CoderRespondRequest) => {
  const interpreted = normalizeCoderRequest(request.message);
  const recentThread = (request.thread || [])
    .filter((message) => message.role && (message.content?.trim() || message.images?.length))
    .slice(-8)
    .map((message) => {
      let content = String(message.content || '');
      if (message.images && message.images.length > 0) {
        const imageMarkdown = message.images
          .filter((image) => image?.url)
          .map((image, index) => `\n\n![${image.name || `Image ${index + 1}`}](${image.url})`)
          .join('');
        if (!content.includes('data:image/')) content = `${content}${imageMarkdown}`;
      }
      return {
        role: message.role === 'assistant' || message.role === 'user' ? message.role : 'system',
        content,
      };
    });

  let userContent = request.message.trim();
  if (request.images && request.images.length > 0) {
    const imageMarkdown = request.images
      .filter((image) => image?.url)
      .map((image, index) => `\n\n![${image.name || `Image ${index + 1}`}](${image.url})`)
      .join('');
    if (!userContent.includes('data:image/')) {
      userContent = `${userContent || 'Please inspect the attached image(s).'}${imageMarkdown}`;
    }
  }

  return [
    {
      role: 'system',
      content:
        'You are Coder Chat inside a coding agent UI. Interpret conversational wrappers such as "I would like to", "the user is asking about", "the user would like to", "please", and "can you" before answering. Answer the underlying question directly and avoid generic clarification when the request is understandable. Use the prior thread turns as context. Lead with the answer, then add a short rationale and a practical next step when useful. Keep the tone thoughtful, natural, and collaborative. If the user attaches images (such as UI designs, screenshots, error logs, architecture diagrams, or code images), inspect and analyze the visual details thoroughly. Do not claim to have inspected or changed workspace files unless the user asks for agent execution. If workspace action is needed, say so briefly. Keep information requests read-only. Never reveal private chain-of-thought; provide only concise, user-safe reasoning summaries.',
    },
    ...recentThread,
    {
      role: 'user',
      content: interpreted.frame === 'direct'
        ? userContent
        : `${userContent}\n\nHarness interpretation: ${interpreted.normalized}`,
    },
  ];
};

const normalizeCoderReasoningSummary = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const summary = value.replace(/\s+/g, ' ').trim().slice(0, 600);
  return summary || undefined;
};

const buildCoderChatReasoningSummary = (request: CoderRespondRequest): string => {
  const priorTurns = (request.thread || []).filter((message) =>
    (message.role === 'user' || message.role === 'assistant') && Boolean(message.content?.trim())
  ).length;
  const context = priorTurns > 0
    ? `I used the prior ${priorTurns} thread turn${priorTurns === 1 ? '' : 's'} as conversational context.`
    : 'I treated this as a new conversational turn.';
  return `${context} I kept the response read-only and did not inspect or change workspace files.`;
};

async function createCoderChatCompletion(
  request: CoderRespondRequest,
  llm: LLMProvider | undefined,
  model: string,
  options: LLMCompletionOptions,
  fallbackReason = 'Chat mode selected.',
): Promise<{ reply: string; reasoningSummary: string }> {
  if (!llm) {
    return {
      reply: buildCoderChatReply(request, fallbackReason),
      reasoningSummary: buildCoderChatReasoningSummary(request),
    };
  }

  let providerReasoningSummary: string | undefined;
  const reply = await llm.createChatCompletion(buildChatMessages(request), model, {
    ...options,
    // Ask providers for a concise, user-safe rationale while excluding raw
    // hidden reasoning from the transport response.
    reasoning: { effort: 'low', summary: 'concise', exclude: true },
    onCompletionResult: (result) => {
      providerReasoningSummary = normalizeCoderReasoningSummary(result.reasoningSummary);
    },
  });

  return {
    reply,
    reasoningSummary: providerReasoningSummary || buildCoderChatReasoningSummary(request),
  };
}

export async function createCoderRespondResponse(
  request: CoderRespondRequest,
  llm?: LLMProvider
): Promise<CoderRespondResponse> {
  const requestedMode = request.mode || 'auto';
  const trimmed = request.message.trim();
  const analysis = analyzeCoderTask({
    message: request.message,
    mode: requestedMode,
    workspace: request.workspace,
    thread: request.thread,
    projectFileMap: request.projectFileMap,
    approvalPolicy: request.approvalPolicy,
  });

  if (requestedMode === 'agent') {
    if (analysis.contract?.blocker) {
      return {
        mode: 'clarify',
        reply: clarificationMessageForAnalysis(analysis),
        reason: 'The request needs a concrete target and success condition before mutation.',
        confidence: analysis.confidence,
        analysis,
      };
    }
    return {
      mode: 'execute',
      executionTask: analysis.userRequest || trimmed,
      reason: 'Agent mode forces workspace execution.',
      confidence: 1,
      analysis,
    };
  }

  if (requestedMode === 'chat') {
    const rawModel = typeof request.model === 'string' ? request.model.trim() : '';
    const configuredModel = getConfiguredCoderModelSelection();
    const requestedModel = /^groq-target:key-\d+$/i.test(rawModel)
      ? rawModel
      : normalizeCoderModelSelection(rawModel || configuredModel);
    const nativeGemini = /^gemini-(?:target:|\d)/i.test(requestedModel);
    const freeTierResilience = usesFreeTierResilience(requestedModel);
    const completion = await createCoderChatCompletion(request, llm, requestedModel, {
      temperature: 0.5,
      maxTokens: 900,
      pinModel: !nativeGemini,
      sameProviderFallbackModels: nativeGemini
        ? getGeminiSameProviderFallbackModelIds(requestedModel)
        : [],
      freeTierResilience,
      geminiProfileId: request.geminiProfileId,
      allowCrossProviderFallback: false,
      fallbackApprovalGranted: false,
      approvedFallbackProviders: [],
    });
    return {
      mode: 'chat',
      reply: completion.reply,
      reasoningSummary: completion.reasoningSummary,
      reason: 'Chat mode prevents workspace execution.',
      confidence: 1,
      analysis,
    };
  }

  const intent = classifyCoderIntent(request.message);

  if (analysis.contract?.blocker) {
    return {
      mode: 'clarify',
      reply: clarificationMessageForAnalysis(analysis),
      reason: 'The request needs a concrete target and success condition before mutation.',
      confidence: analysis.confidence,
      analysis,
    };
  }

  if (analysis.taskKind === 'continuation' && analysis.expectedChangeIntent !== 'read_only') {
    return {
      mode: 'execute',
      executionTask: analysis.userRequest || trimmed,
      reason: 'The user confirmed continuation of the prior workspace task.',
      confidence: analysis.confidence,
      analysis,
    };
  }

  if (intent.mode === 'execute') {
    return {
      mode: 'execute',
      executionTask: intent.executionTask || request.message.trim(),
      reason: intent.reason,
      confidence: intent.confidence,
      analysis,
    };
  }

  if (intent.mode === 'clarify') {
    return {
      mode: 'clarify',
      reply: buildCoderChatReply(request, intent.reason),
      reason: intent.reason,
      confidence: intent.confidence,
      analysis,
    };
  }

  const requestedModel = normalizeCoderModelSelection(request.model || getConfiguredCoderModelSelection());
  const completion = await createCoderChatCompletion(request, llm, requestedModel, {
    temperature: 0.5,
    maxTokens: 900,
    pinModel: true,
    freeTierResilience: usesFreeTierResilience(requestedModel),
    allowCrossProviderFallback: false,
    fallbackApprovalGranted: false,
    approvedFallbackProviders: [],
    sameProviderFallbackModels: [],
  }, intent.reason);
  return {
    mode: 'chat',
    reply: completion.reply,
    reasoningSummary: completion.reasoningSummary,
    reason: intent.reason,
    confidence: intent.confidence,
    analysis,
  };
}
