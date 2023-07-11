import typing
from functools import wraps
from typing import Any

import requests
from langchain.agents import Tool
from langchain.tools import StructuredTool
from typer import prompt


def wrap_tool_function(func: typing.Callable[..., str]) -> typing.Callable[..., str]:
    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> str:
        try:
            return func(*args, **kwargs)
        except Exception as e:
            return f"Error: {e}"

    return wrapper


class SimpleTool:
    name: str
    description: str
    func: typing.Callable[[str], str]
    structured_func: typing.Callable[..., str] | None = None
    structured_desc: str | None = None
    args_schema: Any | None = None

    def get_tool(self, try_structured: bool = True) -> Tool | StructuredTool:
        if self.structured_func and try_structured:
            return StructuredTool.from_function(wrap_tool_function(self.structured_func),
                                                name=self.name,
                                                description=self.structured_desc or self.description,
                                                args_schema=self.args_schema)
        return Tool(name=self.name, func=wrap_tool_function(self.func), description=self.description)


class WarningTool(SimpleTool):
    name: str = "WarnAgent"
    description: str = "A tool that can be used to warn the agent about something."

    @staticmethod
    def func(args: str) -> str:
        return args + "\n"


class HumanInputTool(SimpleTool):
    name: str = "Human"
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
