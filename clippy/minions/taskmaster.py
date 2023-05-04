from typing import List, Dict, Any, Union

from langchain import LLMChain
from langchain.agents import AgentExecutor, LLMSingleActionAgent, Tool
from langchain.callbacks.base import BaseCallbackHandler
from langchain.memory import ConversationSummaryMemory
from langchain.prompts import StringPromptTemplate
from langchain.schema import AgentAction, AgentFinish, LLMResult
from langchain.schema import BaseMemory

from clippy.project import Project
from clippy.tools import get_tools
from clippy.tools.tool import WarningTool
from clippy.tools.subagents import Subagent, DeclareArchitecture
from .base_minion import (
    CustomPromptTemplate,
    CustomOutputParser,
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


class TaskmasterPromptTemplate(StringPromptTemplate):
    template: str
    # The list of tools available
    tools: List[Tool]
    agent_toolnames: List[str]

    @property
    def _prompt_type(self) -> str:
        return "taskmaster"

    def format(self, **kwargs) -> str:
        # Get the intermediate steps (AgentAction, AResult tuples)
        # Format them in a particular way
        intermediate_steps = kwargs.pop("intermediate_steps")
        thoughts = ""
        for action, AResult in intermediate_steps[::-1]:
            thoughts = action.log + f"\nAResult: {AResult}\nThought: " + thoughts
            if len(thoughts) > 2000:
                break
        kwargs["tools"] = "\n".join(
            [f"{tool.name}: {tool.description}" for tool in self.tools]
        )
        kwargs["agent_scratchpad"] = thoughts
        kwargs["tool_names"] = self.agent_toolnames
        result = self.template.format(**kwargs)
        return result


<<<<<<< Updated upstream
=======
class CallbackHandler(BaseCallbackHandler):
    agent: LLMSingleActionAgent
    memory: CustomMemory

    def __init__(self, agent: LLMSingleActionAgent, memory: CustomMemory):
        self.agent = agent
        self.memory = memory

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], **kwargs: Any
    ) -> Any:
        """Run when LLM starts running."""

    def on_llm_new_token(self, token: str, **kwargs: Any) -> Any:
        """Run on new LLM token. Only available when streaming is enabled."""

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> Any:
        """Run when LLM ends running."""

    def on_llm_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        """Run when LLM errors."""

    def on_chain_start(
        self, serialized: Dict[str, Any], inputs: Dict[str, Any], **kwargs: Any
    ) -> Any:
        """Run when chain starts running."""

    def on_chain_end(self, outputs: Dict[str, Any], **kwargs: Any) -> Any:
        """Run when chain ends running."""

    def on_chain_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        """Run when chain errors."""

    def on_tool_start(
        self, serialized: Dict[str, Any], input_str: str, **kwargs: Any
    ) -> Any:
        """Run when tool starts running."""

    def on_tool_end(self, output: str, **kwargs: Any) -> Any:
        """Run when tool ends running."""

    def on_tool_error(
        self, error: Union[Exception, KeyboardInterrupt], **kwargs: Any
    ) -> Any:
        """Run when tool errors."""

    def on_agent_action(self, action: AgentAction, **kwargs: Any) -> Any:
        """Run on agent action."""

    def on_agent_finish(self, finish: AgentFinish, **kwargs: Any) -> Any:
        """Run on agent end."""

    def on_text(self, text: str, **kwargs: Any) -> Any:
        """Run on arbitrary text."""


>>>>>>> Stashed changes
class Taskmaster:
    def __init__(self, project: Project, model: str = "gpt-3.5-turbo"):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        llm = get_model(model)
        tools = get_tools(project)
<<<<<<< Updated upstream
        tools.append(DeclareArchitecture(project).get_tool())
        tool_names = [tool.name for tool in tools]

        tools.append(
            Subagent(
                project, get_specialized_executioners(project), Executioner(project)
            ).get_tool()
        )
        tools.append(WarningTool().get_tool())

        prompt = TaskmasterPromptTemplate(
=======

        prompt = CustomPromptTemplate(
>>>>>>> Stashed changes
            template=taskmaster_prompt,
            tools=tools,
            input_variables=extract_variable_names(
                taskmaster_prompt, interaction_enabled=True
            ),
            agent_toolnames=tool_names,
        )

        llm_chain = LLMChain(llm=llm, prompt=prompt)

        output_parser = CustomOutputParser()

<<<<<<< Updated upstream
=======
        tool_names = [tool.name for tool in tools]
>>>>>>> Stashed changes
        agent = LLMSingleActionAgent(
            llm_chain=llm_chain,
            output_parser=output_parser,
            stop=["AResult:"],
            allowed_tools=tool_names,
        )

        callback_manager = CallbackManager(handlers=[CallbackHandler()])
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
