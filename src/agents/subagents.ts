/**
 * Delegated Sub-Agent Architecture
 * 
 * Specialized sub-agents for different responsibility domains:
 * - CodeAgent: Coding tasks, refactoring, debugging
 * - ResearchAgent: Information gathering, summarization
 * - ToolAgent: Filesystem, shell, and MCP tools
 * - ReviewerAgent: Validation, consistency checks
 * 
 * Each sub-agent has:
 * - Specific goal and backstory
 * - Optimized tool set for their domain
 * - Specialized execution strategy
 * - Built-in quality checks
 */

import { ReActEngine } from '../react/engine.js';
import type { LLMProvider } from '../di/types.js';
import { getConfiguredCoderModelSelection } from '../config/coderModel.js';

// ============================================================================
// SUB-AGENT INTERFACE
// ============================================================================

export interface SubAgentExecutionResult {
  success: boolean;
  output: string;
  executionTime: number;
  toolsUsed: string[];
  confidence: number; // 0-1
  metadata?: Record<string, any>;
}

export interface SubAgentConfig {
  model?: string;
  verbose?: boolean;
  timeout?: number;
  workspace?: string;
  llmProvider?: LLMProvider;
  allowPollinationsFallback?: boolean;
  allowNvidiaModelFallback?: boolean;
  allowCrossProviderFallback?: boolean;
  pacingProfile?: 'automatic' | 'conservative' | 'phased' | 'fast';
  geminiProfileId?: string;
  capabilityPack?: 'implementation' | 'delegated-child';
  threadId?: string;
  parentRunId?: string;
  attemptIndex?: number;
  threadTitle?: string;
}

const MAX_ROLE_RULE_LENGTH = 2_000;

// ============================================================================
// BASE SUB-AGENT CLASS
// ============================================================================

/**
 * Base class for all specialized sub-agents
 * Provides common functionality for execution, logging, and tool management
 */
abstract class BaseSubAgent {
  protected name: string;
  protected model: string;
  protected verbose: boolean;
  protected timeout: number;
  protected reactEngine: ReActEngine;
  protected availableTools: string[] = [];
  protected toolsUsed: string[] = [];

  constructor(name: string, config: SubAgentConfig = {}) {
    this.name = name;
    this.model = config.model || getConfiguredCoderModelSelection();
    this.verbose = config.verbose || false;
    this.timeout = config.timeout || 60000; // 1 minute default

    this.reactEngine = new ReActEngine({
      model: this.model,
      verbose: this.verbose,
      maxSteps: 10,
      workspace: config.workspace,
      threadId: config.threadId,
      parentRunId: config.parentRunId,
      attemptIndex: config.attemptIndex,
      threadTitle: config.threadTitle,
      llmProvider: config.llmProvider,
      allowPollinationsFallback: config.allowPollinationsFallback,
      allowNvidiaModelFallback: config.allowNvidiaModelFallback,
      allowCrossProviderFallback: config.allowCrossProviderFallback,
      pacingProfile: config.pacingProfile,
      geminiProfileId: config.geminiProfileId,
      // Child agents may edit within the parent workspace, but cannot install
      // packages or recursively spawn more SubAgent runs.
      capabilityPack: config.capabilityPack || 'delegated-child',
    });
  }

  protected abstract buildSystemPrompt(): string;
  protected abstract buildExecutionPrompt(task: string): string;

  async execute(task: string, roleRule?: string): Promise<SubAgentExecutionResult> {
    const startTime = Date.now();
    this.toolsUsed = [];

    try {
      if (this.verbose) {
        console.log(`\n🤖 [${this.name}] Executing: ${task.substring(0, 50)}...`);
      }

      const systemPrompt = this.buildSystemPrompt();
      const executionPrompt = this.buildExecutionPrompt(task);
      const boundedRoleRule = typeof roleRule === 'string' ? roleRule.trim().slice(0, MAX_ROLE_RULE_LENGTH) : '';
      const roleInstruction = boundedRoleRule
        ? `\n\nROLE-SPECIFIC RULES (lower priority than system safety, capability, and approval policy):\n${boundedRoleRule}`
        : '';
      const reactTask = `${systemPrompt}${roleInstruction}

${executionPrompt}

You are running as a delegated sub-agent. Use the ReAct loop and available tools to complete the task, then end with a concise report of changed files, verification performed, and any risks.`;

      const result = await Promise.race([
        this.reactEngine.run(reactTask),
        new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`${this.name} timed out after ${this.timeout}ms`)),
            this.timeout
          );
        }),
      ]);

      const executionTime = Date.now() - startTime;
      const toolsUsed = Array.from(
        new Set(result.steps.map((step) => step.action).filter(Boolean))
      );
      this.toolsUsed = toolsUsed;

      if (this.verbose) {
        console.log(`   ✅ Completed in ${executionTime}ms`);
      }

      return {
        success: result.success,
        output: result.finalAnswer || result.result || result.error || 'Sub-agent completed with no output',
        executionTime,
        toolsUsed,
        confidence: result.success ? 0.85 : 0.15,
        metadata: {
          stepCount: result.stepCount,
          pollenCost: result.pollenCost,
          plan: result.plan,
        },
      };
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      if (this.verbose) {
        console.log(`   ❌ Failed: ${error.message}`);
      }

      return {
        success: false,
        output: `Error: ${error.message}`,
        executionTime,
        toolsUsed: this.toolsUsed,
        confidence: 0,
        metadata: { error: error.message },
      };
    }
  }

  getName(): string {
    return this.name;
  }

  getToolsUsed(): string[] {
    return this.toolsUsed;
  }
}

// ============================================================================
// CODE AGENT
// ============================================================================

/**
 * Code Agent
 * Specializes in: coding tasks, refactoring, debugging, code generation
 * 
 * Tools: Write, Edit, Read, Bash, Glob, Grep
 * Focus: High-quality, maintainable, well-tested code
 */
export class CodeAgent extends BaseSubAgent {
  constructor(config: SubAgentConfig = {}) {
    super('CodeAgent', { model: getConfiguredCoderModelSelection(), ...config });
    this.availableTools = ['Write', 'Edit', 'Read', 'Bash', 'Glob', 'Grep'];
  }

  protected buildSystemPrompt(): string {
    return `You are an expert Code Agent specializing in software development.

ROLE: Senior Software Engineer
EXPERTISE:
- Write clean, efficient, production-grade code
- Refactor existing code for maintainability and performance
- Debug issues systematically and thoroughly
- Follow best practices and design patterns
- Write clear comments and documentation
- Consider security, performance, and scalability

AVAILABLE TOOLS:
${this.availableTools.map(t => `- ${t}`).join('\n')}

CODE QUALITY STANDARDS:
✓ Type safety (TypeScript/proper typing)
✓ Error handling
✓ Testability
✓ Documentation
✓ Performance
✓ Security best practices

EXECUTION APPROACH:
1. Analyze the requirement thoroughly
2. Plan the implementation
3. Write/refactor code incrementally
4. Test functionality
5. Review for quality
6. Provide clear explanations`;
  }

  protected buildExecutionPrompt(task: string): string {
    return `CODING TASK:
${task}

REQUIREMENTS:
- Provide complete, working code
- Include error handling
- Add meaningful comments
- Consider edge cases
- Ensure type safety
- Make code testable

Please execute this coding task step by step.`;
  }

  async refactor(code: string, goals: string): Promise<SubAgentExecutionResult> {
    const task = `Refactor this code:\n\n${code}\n\nGoals: ${goals}`;
    return this.execute(task);
  }

  async debug(code: string, issue: string): Promise<SubAgentExecutionResult> {
    const task = `Debug this code issue:\n\nCode:\n${code}\n\nIssue: ${issue}\n\nProvide the fix and explanation.`;
    return this.execute(task);
  }

  async generateCode(specification: string): Promise<SubAgentExecutionResult> {
    const task = `Generate code based on this specification:\n\n${specification}`;
    return this.execute(task);
  }
}

// ============================================================================
// RESEARCH AGENT
// ============================================================================

/**
 * Research Agent
 * Specializes in: information gathering, analysis, summarization
 * 
 * Tools: Read, WebFetch, Glob, Grep, Bash
 * Focus: Accurate, synthesized information and insights
 */
export class ResearchAgent extends BaseSubAgent {
  constructor(config: SubAgentConfig = {}) {
    super('ResearchAgent', { model: getConfiguredCoderModelSelection(), ...config });
    this.availableTools = ['Read', 'WebFetch', 'Glob', 'Grep', 'Bash'];
  }

  protected buildSystemPrompt(): string {
    return `You are an expert Research Agent specializing in information gathering and analysis.

ROLE: Senior Researcher & Analyst
EXPERTISE:
- Gather comprehensive information from multiple sources
- Analyze and synthesize complex information
- Provide clear, well-structured summaries
- Identify key insights and patterns
- Verify information accuracy
- Create detailed reports

AVAILABLE TOOLS:
${this.availableTools.map(t => `- ${t}`).join('\n')}

RESEARCH APPROACH:
1. Clarify research objectives
2. Identify relevant sources
3. Gather information systematically
4. Cross-reference and verify
5. Synthesize findings
6. Create clear summary

QUALITY STANDARDS:
✓ Accuracy and reliability
✓ Comprehensive coverage
✓ Clear organization
✓ Source attribution
✓ Actionable insights`;
  }

  protected buildExecutionPrompt(task: string): string {
    return `RESEARCH TASK:
${task}

APPROACH:
- Search for relevant information
- Analyze findings
- Synthesize key points
- Provide citations/sources
- Highlight important insights

Please conduct this research systematically and provide a comprehensive report.`;
  }

  async gather(topic: string, sources?: string[]): Promise<SubAgentExecutionResult> {
    const sourceInfo = sources ? `Available sources: ${sources.join(', ')}` : '';
    const task = `Gather comprehensive information about: ${topic}\n${sourceInfo}`;
    return this.execute(task);
  }

  async summarize(content: string, maxLength?: number): Promise<SubAgentExecutionResult> {
    const lengthNote = maxLength ? `Keep summary to ${maxLength} words max.` : '';
    const task = `Summarize this content:\n\n${content}\n\n${lengthNote}`;
    return this.execute(task);
  }

  async analyze(data: string, question: string): Promise<SubAgentExecutionResult> {
    const task = `Analyze the following data:\n\n${data}\n\nAnswer this question: ${question}`;
    return this.execute(task);
  }
}

// ============================================================================
// TOOL AGENT
// ============================================================================

/**
 * Tool Agent
 * Specializes in: filesystem operations, shell commands, MCP tool integration
 * 
 * Tools: Write, Read, Edit, Bash, Glob, Grep
 * Focus: Reliable system operations and tool orchestration
 */
export class ToolAgent extends BaseSubAgent {
  constructor(config: SubAgentConfig = {}) {
    super('ToolAgent', { model: getConfiguredCoderModelSelection(), ...config });
    this.availableTools = ['Write', 'Read', 'Edit', 'Bash', 'Glob', 'Grep'];
  }

  protected buildSystemPrompt(): string {
    return `You are an expert Tool Agent specializing in system operations and tool coordination.

ROLE: DevOps & Systems Engineer
EXPERTISE:
- Filesystem operations (create, read, update, delete, organize)
- Shell commands and scripting
- File searching and pattern matching
- MCP tool integration and orchestration
- System reliability and error handling
- Resource management

AVAILABLE TOOLS:
${this.availableTools.map(t => `- ${t}`).join('\n')}

BEST PRACTICES:
✓ Verify operations before executing
✓ Handle errors gracefully
✓ Provide clear feedback
✓ Clean up resources
✓ Log important operations
✓ Use safe defaults

SAFETY GUIDELINES:
- Always verify file paths
- Use appropriate permissions
- Clean up temporary files
- Validate command inputs
- Report any failures`;
  }

  protected buildExecutionPrompt(task: string): string {
    return `SYSTEM TASK:
${task}

REQUIREMENTS:
- Execute safely and reliably
- Verify all operations
- Provide clear status updates
- Handle errors gracefully
- Report results accurately

Please execute this system task.`;
  }

  async manageFiles(operation: string, path: string, content?: string): Promise<SubAgentExecutionResult> {
    const contentNote = content ? `\nContent: ${content.substring(0, 100)}...` : '';
    const task = `Perform file operation: ${operation}\nPath: ${path}${contentNote}`;
    return this.execute(task);
  }

  async executeCommand(command: string, description?: string): Promise<SubAgentExecutionResult> {
    const desc = description ? `Description: ${description}\n` : '';
    const task = `Execute this shell command:\n${desc}Command: ${command}\n\nProvide output and any important information.`;
    return this.execute(task);
  }

  async searchFiles(pattern: string, path?: string): Promise<SubAgentExecutionResult> {
    const pathNote = path ? `in ${path}` : 'in current directory';
    const task = `Search for files matching pattern: ${pattern} ${pathNote}`;
    return this.execute(task);
  }
}

// ============================================================================
// REVIEWER AGENT
// ============================================================================

/**
 * Reviewer Agent
 * Specializes in: validation, quality assurance, consistency checks
 * 
 * Tools: Read, Grep, Bash
 * Focus: Thorough validation and quality verification
 */
export class ReviewerAgent extends BaseSubAgent {
  constructor(config: SubAgentConfig = {}) {
    super('ReviewerAgent', { model: getConfiguredCoderModelSelection(), ...config });
    this.availableTools = ['Read', 'Grep', 'Bash'];
  }

  protected buildSystemPrompt(): string {
    return `You are an expert Reviewer Agent specializing in quality assurance and validation.

ROLE: Senior QA Engineer & Code Reviewer
EXPERTISE:
- Code review and quality assessment
- Consistency checking
- Validation and testing
- Performance analysis
- Security auditing
- Best practices enforcement

AVAILABLE TOOLS:
${this.availableTools.map(t => `- ${t}`).join('\n')}

REVIEW CRITERIA:
✓ Functionality correctness
✓ Code quality and maintainability
✓ Error handling
✓ Performance efficiency
✓ Security vulnerabilities
✓ Consistency with standards
✓ Test coverage
✓ Documentation quality

REPORTING:
- List findings clearly
- Provide severity levels (Critical/High/Medium/Low)
- Include actionable recommendations
- Explain the reasoning`;
  }

  protected buildExecutionPrompt(task: string): string {
    return `VALIDATION TASK:
${task}

APPROACH:
- Review systematically
- Check against quality standards
- Identify issues and risks
- Provide clear recommendations
- Summarize findings

Please conduct a thorough review and provide detailed findings.`;
  }

  async reviewCode(code: string, criteria?: string[]): Promise<SubAgentExecutionResult> {
    const criteriaNote = criteria ? `\nCriteria: ${criteria.join(', ')}` : '';
    const task = `Review this code for quality:\n\n${code}${criteriaNote}\n\nProvide detailed findings.`;
    return this.execute(task);
  }

  async validateConsistency(files: string[], standards: string): Promise<SubAgentExecutionResult> {
    const task = `Validate consistency across these items:\n${files.join('\n')}\n\nStandards: ${standards}`;
    return this.execute(task);
  }

  async validateOutput(output: string, requirements: string): Promise<SubAgentExecutionResult> {
    const task = `Validate this output:\n\n${output}\n\nRequirements:\n${requirements}\n\nProvide pass/fail assessment with details.`;
    return this.execute(task);
  }

  async securityAudit(code: string): Promise<SubAgentExecutionResult> {
    const task = `Perform security audit on this code:\n\n${code}\n\nIdentify vulnerabilities and provide remediation steps.`;
    return this.execute(task);
  }
}

// ============================================================================
// DOCUMENTATION AGENT
// ============================================================================

/**
 * Documentation Agent
 * Specializes in: documentation maintenance, API docs, changelog management
 * 
 * Tools: Write, Read, Edit, Bash, Glob, Grep
 * Focus: Accurate, comprehensive, up-to-date documentation
 */
export class DocumentationAgent extends BaseSubAgent {
  constructor(config: SubAgentConfig = {}) {
    super('DocumentationAgent', { model: getConfiguredCoderModelSelection(), ...config });
    this.availableTools = ['Write', 'Read', 'Edit', 'Bash', 'Glob', 'Grep'];
  }

  protected buildSystemPrompt(): string {
    return `You are an expert Documentation Agent specializing in technical documentation.

ROLE: Senior Technical Writer & Documentation Specialist
EXPERTISE:
- Write clear, accurate technical documentation
- Maintain README and installation guides
- Generate and update API documentation
- Maintain CHANGELOG and migration guides
- Detect and fix outdated documentation
- Synchronize code comments with documentation
- Generate release notes and feature documentation
- Create and maintain architecture diagrams
- Track feature additions and removals
- Keep examples up-to-date with API changes

AVAILABLE TOOLS:
${this.availableTools.map(t => `- ${t}`).join('\n')}

DOCUMENTATION STANDARDS:
✓ Clear and concise explanations
✓ Accurate code examples
✓ Consistent formatting
✓ Proper version tracking
✓ Complete API coverage
✓ Updated changelogs
✓ Installation instructions
✓ Troubleshooting guides

DOCUMENTATION APPROACH:
1. Review codebase changes
2. Identify affected documentation
3. Update relevant docs
4. Verify consistency
5. Track changes in changelog
6. Generate appropriate release notes
7. Update examples if needed`;
  }

  protected buildExecutionPrompt(task: string): string {
    return `DOCUMENTATION TASK:
${task}

REQUIREMENTS:
- Ensure accuracy
- Use clear language
- Include examples where appropriate
- Maintain consistency
- Follow markdown conventions
- Track changes appropriately

Please execute this documentation task.`;
  }

  async monitorChanges(codeChanges: string): Promise<SubAgentExecutionResult> {
    const task = `Monitor these code changes and identify documentation impacts:\n\n${codeChanges}\n\nWhat documentation needs updating?`;
    return this.execute(task);
  }

  async updateReadme(projectInfo: string, changes?: string): Promise<SubAgentExecutionResult> {
    const changeNote = changes ? `\nRecent changes: ${changes}` : '';
    const task = `Update README.md based on this project info:\n${projectInfo}${changeNote}\n\nProvide updated README content.`;
    return this.execute(task);
  }

  async updateChangelog(version: string, changes: string, previousChangelog?: string): Promise<SubAgentExecutionResult> {
    const prevNote = previousChangelog ? `\nPrevious changelog:\n${previousChangelog}` : '';
    const task = `Update CHANGELOG.md for version ${version}:\n\nChanges:\n${changes}${prevNote}\n\nProvide updated CHANGELOG content.`;
    return this.execute(task);
  }

  async generateApiDocs(code: string, existingDocs?: string): Promise<SubAgentExecutionResult> {
    const existingNote = existingDocs ? `\nExisting docs:\n${existingDocs}` : '';
    const task = `Generate API documentation for this code:\n\n${code}${existingNote}\n\nProvide comprehensive API documentation.`;
    return this.execute(task);
  }

  async updateArchitectureDocs(codebaseChanges: string, currentDocs?: string): Promise<SubAgentExecutionResult> {
    const currentNote = currentDocs ? `\nCurrent architecture docs:\n${currentDocs}` : '';
    const task = `Update architecture documentation based on these changes:\n${codebaseChanges}${currentNote}\n\nProvide updated architecture description.`;
    return this.execute(task);
  }

  async updateInstallationGuide(dependencies: string, steps: string, currentGuide?: string): Promise<SubAgentExecutionResult> {
    const currentNote = currentGuide ? `\nCurrent guide:\n${currentGuide}` : '';
    const task = `Update installation/setup guide:\n\nDependencies:\n${dependencies}\n\nSteps:\n${steps}${currentNote}\n\nProvide updated guide.`;
    return this.execute(task);
  }

  async updateExamples(apiChanges: string, currentExamples?: string): Promise<SubAgentExecutionResult> {
    const examplesNote = currentExamples ? `\nCurrent examples:\n${currentExamples}` : '';
    const task = `Update examples to reflect these API changes:\n${apiChanges}${examplesNote}\n\nProvide updated examples.`;
    return this.execute(task);
  }

  async detectOutdatedDocs(codebase: string, docs: string): Promise<SubAgentExecutionResult> {
    const task = `Detect outdated documentation:\n\nCurrent codebase:\n${codebase}\n\nDocumentation:\n${docs}\n\nIdentify outdated or missing sections.`;
    return this.execute(task);
  }

  async generateMigrationGuide(oldVersion: string, newVersion: string, breakingChanges: string): Promise<SubAgentExecutionResult> {
    const task = `Generate migration guide from ${oldVersion} to ${newVersion}:\n\nBreaking changes:\n${breakingChanges}\n\nProvide comprehensive migration guide.`;
    return this.execute(task);
  }

  async generateReleaseNotes(version: string, changes: string, features: string, bugfixes: string): Promise<SubAgentExecutionResult> {
    const task = `Generate release notes for version ${version}:\n\nAll changes:\n${changes}\n\nNew features:\n${features}\n\nBug fixes:\n${bugfixes}\n\nProvide professional release notes.`;
    return this.execute(task);
  }

  async trackFeatures(addedFeatures: string, removedFeatures: string, changedFeatures?: string): Promise<SubAgentExecutionResult> {
    const changedNote = changedFeatures ? `\nChanged features:\n${changedFeatures}` : '';
    const task = `Track feature changes:\n\nAdded:\n${addedFeatures}\n\nRemoved:\n${removedFeatures}${changedNote}\n\nProvide feature tracking summary.`;
    return this.execute(task);
  }

  async synchronizeComments(code: string, currentComments?: string): Promise<SubAgentExecutionResult> {
    const commentsNote = currentComments ? `\nCurrent comments:\n${currentComments}` : '';
    const task = `Synchronize code comments with documentation:\n\nCode:\n${code}${commentsNote}\n\nProvide updated code with synchronized comments.`;
    return this.execute(task);
  }
}

// ============================================================================
// SUB-AGENT POOL & MANAGER
// ============================================================================

/**
 * Manages a pool of specialized sub-agents
 * Provides factory methods and coordination
 */
export class SubAgentPool {
  private agents: Map<string, BaseSubAgent> = new Map();
  private config: SubAgentConfig;

  constructor(config: SubAgentConfig = {}) {
    this.config = config;
    this.initializeAgents();
  }

  private initializeAgents(): void {
    this.agents.set('code', new CodeAgent(this.config));
    this.agents.set('research', new ResearchAgent(this.config));
    this.agents.set('tool', new ToolAgent(this.config));
    this.agents.set('reviewer', new ReviewerAgent(this.config));
    this.agents.set('documentation', new DocumentationAgent(this.config));
  }

  getAgent(type: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation'): BaseSubAgent {
    const agent = this.agents.get(type);
    if (!agent) {
      throw new Error(`Unknown sub-agent type: ${type}`);
    }
    return agent;
  }

  getCodeAgent(): CodeAgent {
    return this.agents.get('code') as CodeAgent;
  }

  getResearchAgent(): ResearchAgent {
    return this.agents.get('research') as ResearchAgent;
  }

  getToolAgent(): ToolAgent {
    return this.agents.get('tool') as ToolAgent;
  }

  getReviewerAgent(): ReviewerAgent {
    return this.agents.get('reviewer') as ReviewerAgent;
  }

  getDocumentationAgent(): DocumentationAgent {
    return this.agents.get('documentation') as DocumentationAgent;
  }

  async executeWithAgent(
    type: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation',
    task: string,
    roleRule?: string,
  ): Promise<SubAgentExecutionResult> {
    const agent = this.getAgent(type);
    return agent.execute(task, roleRule);
  }

  getAvailableAgents(): Array<{ type: string; name: string }> {
    return Array.from(this.agents.entries()).map(([type, agent]) => ({
      type,
      name: agent.getName(),
    }));
  }

  /**
   * Execute tasks in parallel using multiple agents
   */
  async executeParallel(
    tasks: Array<{
      type: 'code' | 'research' | 'tool' | 'reviewer' | 'documentation';
      task: string;
    }>
  ): Promise<SubAgentExecutionResult[]> {
    const promises = tasks.map(({ type, task }) => this.executeWithAgent(type, task));
    return Promise.all(promises);
  }

  /**
   * Get metrics for all agents
   */
  getMetrics(): {
    agentCount: number;
    agents: Array<{
      name: string;
      type: string;
    }>;
  } {
    return {
      agentCount: this.agents.size,
      agents: this.getAvailableAgents(),
    };
  }
}

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

export { BaseSubAgent };

/**
 * Factory function to create sub-agent pool
 */
export function createSubAgentPool(config?: SubAgentConfig): SubAgentPool {
  return new SubAgentPool(config);
}
