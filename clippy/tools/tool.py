import typing
from langchain.tools.base import BaseTool
from langchain.agents import Tool


class SimpleTool:
    name: str
    description: str
    func: typing.Callable[[str], str]

    def get_tool(self):
        return Tool(name=self.name, func=self.func, description=self.description)


class Toolkit(SimpleTool):
    name: str
    description: str
    tools: list[BaseTool]
    custom_description: str = ''

    def __init__(self, name: str, tools: list[BaseTool], custom_description: str = None):
        self.name = name
        self.tools = tools
        self.description = (
                                   self.custom_description.strip() or "a toolkit containing the following tools:"
                           ) + '\n' + "\n".join([f'  - {tool.name}: {tool.description}' for tool in tools])
        self.custom_description = custom_description or ''
        super().__init__()

    def func(self, args: str) -> str:
        tool_name, args = args.split(' ', 1)
        tool = next((tool for tool in self.tools if tool.name == tool_name), None)
        if tool is None:
            return f'error: no tool named "{tool_name}" in toolkit "{self.name}"'
        return tool.run(args)
