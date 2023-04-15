from abc import ABC
from dataclasses import dataclass
from tool import Tool


@dataclass
class Terminal(Tool, ABC):
    """
    A tool that creates terminal sessions that can be used to run commands, even in the background.
    """
    # todo
