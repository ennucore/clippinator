from langchain.agents import Tool
from langchain.utilities import BashProcess
from langchain.utilities import PythonREPL
from langchain.utilities import WolframAlphaAPIWrapper
from langchain.utilities import SerpAPIWrapper
import time


def get_tools() -> list[Tool]:
    search = SerpAPIWrapper(params={"engine": "google"})
    tools = [
        Tool(
            name="Google Search",
            func=search.run,
            description="useful for when you need to answer simple questions and get a simple answer. "
                        "You cannot read websites or click on any links or read any articles."
        ),
        Tool(
            name="Bash",
            func=BashProcess().run,
            description="allows you to run bash commands in the base directory"
        ),
        Tool(
            name="Python",
            func=PythonREPL().run,
            description="allows you to run python code and get everything that's "
                        "printed (e.g. print(2+2) will give you 4)"
        ),
        Tool(
            name="Wolfram Alpha",
            func=WolframAlphaAPIWrapper().run,
            description="allows you to ask questions about math, science, solve equations, and more. "
                        "The question should be strictly defined, like 'what is the derivative of x^2' or "
                        "'what is the capital of France'"),
        Tool(
            name="Wait",
            func=lambda t: time.sleep(float(t)) or '',
            description="allows you to wait for a certain amount of time "
                        "- to wait for the result of some process you ran.")
    ]
    return tools
