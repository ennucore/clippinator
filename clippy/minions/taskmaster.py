import os.path
import pickle
from typing import List, Dict, Any

from langchain import LLMChain
from langchain.agents import AgentExecutor, LLMSingleActionAgent
from langchain.memory import ConversationSummaryMemory
from langchain.schema import BaseMemory

from clippy.project import Project
from clippy.tools import get_tools
from clippy.tools.subagents import Subagent, DeclareArchitecture
from clippy.tools.tool import WarningTool
from .base_minion import (
    CustomOutputParser,
    CustomPromptTemplate,
    extract_variable_names,
    get_model,
    BasicLLM,
)
from .executioner import Executioner, get_specialized_executioners
from .prompts import taskmaster_prompt, summarize_prompt


class CustomMemory(BaseMemory):
    """Memory class for storing information about entities."""

    def __init__(self, project: Project):
        super().__init__()
        self.project = project
        self.summary_buffer = ConversationSummaryMemory()

    def clear(self):
        self.summary_buffer.clear()

    @property
    def memory_variables(self) -> List[str]:
        """Define the variables we are providing to the prompt."""
        return ["project_summary", "summary"]

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, str]:
        """Load the memory variables, in this case the entity key."""
        return {
            "project_summary": self.project.get_project_summary(),
            "summary": self.summary_buffer.load_memory_variables(inputs)["history"],
        }

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, str]) -> None:
        self.summary_buffer.save_context(inputs, outputs)


class Taskmaster:
    def __init__(self, project: Project, model: str = "gpt-4", prompt: CustomPromptTemplate | None = None):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        llm = get_model(model)
        tools = get_tools(project)
        tools.append(DeclareArchitecture(project).get_tool())
        agent_tool_names = [tool.name for tool in tools if tool.name != "HTTPGet"]
        agent_tool_names.remove("PatchFile")

        tools.append(
            Subagent(
                project, get_specialized_executioners(project), Executioner(project)
            ).get_tool()
        )
        tools.append(WarningTool().get_tool())

        self.prompt = prompt or CustomPromptTemplate(
            template=taskmaster_prompt,
            tools=tools,
            input_variables=extract_variable_names(
                taskmaster_prompt, interaction_enabled=True
            ),
            agent_toolnames=agent_tool_names,
            my_summarize_agent=BasicLLM(base_prompt=summarize_prompt),
            project=project,
        )
        self.prompt.hook = lambda _: self.save_to_file()

        llm_chain = LLMChain(llm=llm, prompt=self.prompt)

        output_parser = CustomOutputParser()

        agent = LLMSingleActionAgent(
            llm_chain=llm_chain,
            output_parser=output_parser,
            stop=["AResult:"],
            allowed_tools=[tool.name for tool in tools],
        )
        self.agent_executor = AgentExecutor.from_agent_and_tools(
            agent=agent,
            tools=tools,
            verbose=True,
            max_iterations=1000  # We have summarization
        )

    def run(self, **kwargs):
        kwargs["feedback"] = kwargs.get("feedback", "")
        kwargs["specialized_minions"] = "\n".join(
            minion.expl() for minion in self.specialized_executioners.values()
        )
        return (
                self.agent_executor.run(**kwargs)
                or "No result. The execution was probably unsuccessful."
        )

    def save_to_file(self, path: str = ""):
        path = path or os.path.join(self.project.path, f".clippy.pkl")
        with open(path, "wb") as f:
            prompt = {
                'steps_since_last_summarize': self.prompt.steps_since_last_summarize,
                'last_summary': self.prompt.last_summary,
                'intermediate_steps': self.prompt.intermediate_steps,
            }
            pickle.dump((prompt, self.project), f)

    @classmethod
    def load_from_file(cls, path: str = ".clippy.pkl"):
        with open(path, "rb") as f:
            prompt, project = pickle.load(f)
        self = cls(project)
        self.prompt.steps_since_last_summarize = prompt['steps_since_last_summarize']
        self.prompt.last_summary = prompt['last_summary']
        self.prompt.intermediate_steps = prompt['intermediate_steps']
        return self
