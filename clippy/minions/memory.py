from .base_minion import BaseMinion
from dataclasses import dataclass


@dataclass
class Memory(BaseMinion):
    """
    The minion responsible for:
    - Saving stuff to the memory
    - Retrieving stuff from the memory
    """
