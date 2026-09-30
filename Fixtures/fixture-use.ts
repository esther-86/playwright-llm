/* eslint-disable no-empty-pattern */
/* eslint-disable lines-around-comment */
import fs from 'fs/promises';
import { test as base, Page, BrowserContext, PlaywrightTestArgs } from '@playwright/test';
import { attachToBrowser, launchBrowser } from "./fixture-helpers";
import My, { MyFacade, MyLLMFacade } from "../Flows/My";

// Save data generated from the test to here so that we can choose which data to use when the time comes
class ThisTest {
  playwright: any;
  data: any = {};
  cleanupFunctions: any[] = [];
  toDelete: any = {
    userIds: [],
    participantIds: [],
    schedules: [],
    templates: []
  };

  async configureDataBeforeReturningPage(current: any) {
    for (const key in current) {
      this.data[key] = current[key];
    }
  }
}

// Declare the types of your fixtures.
type MyFixtures = {
  My: MyFacade;
  MyPersistent: MyFacade;
  MyLLM: MyLLMFacade;
};

// https://playwright.dev/docs/test-fixtures
export const test = base.extend<MyFixtures>({

  // Expose My facade as a fixture
  My: async ({ playwright, page, context }, use) => {
    const facade = new MyFacade(page, context);
    const thisTest = new ThisTest();
    thisTest.playwright = playwright;
    facade.TestInfo = thisTest;

    await use(facade);

    const cleanupPromises: Promise<void>[] = [];
    await Promise.all(cleanupPromises);
  },

  MyPersistent: async ({ playwright }, use) => {
    const currentBrowser = await attachToBrowser();
    const facade = new MyFacade(currentBrowser.page, currentBrowser.context);
    const thisTest = new ThisTest();
    thisTest.playwright = playwright;
    facade.TestInfo = thisTest;

    await use(facade);

    const cleanupPromises: Promise<void>[] = [];
    await Promise.all(cleanupPromises);
  },

  MyLLM: async ({ playwright }, use, testInfo) => {
    const workerOffset = testInfo.workerIndex * 2;
    const cdpPort = Number(process.env.CDP_PORT_BASE ?? 9222) + workerOffset;
    const mcpPort = Number(process.env.MCP_PORT_BASE ?? 8931) + workerOffset;
    const browser = await launchBrowser(cdpPort);
    const context = await browser.newContext();
    const page = await context.newPage();
    const facade = new MyLLMFacade(page, context);
    const thisTest = new ThisTest();
    thisTest.playwright = playwright;
    facade.TestInfo = thisTest;

    const tracePath = testInfo.outputPath('myllm-trace.zip');
    const networkPath = testInfo.outputPath('myllm-network.json');
    const networkEvents: Array<Record<string, any>> = [];
    let tracingStarted = false;

    try {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      tracingStarted = true;
    } catch (error) {
      if (!/already started/i.test(String(error))) {
        throw error;
      }
    }

    page.on('request', (request) => {
      networkEvents.push({
        type: 'request',
        method: request.method(),
        url: request.url(),
        headers: request.headers(),
        timestamp: Date.now(),
      });
    });

    page.on('response', async (response) => {
      networkEvents.push({
        type: 'response',
        status: response.status(),
        url: response.url(),
        headers: response.headers(),
        timestamp: Date.now(),
      });
    });

    let mcpServer;
    try {
      mcpServer = await facade.LLM.launchMCP({ cdpPort, mcpPort });
      await use(facade);
    } finally {
      if (tracingStarted) {
        try {
          await context.tracing.stop({ path: tracePath });
        } catch {
          // Ignore trace stop failures when the context is already closing.
        }
      }

      try {
        await fs.writeFile(networkPath, JSON.stringify(networkEvents, null, 2));
      } catch {
        // Ignore network log write failures if the test output directory is unavailable.
      }

      await mcpServer?.stop();
      await context.close();
      await browser.close();
    }
  },

});

export { expect } from '@playwright/test';
export { ThisTest };
