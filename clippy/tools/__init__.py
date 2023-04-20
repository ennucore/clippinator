from langchain.agents import Tool
from langchain.tools import BaseTool
from .terminal import RunBash
from .file_tools import WriteFile, ReadFile, PatchFile, SummarizeFile
from .code_tools import SearchInFiles, Pylint
from .tool import HumanInputTool
from langchain.utilities import PythonREPL
from langchain.utilities import WolframAlphaAPIWrapper
from langchain.utilities import SerpAPIWrapper
import time

from clippy.project import Project


def get_tools(project: Project) -> list[BaseTool]:
    search = SerpAPIWrapper(params={"engine": "google"})
    tools = [
        # Tool(
        #     name="Google Search",
        #     func=search.run,
        #     description="useful for when you need to answer simple questions and get a simple answer. "
        #     "You cannot read websites or click on any links or read any articles.",
        # ),
        Tool(
            name="Bash",
            func=RunBash(workdir=project.path).run,
            description="allows you to run bash commands in the project directory. "
                        "The input must be a valid bash command that will not ask for input and will terminate.",
        ),
        Tool(
            name="Python",
            func=PythonREPL().run,
            description="allows you to run python code and get everything that's "
            "printed (e.g. print(2+2) will give you 4) in order to compute something. "
            "The input is correct python code.",
        ),
        Tool(
            name="Wolfram Alpha",
            func=WolframAlphaAPIWrapper().run,
            description="allows you to ask questions about math, science, solve equations, and more. "
            "The question should be strictly defined, like 'what is the derivative of x^2' or "
            "'what is the capital of France'",
        ),
        # Tool(
        #     name="Wait",
        #     func=lambda t: time.sleep(float(t)) or "",
        #     description="allows you to wait for a certain amount of time "
        #     "- to wait for the result of some process you ran.",
        # ),
        WriteFile(project.path).get_tool(),
        ReadFile(project.path).get_tool(),
        PatchFile(project.path).get_tool(),
        SummarizeFile(project.path).get_tool(),
        HumanInputTool().get_tool(),
        Pylint(project.path).get_tool(),
        SearchInFiles(project.path).get_tool(),
    ]
    return tools
