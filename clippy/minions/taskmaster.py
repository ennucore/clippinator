from langchain import LLMChain
from langchain.agents import AgentExecutor, LLMSingleActionAgent, Tool
from langchain.prompts import StringPromptTemplate

from .base_minion import CustomPromptTemplate, CustomOutputParser, extract_variable_names, get_model
from clippy.project import Project
from clippy.tools import get_tools
from langchain.schema import BaseMemory
from langchain.memory import ConversationSummaryMemory
from .executioner import Executioner, get_specialized_executioners
from .prompts import taskmaster_prompt
from typing import List, Dict, Any


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
        return {"project_summary": self.project.get_project_summary(),
                "summary": self.summary_buffer.load_memory_variables(inputs)["history"]}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, str]) -> None:
        self.summary_buffer.save_context(inputs, outputs)


class TaskmasterPromptTemplate(StringPromptTemplate):
    template: str
    # The list of tools available
    tools: List[Tool]

    @property
    def _prompt_type(self) -> str:
        return 'taskmaster'

    def format(self, **kwargs) -> str:
        # Get the intermediate steps (AgentAction, AResult tuples)
        # Format them in a particular way
        intermediate_steps = kwargs.pop("intermediate_steps")
        thoughts = ""
        for action, AResult in intermediate_steps:
            thoughts += action.log
            thoughts += f"\nAResult: {AResult}\nThought: "
            if len(thoughts) > 2000:
                break
        kwargs["tools"] = "\n".join(
            [f"{tool.name}: {tool.description}" for tool in self.tools]
        )
        kwargs["agent_scratchpad"] = thoughts
        kwargs["tool_names"] = ", ".join([tool.name for tool in self.tools])
        result = self.template.format(**kwargs)
        return result


class Taskmaster:
    def __init__(self, project: Project, model: str = 'gpt-4'):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        llm = get_model(model)
        tools = get_tools(project)
        prompt = CustomPromptTemplate(
            template=taskmaster_prompt,
            tools=tools,
            input_variables=extract_variable_names(
                taskmaster_prompt, interaction_enabled=True
            ),
        )

        llm_chain = LLMChain(llm=llm, prompt=prompt)

        output_parser = CustomOutputParser()

        tool_names = [tool.name for tool in tools]

        agent = LLMSingleActionAgent(
            llm_chain=llm_chain,
            output_parser=output_parser,
            stop=["AResult:"],
            allowed_tools=tool_names,
        )

        self.agent_executor = AgentExecutor.from_agent_and_tools(
            agent=agent, tools=tools, verbose=True
        )

    def run(self, **kwargs):
        kwargs["feedback"] = kwargs.get("feedback", "")
        return self.agent_executor.run(**kwargs) or 'No result. The execution was probably unsuccessful.'
