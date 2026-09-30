import { Page } from '@playwright/test';
import { CommonFlows } from "./CommonFlows";
import { ChildProcess, spawn, exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

import { MCPClient } from "../Helpers/MCPClient";
import type { MyFacade } from './My';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
  geminiParts?: any[];
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: any[];
  model?: string;
}

export interface ChatResult {
  message: ChatMessage;
  content: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, any> }>;
}

export interface RunPromptOptions {
  page?: Page;
  port?: number;
  url?: string;
  mcpPort?: number;
  maxWaitPerAction?: number;
  includePassedFailedInstruction?: boolean;
  includeMaxWaitPerActionInstruction?: boolean;
  includeCloseBrowserInstruction?: boolean;
  maxTurns?: number;
  model?: string;
}

export interface MCPServerOptions {
  mcpPort: number;
  cdpPort: number;
  startupTimeoutMs?: number;
}

export interface MCPServerHandle {
  readonly mcpPort: number;
  readonly process: ChildProcess;
  stop(): Promise<void>;
}

export interface LLMProvider {
  call(options: ChatOptions): Promise<ChatResult>;
}

class LLMRequestRateLimiter {
  private static readonly intervalMs = 20_000;
  private static nextSlotAt = 0;

  static async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slotAt = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slotAt + this.intervalMs;
    const waitMs = slotAt - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export class OpenAIProvider implements LLMProvider {
  async call(options: ChatOptions): Promise<ChatResult> {
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set in environment');
    }
    const baseUrl = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;
    const model = options.model || process.env.OPENAI_MODEL || 'gpt-4o';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LLM call to openai (${model}) failed [${response.status}]: ${errorBody}`);
    }

    const data: any = await response.json();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message || { role: 'assistant', content: '' };

    const toolCalls = (assistantMsg.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: tc.function.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {},
    }));

    return {
      message: assistantMsg,
      content: assistantMsg.content || '',
      toolCalls,
    };
  }
}

export class JevProvider implements LLMProvider {
  async call(options: ChatOptions): Promise<ChatResult> {
    const apiKey = process.env.JEV_API_KEY || '';
    if (!apiKey) {
      throw new Error('JEV_API_KEY is not set in environment');
    }

    const baseUrl = (process.env.JEV_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;
    const model = options.model || process.env.JEV_MODEL || 'openai/gpt-5.5';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        tools: options.tools && options.tools.length > 0 ? options.tools : undefined,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LLM call to Jev (${model}) failed [${response.status}]: ${errorBody}`);
    }

    const data: any = await response.json();
    const choice = data.choices?.[0];
    const assistantMsg = choice?.message || { role: 'assistant', content: '' };

    const toolCalls = (assistantMsg.tool_calls || []).map((tc: any) => ({
      id: tc.id,
      name: tc.function.name,
      args: tc.function.arguments ? (typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments) : {},
    }));

    return {
      message: assistantMsg,
      content: assistantMsg.content || '',
      toolCalls,
    };
  }
}

export class GeminiProvider implements LLMProvider {
  private sanitizeSchema(schema: any): any {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) {
      return schema.map((item) => this.sanitizeSchema(item));
    }
    const clean: any = {};
    const forbiddenKeys = new Set([
      'additionalProperties',
      'propertyNames',
      '$schema',
      '$id',
      'definitions',
      '$defs',
      'patternProperties',
    ]);
    for (const [key, value] of Object.entries(schema)) {
      if (forbiddenKeys.has(key)) continue;
      clean[key] = this.sanitizeSchema(value);
    }
    return clean;
  }

  async call(options: ChatOptions): Promise<ChatResult> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || '';
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_GENAI_API_KEY is not set in environment');
    }
    const model = options.model || process.env.GEMINI_MODEL || 'gemini-flash-latest';
    const baseUrl = (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const url = `${baseUrl}/models/${model}:generateContent?key=${apiKey}`;

    const systemMsg = options.messages.find((m) => m.role === 'system');
    const systemInstruction = systemMsg?.content ? { parts: [{ text: systemMsg.content }] } : undefined;

    const contents = options.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (m.role === 'user') {
          return { role: 'user', parts: [{ text: m.content || '' }] };
        }
        if (m.role === 'assistant') {
          if (m.geminiParts) {
            return { role: 'model', parts: m.geminiParts };
          }
          const parts: any[] = [];
          if (m.content) parts.push({ text: m.content });
          if (m.tool_calls) {
            for (const tc of m.tool_calls) {
              parts.push({
                functionCall: {
                  name: tc.function.name,
                  args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments,
                },
              });
            }
          }
          return { role: 'model', parts: parts.length > 0 ? parts : [{ text: '' }] };
        }
        if (m.role === 'tool') {
          let responseData: any;
          try {
            responseData = m.content ? JSON.parse(m.content) : {};
          } catch {
            responseData = { output: m.content };
          }
          return {
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: m.name || 'tool',
                  response: responseData,
                },
              },
            ],
          };
        }
        return { role: 'user', parts: [{ text: m.content || '' }] };
      });

    const tools =
      options.tools && options.tools.length > 0
        ? [
            {
              functionDeclarations: options.tools.map((t: any) => ({
                name: t.function?.name,
                description: t.function?.description || '',
                parameters: this.sanitizeSchema(t.function?.parameters || { type: 'object', properties: {} }),
              })),
            },
          ]
        : undefined;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction,
        tools,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LLM call to gemini (${model}) failed [${response.status}]: ${errorBody}`);
    }

    const data: any = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    let content = '';
    const toolCalls: Array<{ id: string; name: string; args: Record<string, any> }> = [];
    const openAiToolCalls: any[] = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.text) {
        content += (content ? '\n' : '') + part.text;
      }
      if (part.functionCall) {
        const callId = `call_${Date.now()}_${i}`;
        toolCalls.push({
          id: callId,
          name: part.functionCall.name,
          args: part.functionCall.args || {},
        });
        openAiToolCalls.push({
          id: callId,
          type: 'function',
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      }
    }

    const assistantMsg: ChatMessage = {
      role: 'assistant',
      content,
      tool_calls: openAiToolCalls.length > 0 ? openAiToolCalls : undefined,
      geminiParts: parts,
    };

    return {
      message: assistantMsg,
      content,
      toolCalls,
    };
  }
}

export class LLMProviderFactory {
  private static providers: Record<string, () => LLMProvider> = {
    openai: () => new OpenAIProvider(),
    gemini: () => new GeminiProvider(),
    jev: () => new JevProvider(),
  };

  static register(name: string, factory: () => LLMProvider): void {
    LLMProviderFactory.providers[name.toLowerCase()] = factory;
  }

  static getProvider(name?: string): LLMProvider {
    const key = (
      name ||
      process.env.LLM_PROVIDER ||
      'jev'
    ).toLowerCase();

    const factory = LLMProviderFactory.providers[key];
    if (!factory) {
      throw new Error(`Unsupported LLM provider: "${key}". Available providers: ${Object.keys(LLMProviderFactory.providers).join(', ')}`);
    }
    const provider = factory();
    return {
      call: async (options) => {
        await LLMRequestRateLimiter.waitForSlot();
        return provider.call(options);
      },
    };
  }
}

class LLMFlows extends CommonFlows {
  private mcpPort = 8931;

  constructor(my?: MyFacade) {
    super(my);
  }

  static async waitForServerReady(url: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const controller = new AbortController();
        const requestTimeout = setTimeout(() => controller.abort(), 1000);
        try {
          const res = await fetch(`${url}/sse`, {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (res.ok && res.body) {
            await res.body.cancel();
            return;
          }
        } finally {
          clearTimeout(requestTimeout);
          controller.abort();
        }
      } catch {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    throw new Error(`Server at ${url} failed to respond within ${timeoutMs}ms`);
  }

  static async killPort(port: number): Promise<void> {
    return new Promise((resolve) => {
      const isWin = process.platform === 'win32';
      const cmd = isWin
        ? `for /f "tokens=5" %a in ('netstat -aon ^| findstr :${port}') do taskkill /F /PID %a 2>nul`
        : `lsof -ti :${port} | xargs kill -9 2>/dev/null || true`;
      exec(cmd, () => resolve());
    });
  }

  static async launchMCP(options: MCPServerOptions): Promise<MCPServerHandle> {
    await LLMFlows.killPort(options.mcpPort);
    const cliPath = path.resolve(__dirname, '../node_modules/@playwright/mcp/cli.js');
    const child = spawn(process.execPath, [
      cliPath,
      '--port', String(options.mcpPort),
      '--cdp-endpoint', `http://localhost:${options.cdpPort}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    child.stdout?.on('data', data => console.log(`mcp: ${data}`));
    child.stderr?.on('data', data => console.error(`mcp: ${data}`));

    const stop = async (): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;

      await new Promise<void>((resolve) => {
        const forceKill = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => {
          clearTimeout(forceKill);
          resolve();
        });
        child.kill('SIGTERM');
      });
    };

    try {
      await Promise.race([
        LLMFlows.waitForServerReady(
          `http://localhost:${options.mcpPort}`,
          options.startupTimeoutMs,
        ),
        new Promise<never>((_, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            reject(new Error(`Playwright MCP exited during startup (code=${code}, signal=${signal})`));
          });
        }),
      ]);
    } catch (error) {
      await stop();
      throw error;
    }

    return { mcpPort: options.mcpPort, process: child, stop };
  }

  async launchMCP(options: MCPServerOptions): Promise<MCPServerHandle> {
    const server = await LLMFlows.launchMCP(options);
    this.mcpPort = server.mcpPort;
    return server;
  }

  async waitForServerReady(url: string, timeoutMs = 15000): Promise<void> {
    return LLMFlows.waitForServerReady(url, timeoutMs);
  }

  static async callLLM(options: ChatOptions): Promise<ChatResult> {
    return LLMProviderFactory.getProvider().call(options);
  }

  async callLLM(options: ChatOptions): Promise<ChatResult> {
    return LLMFlows.callLLM(options);
  }

  async runPrompt(input: string, options: RunPromptOptions = {}): Promise<any> {
    return LLMFlows.runPrompt(input, { ...options, page: options.page ?? this.page, mcpPort: options.mcpPort ?? this.mcpPort });
  }

  private static async getInteractiveElements(page?: Page, mcp?: MCPClient): Promise<string> {
    if (page) {
      try {
        const elements = await page.evaluate(() => {
          const selectors = [
            'button',
            'a[href]',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            '[role="button"]',
            '[role="link"]',
            '[role="searchbox"]',
            '[role="tab"]',
          ];
          const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
          return nodes
            .filter((el) => {
              const rect = el.getBoundingClientRect();
              const style = window.getComputedStyle(el);
              return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
            })
            .slice(0, 50)
            .map((el) => {
              const tag = el.tagName.toLowerCase();
              const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50);
              const placeholder = (el as HTMLInputElement).placeholder || '';
              const aria = el.getAttribute('aria-label') || '';
              const id = el.id ? `#${el.id}` : '';
              const name = (el as HTMLInputElement).name ? `name="${(el as HTMLInputElement).name}"` : '';
              const type = (el as HTMLInputElement).type ? `type="${(el as HTMLInputElement).type}"` : '';
              const role = el.getAttribute('role') ? `role="${el.getAttribute('role')}"` : '';

              const parts = [tag + id];
              if (type) parts.push(type);
              if (role) parts.push(role);
              if (name) parts.push(name);
              if (placeholder) parts.push(`placeholder="${placeholder}"`);
              if (aria) parts.push(`aria-label="${aria}"`);
              if (text) parts.push(`text="${text}"`);
              return `<${parts.join(' ')}>`;
            });
        });
        if (elements && elements.length > 0) {
          return elements.join('\n');
        }
      } catch {
        // Fallback to MCP snapshot if page evaluation fails
      }
    }

    if (mcp) {
      try {
        const res = await mcp.callTool('browser_snapshot', {});
        const str = typeof res === 'string' ? res : JSON.stringify(res);
        const lines = str.split('\n');
        const interactiveLines = lines.filter((l) =>
          /button|link|textbox|search|input|combobox|checkbox|radio/i.test(l)
        );
        return interactiveLines.slice(0, 50).join('\n');
      } catch {
        return '';
      }
    }

    return '';
  }

  private static isReadOnlyBrowserTool(name: string): boolean {
    return new Set([
      'browser_snapshot',
      'browser_find',
      'browser_console_messages',
      'browser_network_requests',
      'browser_screenshot',
      'browser_take_screenshot',
    ]).has(name);
  }

  private static getBrowserActionSignature(name: string, args: Record<string, any>): string | undefined {
    if (!name.startsWith('browser_') || LLMFlows.isReadOnlyBrowserTool(name)) return undefined;

    const subject = args.element ?? args.target ?? args.selector ?? args.url ?? args;
    const value = args.text ?? args.value ?? args.url ?? '';
    return `${name}:${JSON.stringify(subject)}:${JSON.stringify(value)}`;
  }

  static async runPrompt(input: string, options: RunPromptOptions = {}): Promise<any> {
    const mcpPort = options.mcpPort ?? 8931;
    const mcp = new MCPClient(`http://localhost:${mcpPort}`);
    await mcp.connect();

    try {
      const rawTools = await mcp.listTools();
      const openAiTools = rawTools.map((tool) => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }));

      const interactiveElements = await LLMFlows.getInteractiveElements(options.page, mcp);

      const systemPrompt = `You are a specialized browser automation assistant using Playwright MCP tools to accomplish user goals on the active browser.

## Core Principles:
- Use the visible interactive elements to select the best targets.
- Execute actions step-by-step using the provided tools (e.g. browser_click, browser_type, browser_navigate).
- You can call browser_snapshot at any turn to inspect updated DOM elements.
- After an action succeeds, do not repeat it; use its result to decide the next step. Avoid redundant snapshots and clicks.
- When the goal has been successfully accomplished, end your response with: "Passed Browser Agent Action".
- If you cannot complete the goal, end your response with: "Failed Browser Agent Action".`;

      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: interactiveElements
            ? `User Goal: ${input}\n\nVisible Interactive Elements:\n${interactiveElements}`
            : `User Goal: ${input}`,
        },
      ];

      const maxTurns = options.maxTurns || (process.env.AGENT_MAX_TURNS ? parseInt(process.env.AGENT_MAX_TURNS, 10) : 25);
      let turns = 0;
      let finalMessage = '';
      const completedBrowserActions = new Set<string>();

      while (turns++ < maxTurns) {
        const result = await LLMFlows.callLLM({
          messages,
          tools: openAiTools.length > 0 ? openAiTools : undefined,
          model: options.model,
        });

        messages.push(result.message);

        if (result.content) {
          finalMessage = result.content;
          console.log(`Agent response (turn ${turns}):\n${finalMessage}`);
        }

        if (result.toolCalls.length === 0) {
          break;
        }

        for (const toolCall of result.toolCalls) {
          let toolResult: any;
          try {
            const toolArgs = { ...toolCall.args };
            const actionSignature = LLMFlows.getBrowserActionSignature(toolCall.name, toolArgs);
            if (actionSignature && completedBrowserActions.has(actionSignature)) {
              console.warn(`Suppressing repeated MCP action ${toolCall.name}:`, toolArgs);
              toolResult = { error: 'This browser action already succeeded during this task. Do not repeat it; inspect the current page or continue with the next step.' };
            } else {
              console.log(`Executing MCP tool ${toolCall.name}:`, toolCall.args);
              if (typeof toolArgs.filename === 'string' && toolArgs.filename.trim()) {
                await fs.mkdir(path.resolve('test-results'), { recursive: true });
                toolArgs.filename = path.join('test-results', path.basename(toolArgs.filename));
              }
              toolResult = await mcp.callTool(toolCall.name, toolArgs);
              if (actionSignature && !toolResult?.isError) {
                completedBrowserActions.add(actionSignature);
              }
              if (options.page && toolCall.name.startsWith('browser_') && !LLMFlows.isReadOnlyBrowserTool(toolCall.name)) {
                await options.page.waitForLoadState('load', { timeout: options.maxWaitPerAction ?? 30_000 });
              }
            }
          } catch (err: any) {
            toolResult = { error: err.message };
          }

          messages.push({
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult),
          });
        }
      }

      if (finalMessage.includes("Failed Browser Agent Action")) {
        throw new Error("Failed Browser Agent Action");
      }

      return { finalMessage, turns, messages };
    } finally {
      mcp.disconnect();
    }
  }
}
export { LLMFlows }
