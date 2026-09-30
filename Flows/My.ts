import { Page, BrowserContext } from '@playwright/test';
import Constants from '../Helpers/Constants';
import { TestData } from '../Helpers/TestData';
import { CommonFlows } from './CommonFlows';
import { ChatOptions, ChatResult, LLMFlows, MCPServerHandle, MCPServerOptions, RunPromptOptions } from './LLMFlows';

export class MyFacade {
  public page!: Page;
  public context!: BrowserContext;
  public readonly Constants = Constants;
  public readonly TestData = new TestData();
  public TestInfo?: any;

  public CommonFlows!: CommonFlows;
  public Flows!: CommonFlows;
  public LLM!: LLMFlows;

  constructor(page?: Page, context?: BrowserContext) {
    if (page) this.page = page;
    if (context) this.context = context;
    this.CommonFlows = new CommonFlows(this);
    this.Flows = this.CommonFlows;
    this.LLM = new LLMFlows(this);
  }
}

export class MyLLMFacade extends MyFacade {
  constructor(page?: Page, context?: BrowserContext) {
    super(page, context);
  }

  async launchMCP(options: MCPServerOptions = { mcpPort: 8931, cdpPort: 9222 }): Promise<MCPServerHandle> {
    return this.LLM.launchMCP(options);
  }

  async runPrompt(input: string, options: RunPromptOptions = {}): Promise<any> {
    return this.LLM.runPrompt(input, options);
  }

  async callLLM(options: ChatOptions): Promise<ChatResult> {
    return this.LLM.callLLM(options);
  }
}

class MySingleton extends MyLLMFacade {
  private static instance: MySingleton;

  private constructor() {
    super();
  }

  public static getInstance(): MySingleton {
    if (!MySingleton.instance) {
      MySingleton.instance = new MySingleton();
    }
    return MySingleton.instance;
  }
}

export default MySingleton.getInstance();
