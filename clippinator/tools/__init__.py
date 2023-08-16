import os

from langchain.agents import Tool
from langchain.tools import BaseTool
from langchain.utilities import SerpAPIWrapper

from clippinator.project import Project
from .architectural import Remember, TemplateInfo, TemplateSetup, SetCI, DeclareArchitecture
from .browsing import SeleniumTool, GetPage
from .code_tools import SearchInFiles, Pylint
from .file_tools import WriteFile, ReadFile, PatchFile, SummarizeFile
from .terminal import RunBash, BashBackgroundSessions, RunPython
from .tool import HumanInputTool, HTTPGetTool, SimpleTool

tool_cache = {}


def fixed_tools(project: Project) -> list[SimpleTool]:
    if project.path in tool_cache:
        return tool_cache[project.path]
    result = [
        ReadFile(project.path),
        PatchFile(project.path),
        SummarizeFile(project.path),
        HumanInputTool(),
        Pylint(project.path),
        SeleniumTool(),
        HTTPGetTool(),
        GetPage(),
        TemplateInfo(),
        TemplateSetup(project),
    ]
    tool_cache[project.path] = result
    return result


def get_tools(project: Project, try_structured: bool = False) -> list[BaseTool]:
    tools = [

                Tool(
                    name="Bash",
                    func=RunBash(workdir=project.path).run,
                    description="allows you to run bash commands in the project directory. "
                                "The input must be a valid bash command that will not ask for input and will terminate.",
                ),
                Tool(
                    name="Python",
                    func=RunPython(workdir=project.path).run,
                    description="allows you to run python code and get everything that's "
                                "printed (e.g. print(2+2) will give you 4) in order to compute something. "
                                "The input is correct python code.",
                ),
                # Tool(
                #     name="Wolfram Alpha",
                #     func=WolframAlphaAPIWrapper().run,
                #     description="allows you to ask questions about math, science, solve equations, and more. "
                #                 "The question should be strictly defined, like 'what is the derivative of x^2' or "
                #                 "'what is the capital of France'",
                # ),
                # Tool(
                #     name="Wait",
                #     func=lambda t: time.sleep(float(t)) or "",
                #     description="allows you to wait for a certain amount of time "
                #     "- to wait for the result of some process you ran.",
                # ),

                WriteFile(project).get_tool(try_structured),
                Remember(project).get_tool(try_structured),
                SetCI(project).get_tool(try_structured),
                # SearchInFiles(project.path).get_tool(),
                BashBackgroundSessions(project.path).get_tool(try_structured),
                DeclareArchitecture(project).get_tool(try_structured),
            ] + [tool_.get_tool(try_structured) for tool_ in fixed_tools(project)]
    if os.environ.get('SERPAPI_API_KEY'):
        tools.append(Tool(
            name="Search",
            func=SerpAPIWrapper().run,
            description="useful for when you need to answer simple questions and get a simple answer. "
                        "You cannot read websites or click on any links or read any articles.",
        ))
    return tools
