import { ContextManager, Message } from "./context_management";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal } from "./environment/environment";
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, tool_functions, tools } from "./toolbox";
import { callLLMTools } from "./llm";

let preprompt = `You are Clippinator, an AI software engineer. You operate in the environment where you have access to tools. You can use these tools to execute the user's request.
When you get the request, make a plan and save it into todos. 
Try to make the plan as simple as possible, with a few steps (one step can be "refactor ... to be ..." or something on that level). Before declaring the plan, think about what you have to do. Don't make the plan too specific, the steps should be more like milestones. Each step will correspond to multiple tool calls. 
For example, moving something from one file to another can be one task.
After making the plan, execute the plan by focusing on one task at a time, adjusting it if something goes wrong.
When you are done executing everything in the plan, write "<DONE/>" as a separate line.
Try to execute the actions you need to take in one step (one invoke) if you don't need the output of the previous ones. For example, you can declare the plan and start executing on it right away.
Before calling the tools, write your thoughts out loud and describe why you are doing that and what you expect to happen.
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
        let toolCall = { tool_name: toolName, parameters: toolArguments } as ToolCall;
        const tool = tools.find((t) => t.function.name === toolCall.tool_name);
        if (!tool) {
            return `Tool ${toolCall.tool_name} not found`;
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
                console.log(await this.getPrompt())
                break;
            }
        }
    }
}
