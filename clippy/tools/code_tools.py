from .tool import Tool, Toolkit
from dataclasses import dataclass


@dataclass
class FindUsages(Tool):
    pass


@dataclass
class Search(Tool):
    pass


@dataclass
class SearchAndReplace(Tool):
    pass


@dataclass
class CodeTools(Toolkit):
    def __init__(self):
        super().__init__(
            name="code tools",
            tools=[
                FindUsages(),
                Search(),
                SearchAndReplace()
            ]
        )
