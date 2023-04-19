import typing
from langchain.tools.base import BaseTool
from langchain.agents import Tool


class SimpleTool:
    name: str
    description: str
    func: typing.Callable[[str], str]

    def get_tool(self):
        return Tool(name=self.name, func=self.func, description=self.description)


class HumanInputTool(SimpleTool):
    name: str = "HumanInput"
    description: str = (
        "A tool that can be used to ask a human for something (only if it's required). "
        "For instance, it can be useful if you need some kind of API token."
    )

    @staticmethod
    def func(args: str) -> str:
        return input(args)
