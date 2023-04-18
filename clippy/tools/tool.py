import typing
from abc import ABC, abstractmethod
from dataclasses import dataclass
from langchain.tools.base import BaseTool


class Toolkit(BaseTool):
    name: str
    description: str
    tools: list[BaseTool]
    custom_description: str = None

    def __init__(self, name: str, tools: list[Tool], custom_description: str = None):
        self.name = name
        self.description = (self.custom_description.strip() or "a toolkit containing the following tools:") + '\n' + \
               "\n".join([f'  - {tool.name}: {tool.description()}' for tool in self.tools])
        self.tools = tools
        self.custom_description = custom_description or ''

    def _run(self, args: str) -> str:
        tool_name, args = args.split(' ', 1)
        tool = next((tool for tool in self.tools if tool.name == tool_name), None)
        if tool is None:
            return f'error: no tool named "{tool_name}" in toolkit "{self.name}"'
        return tool.run(args)
