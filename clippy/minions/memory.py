from .base_minion import BaseMinion
from dataclasses import dataclass, field
from langchain.vectorstores import FAISS


@dataclass
class Memory(BaseMinion):
    """
    The minion responsible for:
    - Saving stuff to the memory
    - Retrieving stuff from the memory
    """
    storage: FAISS = field(default_factory=FAISS)

    def save_snippet(self, snippet: str, src: str = ''):
        self.storage.add_texts([snippet], [{'src': src}])

    def retrieve(self, query: str, n: int = 5) -> list[(str, str)]:  # (snippet, src)
        return [(doc.page_content, doc.metadata.get('src', '')) for doc in self.storage.similarity_search(query, n)]
