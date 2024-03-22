import Anthropic from '@anthropic-ai/sdk';
import { XMLParser } from 'fast-xml-parser';
import { ToolCall, all_possible_parameter_names } from './toolbox';
import OpenAI from "openai"

import { config } from 'dotenv';
import { hashString, loadCache, saveCache } from './utils';
config();
var clc = require("cli-color");

/* HAIKU_API_KEY if exists, otherwise ANTHROPIC_API_KEY */
const haiku_key = process.env.HAIKU_API_KEY || process.env.ANTHROPIC_API_KEY;
const anthropic_key = process.env.ANTHROPIC_API_KEY;
const openai_key = process.env.OPEN_API_KEY;
const openai_base = process.env.OPENAI_BASE || "https://openrouter.ai/api/v1";   // we actually use openrouter instead
export const use_open = anthropic_key ? false : true;

let open_client = new OpenAI({
    apiKey: openai_key || "sk-no-key",
    baseURL: openai_base,
})

let openai_client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "sk-no-key", // defaults to process.env["OPENAI_API_KEY"]
    baseURL: process.env.OPENAI_BASE,
});

export interface Tool {
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
    };
}

export const haiku_model = use_open ? "anthropic/claude-3-haiku:beta" : "claude-3-haiku-20240307";
export const opus_model = use_open ? "anthropic/claude-3-opus:beta" : "claude-3-opus-20240229";
export const sonnet_model = use_open ? "anthropic/claude-3-sonnet:beta" : "claude-3-sonnet-20240229";

function constructFormatToolForClaudePrompt(
    name: string,
    description: string,
    parameters: Record<string, any>
): string {
    const parameterStr = Object.entries(parameters)
        .map(([key, value]) => `<${key}>${value}</${key}>`)
        .join('\n');

    return `<tool>
<name>${name}</name>
<description>${description}</description>
<parameters>
${parameterStr}
</parameters>
</tool>`;
}

function constructToolUseSystemPrompt(tools: Tool[]): string {
    const toolStrList = tools.map((tool) =>
        constructFormatToolForClaudePrompt(
            tool.function.name,
            tool.function.description || '',
            tool.function.parameters || {}
        )
    );

    const toolUseSystemPrompt = `In this environment you have access to a set of tools you can use to execute the user's request. Nothing is actually done until you call the tools and get the result.

You may call them like this:
<function_calls>
<invoke>
<tool_name>$TOOL_NAME</tool_name>
<parameters>
<$PARAMETER_NAME>$PARAMETER_VALUE</$PARAMETER_NAME>
...
</parameters>
</invoke>
<invoke>
<tool_name>$NEXT_TOOL_NAME</tool_name>
<parameters>
<$PARAMETER_NAME>$PARAMETER_VALUE</$PARAMETER_NAME>
...
</parameters>
</invoke>
</function_calls>

Here are the tools available:
<tools>
${toolStrList.join('\n')}
</tools>`;

    return toolUseSystemPrompt;
}

function extractBetweenTags(tag: string, str: string, strip: boolean = false): string[] {
    const regex = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g');
    const matches = str.match(regex);
    if (matches) {
        return matches.map((match) => {
            const content = match.replace(new RegExp(`</?${tag}>`, 'g'), '');
            return strip ? content : content;
        });
    }
    return [];
}

function parseXmlParams(xmlContent: string): Record<string, any> {
    const parser = new XMLParser();
    const json = parser.parse(xmlContent);
    return json.parameters;
}

export async function callLLMTools(
    prompt: string,
    tools: Tool[],
    onToolCall: (toolName: string, toolArguments: Record<string, any>) => Promise<string>,
    onParameterValue?: (toolName: string, currentToolArguments: Record<string, any>, parameterName: string, parameterValue: any) => void,
    preprompt: string = '',
    model: string = opus_model
): Promise<{ toolCalls: { name: string, arguments: Record<string, any> }[], toolResults: string[], response: string, toolCallsFull: ToolCall[] }> {
    const anthropic = new Anthropic({ apiKey: anthropic_key });
    const toolCallingSystemPrompt = constructToolUseSystemPrompt(tools);
    // console.log(prompt);
    if (model === "random_sonnet_opus") {
        Math.random() > 0.63 ? model = opus_model : model = sonnet_model;
    }

    let stream;
    if (!use_open) {
        stream = await anthropic.messages.create({
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: preprompt + '\n' + toolCallingSystemPrompt + '\n\n' + prompt,
                },
            ],
            model,
            stream: true,
            stop_sequences: ['</function_calls>'],
        });
    } else {
        stream = await open_client.chat.completions.create({
            model,
            messages: [{ role: "user", content: preprompt + '\n' + toolCallingSystemPrompt + '\n\n' + prompt }],
            stream: true,
            stop: "</function_calls>"
        })
    }


    let response = '';
    let currentToolName = '';
    let currentToolArguments: Record<string, any> = {};
    let toolCalls = [];
    let toolResults = [];
    let last_handled_length = 0;
    let toolCallsFull = [];

    for await (const messageStreamEvent of stream) {
        if (!use_open && (messageStreamEvent as any).type === 'content_block_delta') {
            response += (messageStreamEvent as any).delta.text;
        }
        if (use_open && (messageStreamEvent as any).choices[0]?.delta?.content) {
            response += (messageStreamEvent as any).choices[0].delta.content || '';
        }

        if (response.includes('<tool_name>', last_handled_length)) {
            let extracted = extractBetweenTags('tool_name', response);
            currentToolName = extracted[extracted.length - 1];
            currentToolArguments = {};
        }

        const parameterMatches = response.slice(last_handled_length).match(/<parameters>([\s\S]*?)<\/parameters>/g);
        if (parameterMatches) {
            const parameterBlock = parameterMatches[0];
            // const parser = new XMLParser();
            // const json = parser.parse(parameterBlock);
            // if (json.parameters) {
            //     Object.entries(json.parameters).forEach(([parameterName, parameterValue]) => {
            //     if (onParameterValue) {
            //         onParameterValue(currentToolName, currentToolArguments, parameterName, parameterValue);
            //     }
            //     currentToolArguments[parameterName] = parameterValue;
            //     });
            // }
            all_possible_parameter_names.forEach((parameterName) => {
                const valueMatches = parameterBlock.match(new RegExp(`<${parameterName}>[\\s\\S]*?</${parameterName}>`, 'g'));
                if (valueMatches) {
                    const value = valueMatches[0].replace(new RegExp(`</?${parameterName}>`, 'g'), '');
                    if (onParameterValue) {
                        onParameterValue(currentToolName, currentToolArguments, parameterName, value);
                    }
                    currentToolArguments[parameterName] = value;
                }
            });
        }

        if (response.includes('</invoke>', last_handled_length)) {
            console.log(response)
            console.log(clc.green('Calling tool'), currentToolName, currentToolArguments);
            let result = await onToolCall(currentToolName, currentToolArguments);
            toolCalls.push({ name: currentToolName, arguments: currentToolArguments });
            toolResults.push(result);
            console.log(result)
            last_handled_length = response.indexOf('</invoke>', last_handled_length) + 1;
            toolCallsFull.push({ tool_name: currentToolName, parameters: currentToolArguments, result } as ToolCall);
        }

    }
    // remove the function calls from response
    response = response.replace(/<function_calls>[\s\S]*<\/invoke>/, '');
    return { toolCalls, toolResults, response, toolCallsFull };
}


export async function callLLM(prompt: string, model: string = opus_model): Promise<string> {
    if (use_open) {
        const response = await open_client.chat.completions.create({
            model: opus_model,
            messages: [{ role: "user", content: prompt }],
        })
        return response.choices[0].message.content || "";
    }
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        model,
    });
    return message.content[0].text;
}

let fastCallCache: Record<string, string> = loadCache('.fastCallCache.json');


export async function callLLMFast(prompt: string, model: string = haiku_model, stop_token?: string, require_stop_token: boolean = false, assistant_message_predicate?: string): Promise<string> {
    let promptHash = hashString(prompt);
    if (fastCallCache[promptHash]) {
        return fastCallCache[promptHash];
    }
    let messages: any = [{ role: "user", content: prompt }];
    if (assistant_message_predicate) {
        messages.push({ role: "assistant", content: assistant_message_predicate });
    }
    let res = assistant_message_predicate ? assistant_message_predicate : "";
    if (use_open) {
        const response = await open_client.chat.completions.create({
            model: haiku_model,
            messages,
            stop: stop_token,
        })
        res += response.choices[0].message.content || "";
        if ((response.choices[0] as any).finish_reason == "stop_sequence") {
            res += stop_token;
        }

    } else {
        const anthropic = new Anthropic({ apiKey: haiku_key });
        const message = await anthropic.messages.create({
            max_tokens: 4096,
            messages,
            model,
        });
        res += message.content[0].text;
        res += message.stop_reason || "";
    }
    if (require_stop_token && !res.includes(stop_token!) && res.length < 30000) {
        // we continue until we get the stop token
        console.log("Continuing generation");
        res = await callLLMFast(prompt, model, stop_token, require_stop_token, assistant_message_predicate);
    }
    fastCallCache[promptHash] = res;
    saveCache(fastCallCache, '.fastCallCache.json');
    return res;
}

export async function callOpenAIStructured(prompt: string, format: OpenAI.FunctionParameters, model: string = "gpt-4-0125-preview") {
    const response = await openai_client.chat.completions.create({
        model,
        messages: [{
            role: "user", content: prompt,
        }],
        tools: [{
            type: "function",
            function: {
                name: "result",
                parameters: format
            }
        }],
        tool_choice: {
            type: "function",
            function: {
                name: "result",
            }
        }
    })
    // we need the tool call arguments
    return JSON.parse(response.choices[0].message.tool_calls![0].function.arguments);
}
