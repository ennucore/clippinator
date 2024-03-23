import { ContextManager, Message } from "./context/context_management";
import { Environment, CLIUserInterface, DummyBrowser, DummyTerminal, TrunkLinter } from "./environment/environment";
import { SimpleTerminal } from './environment/terminal';
import { DefaultFileSystem } from "./environment/filesystem";
import { Tool, ToolCall, final_result_tool, tool_functions, tools } from "./toolbox";
import { callLLMTools, haiku_model, opus_model, sonnet_model } from "./llm";
import { planning_examples, task_prompts } from "./prompts";
var clc = require("cli-color");

let preprompt = `You are Clippinator, an AI software engineer. You operate in the environment where you have access to tools. You can use these tools to execute the user's request.
When you are done executing everything in the plan, write "<DONE/>" as a separate line.
Try to execute the actions you need to take in one step (one invoke) if you don't need the output of the previous ones.
Before calling the tools, write your thoughts out loud and describe why you are doing that and what you expect to happen.
`;


// `When you get the request, make a plan and save it into todos. 
// Try to make the plan as simple as possible, with a few steps (one step can be "refactor ... to be ..." or something on that level). Before declaring the plan, think about what you have to do. Don't make the plan too specific, the steps should be more like milestones. Each step will correspond to multiple tool calls. 
// For example, moving something from one file to another can be one task.
// After making the plan, execute the plan by focusing on one task at a time, adjusting it if something goes wrong.
// `

export class Clipinator {
    env: Environment;
    contextManager: ContextManager;

    constructor(objective: string = "", path: string = ".") {
        this.contextManager = new ContextManager(objective);
        this.env = new Environment(new DefaultFileSystem(path), new DummyBrowser(), new SimpleTerminal(path), new CLIUserInterface(), new TrunkLinter(path));
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

    async getPrompt(task: string = "", additional_context?: string): Promise<string> {
        let is_full = additional_context !== undefined ? false : true;
        let res = await this.contextManager.getContext(this.env, is_full) + '\n';
        if (additional_context) {
            res += additional_context + '\n' + task;
        } else {
            res += task;
        }
        return res;
    }

    async oneStep(task: string = "", result_format?: Record<string, any>, result_description?: string, additional_context?: string, disableTools: boolean | string[] = false, model: string = opus_model) {
        const prompt = await this.getPrompt(task, additional_context);
        let tools_now = tools;
        if (disableTools === true) {
            tools_now = [];
        }
        if (Array.isArray(disableTools)) {
            tools_now = tools_now.filter((tool) => !disableTools.includes(tool.function.name));
        }
        if (result_format) {
            tools_now = tools_now.concat([final_result_tool(result_description || '', result_format)]);
        }
        const { toolCallsFull, response } = await callLLMTools(prompt, tools_now, this.runToolCall.bind(this), undefined, preprompt, model);
        this.contextManager.history.push({ type: "thoughts", content: response });
        this.contextManager.history.push(toolCallsFull);
        let result = null;
        /* parse result if final_result() was called */
        if (result_format) {
            let result_call = toolCallsFull.filter((toolCall) => toolCall.tool_name === "final_result")[0];
            if (result_call) {
                result = result_call.parameters;
            }
        }
        return { response, toolCallsFull, result };
    }

    async run(task: string = "", result_format?: Record<string, any>, result_description?: string, additional_context?: string, stop_at_tool?: string, disableTools: boolean | string[] = false, model: string = opus_model, max_iterations: number = 100) {
        while (max_iterations-- > 0) {
            let { response, result, toolCallsFull } = await this.oneStep(task, result_format, result_description, additional_context, disableTools, model);
            if (result) {
                return result;
            }
            if (response.includes("<DONE/>")) {
                console.log(response)
                // console.log(await this.getPrompt())
                break;
            }
            if (stop_at_tool) {
                let stop_tool_index = toolCallsFull.findIndex((toolCall) => toolCall.tool_name === stop_at_tool);
                if (stop_tool_index !== -1) {
                    // console.log(await this.getPrompt())
                    break;
                }
            }
        }
    }

    async generatePlan() {
        await this.run(
            `
Current linter output:
\`\`\`
${await this.contextManager.getLinterOutput(this.env)}
\`\`\`
Please, generate a plan to achieve the following objective: "${this.contextManager.objective}".
Don't make the todos too small. "Refactor ... to be ..." is a good level of granularity.
First, think about how to achieve it using the tools available, then write down the plan using the set_todos() tool. After that, write '<DONE/>'

${planning_examples}`,
            undefined,
            undefined,
            "",
            "set_todos"
        );
    }

    async executeATask() {
        let currentTask = this.contextManager.getFirstTodo()!;
        let { result } = await this.oneStep(
            `Please, take the workspace structure above and this task: "${currentTask}" and provide a plan for achieving the task, the summary of the aspects of workspace structure relevant to the task, and the list of relevant files.
Also, select advice out of the list below that might be relevant. You can select a lot; if the task will envolve patching, repeat everything from the patching section, including the examples; include all the general advice. If the files involved are small, tell the agent not to patch and to write instead. Here is the entire advice (it's fine to copy it entirely):
\`\`\`
${task_prompts}
\`\`\`
`,
            { plan: "", relevantSummary: "", pathList: "folder1/file1.txt\nanotherfile.py", relevantAdvice: "" },
            "Declare the task parameters",
            "",
            ["set_todos"],
            "random_sonnet_opus"
            // sonnet_model
        );
        let additionalContext = "";
        if (result) {
            // The course of actions for the task:\n${result.plan}\n
            additionalContext = `Some relevant facts: ${result.relevantSummary}\nSome advice that might be relevant:\n${result.relevantAdvice}\nThe list of relevant files is: ${result.pathList}`;
            console.log(clc.blue.bold("Additional context for the task:\n") + clc.green(additionalContext) + '\n');
            // now, the files themselves
            let files = result.pathList.split("\n");
            for (let file of files) {
                let fileContent = (await this.env.getFileSystem()).getByPath(file)?.content;
                additionalContext += `\n<path>${file}</path>\n<content>${fileContent}</content>`;
            }
            additionalContext += '\n';
        }
        this.contextManager.history.push({ type: "system", content: `Executing the task: "${currentTask}"` } as Message);
        await this.run(
            `Please, execute the following task: "${currentTask}". After everything is finished, write <DONE/>.`,
            undefined,
            undefined,
            additionalContext,
            undefined,
            ["set_todos"],
            sonnet_model
        );
    }

    async reflection() {
        let currentTask = this.contextManager.getFirstTodo()!;
        await this.run(
            `Above, some actions were taken to achieve the task: "${currentTask}". Please, reflect on the actions taken and the results achieved. 
If everything is well, use set_todos() to update the plan marking this task as done. If some new information was discovered, you can edit the next steps of the plan.
If the task wasn't achieved, update the plan in order to achieve the objective successfully: re-attempting this task with the new information, or trying another way.
If some damage was done while trying to complete the task, add a task specifying how to fix it.
Look at the linter output below, look at the workspace structure above to check that everything is ok (not just the history). If the agent was supposed to write to a file, check that the file contents are correct and that the task was completed.
If there are linter errors, add a task to fix them.

In the new plan, don't make the todos too small. "Refactor ... to be ..." is a good level of granularity.
It's fine if the new plan is the same as the old one, but with the current task marked as done.
It's also fine if the new plan only has one or two todos. If the objective is complete, set_todos() with all the todos marked as done.
Start by writing your analysis of the situation, then write the new plan using the set_todos() tool. After that, write '<DONE/>'

Previous linter output:
\`\`\`
${this.contextManager.lastLinterOutput}
\`\`\`
Linter output:
\`\`\`
${await this.contextManager.getLinterOutput(this.env)}
\`\`\`
`,
            undefined,
            undefined,
            undefined,
            "set_todos",
            undefined,
            // sonnet_model
        );
        console.log("Linter output:\n\n", this.contextManager.lastLinterOutput);
    }

    async fullCycle() {
        await this.generatePlan();
        console.log(clc.blue.bold("Plan generated:\n") + clc.green(this.contextManager.todos.join('\n')) + '\n');
        while (this.contextManager.getFirstTodo()) {
            console.log(clc.blue.bold("Executing the plan...\n") + clc.green(this.contextManager.getFirstTodo()) + '\n');
            await this.executeATask();
            console.log(clc.blue.bold("Reflecting on the actions taken...\n"));
            await this.reflection();
            console.log(clc.blue.bold("Current plan:\n") + clc.green(this.contextManager.todos.join('\n')) + '\n');
        }
    }

    async simpleApproach() {
        return await this.run(
            'Please, achieve the objective using the tools available. Read the files needed to understand the issue in one <function_calls> call, state your ideas to fix it, write the files to fix it. After, write <DONE/>.',
            undefined,
            undefined,
            "",
            undefined,
            ["set_todos", "run_shell_command", "patch_file", "set_memory", "remember"],
            opus_model,   // haiku_model,
            7
        )
    }
}
