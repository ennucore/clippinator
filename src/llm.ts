import Anthropic from '@anthropic-ai/sdk';
import { XMLParser } from 'fast-xml-parser';
import { ToolCall } from './toolbox';

import { config } from 'dotenv';
config();
var clc = require("cli-color");

/* HAIKU_API_KEY if exists, otherwise ANTHROPIC_API_KEY */
const haiku_key = process.env.HAIKU_API_KEY || process.env.ANTHROPIC_API_KEY;
const anthropic_key = process.env.ANTHROPIC_API_KEY;

export interface Tool {
    function: {
        name: string;
        description?: string;
        parameters?: Record<string, any>;
    };
}

const haiku_model = "claude-3-haiku-20240307";
const opus_model = "claude-3-opus-20240229";

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

    const toolUseSystemPrompt = `In this environment you have access to a set of tools you can use to execute the user's request.

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
        return strip ? content.trim() : content;
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
    preprompt: string = ''
): Promise<{ toolCalls: { name: string, arguments: Record<string, any> }[], toolResults: string[], response: string, toolCallsFull: ToolCall[] }> {
    const anthropic = new Anthropic({ apiKey: anthropic_key });
    const toolCallingSystemPrompt = constructToolUseSystemPrompt(tools);
    // console.log(prompt);

    const stream = await anthropic.messages.create({
        max_tokens: 4096,
        messages: [
            {
                role: 'user',
                content: preprompt + '\n' + toolCallingSystemPrompt + '\n\n' + prompt,
            },
        ],
        model: opus_model,
        stream: true,
        stop_sequences: ['</function_calls>'],
    });

    let response = '';
    let currentToolName = '';
    let currentToolArguments: Record<string, any> = {};
    let toolCalls = [];
    let toolResults = [];
    let last_handled_length = 0;
    let toolCallsFull = [];

    for await (const messageStreamEvent of stream) {
        if (messageStreamEvent.type === 'content_block_delta') {
            response += messageStreamEvent.delta.text;

            if (response.includes('<tool_name>', last_handled_length)) {
                let extracted = extractBetweenTags('tool_name', response);
                currentToolName = extracted[extracted.length - 1];
                currentToolArguments = {};
            }

            const parameterMatches = response.slice(last_handled_length).match(/<parameters>([\s\S]*?)<\/parameters>/g);
            if (parameterMatches) {
                const parameterBlock = parameterMatches[0];
                const parser = new XMLParser();
                const json = parser.parse(parameterBlock);
                if (json.parameters) {
                    Object.entries(json.parameters).forEach(([parameterName, parameterValue]) => {
                    if (onParameterValue) {
                        onParameterValue(currentToolName, currentToolArguments, parameterName, parameterValue);
                    }
                    currentToolArguments[parameterName] = parameterValue;
                    });
                }
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
    }
    // remove the function calls from response
    response = response.replace(/<function_calls>[\s\S]*<\/invoke>/, '');
    return { toolCalls, toolResults, response, toolCallsFull };
}


export async function callLLM(prompt: string,): Promise<string> {
    const anthropic = new Anthropic();
    const message = await anthropic.messages.create({
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        model: 'claude-3-opus-20240229',
    });
    return message.content[0].text;
}


export async function callLLMFast(prompt: string): Promise<string> {
    const anthropic = new Anthropic({ apiKey: haiku_key });
    const message = await anthropic.messages.create({
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
        model: haiku_model,
    });
    return message.content[0].text;
}
