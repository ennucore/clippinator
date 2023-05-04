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
)
from .executioner import Executioner, get_specialized_executioners
from .prompts import taskmaster_prompt


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
    def __init__(self, project: Project, model: str = "gpt-3.5-turbo"):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        llm = get_model(model)
        tools = get_tools(project)
        tools.append(DeclareArchitecture(project).get_tool())
        agent_tool_names = [tool.name for tool in tools]
        agent_tool_names.remove('PatchFile')

        tools.append(
            Subagent(
                project, get_specialized_executioners(project), Executioner(project)
            ).get_tool()
        )
        tools.append(WarningTool().get_tool())

        prompt = CustomPromptTemplate(
            template=taskmaster_prompt,
            tools=tools,
            input_variables=extract_variable_names(
                taskmaster_prompt, interaction_enabled=True
            ),
            agent_toolnames=agent_tool_names,
        )

        llm_chain = LLMChain(llm=llm, prompt=prompt)

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
