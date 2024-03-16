import { ContextManager, Message } from "./context_management";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal } from "./environment/environment";
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, tool_functions, tools } from "./toolbox";
import { callLLMTools } from "./llm";

let preprompt = `You are Clippinator, an AI software engineer. You operate in the environment where you have access to tools. You can use these tools to execute the user's request.
When you get the request, make a plan and save it into todos. Then execute the plan by focusing on one task at a time, adjusting it if something goes wrong.
When you are done executing the plan, write "<DONE/>" as a separate line
`

export class Clipinator {
    env: Environment;
    contextManager: ContextManager;

    constructor(objective: string = "", path: string = ".") {
        this.contextManager = new ContextManager(objective);
        this.env = new Environment(new DefaultFileSystem(path), new DummyBrowser(), new DummyTerminal(), new CLIUserInterface());
    }

    async runTool(tool: Tool, parameters: Record<string, any>): Promise<string> {
        const toolFunction = tool_functions[tool.function.name];
        const result = await toolFunction(parameters, this.env, this.contextManager);
        return result;
    }

    async runToolCall(toolName: string, toolArguments: Record<string, any>): Promise<string> {
        let toolCall = { tool: toolName, parameters: toolArguments } as ToolCall;
        const tool = tools.find((t) => t.function.name === toolCall.tool);
        if (!tool) {
            return `Tool ${toolCall.tool} not found`;
        }
        const result = await this.runTool(tool, toolCall.parameters);
        return result;
    }

    async getPrompt(): Promise<string> {
        return this.contextManager.getContext(this.env);
    }

    async oneStep(message?: string) {
        if (message) {
            this.contextManager.history.push({ type: "user", content: message });
        }
        const prompt = await this.getPrompt();
        const { toolCallsFull, response } = await callLLMTools(prompt, tools, this.runToolCall.bind(this), undefined, preprompt);
        this.contextManager.history.push({ type: "thoughts", content: response });
        this.contextManager.history.push(...toolCallsFull);
        return response
    }

    async run() {
        while (true) {
            let resp = await this.oneStep();
            if (resp.includes("<DONE/>")) {
                break;
            }
        }
    }
}
