import typing

import requests
from langchain.agents import Tool
from typer import prompt


class SimpleTool:
    name: str
    description: str
    func: typing.Callable[[str], str]

    def get_tool(self):
        return Tool(name=self.name, func=self.func, description=self.description)


class WarningTool(SimpleTool):
    name: str = "WarnAgent"
    description: str = "A tool that can be used to warn the agent about something."

    @staticmethod
    def func(args: str) -> str:
        return '\r' + args + '\n'


class HumanInputTool(SimpleTool):
    name: str = "HumanInput"
    description: str = (
        "A tool that can be used to ask a human for something (only if it's required). "
        "For instance, it can be useful if you need some kind of API token. Use only if absolutely necessary. "
    )

    @staticmethod
    def func(args: str) -> str:
        print()
        return prompt(args)


class HTTPGetTool(SimpleTool):
    name: str = "HTTPGet"
    description: str = (
        "A tool that can be used to make a HTTP GET request. "
        "The input format is just the url."
    )

    @staticmethod
    def func(args: str) -> str:
        url = args
        try:
            response = requests.get(url)
            return response.text
        except Exception as e:
            return str(e)
