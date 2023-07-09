import os.path
import pickle

from langchain import LLMChain
from langchain.agents import AgentExecutor, LLMSingleActionAgent
from langchain.schema import AgentAction

from clippy.project import Project
from clippy.tools import get_tools
from clippy.tools.subagents import Subagent
from clippy.tools.tool import WarningTool
from .base_minion import (
    CustomOutputParser,
    CustomPromptTemplate,
    extract_variable_names,
    get_model,
    BasicLLM,
)
from .executioner import Executioner, get_specialized_executioners
from .prompts import taskmaster_prompt, summarize_prompt, format_description
from ..tools.architectural import DeclareArchitecture


class Taskmaster:
    def __init__(
            self,
            project: Project,
            model: str = "gpt-4",
            prompt: CustomPromptTemplate | None = None,
    ):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        llm = get_model(model)
        tools = get_tools(project)
        tools.append(DeclareArchitecture(project).get_tool())
        agent_tool_names = ['DeclareArchitecture', 'ReadFile', 'WriteFile', 'Bash', 'BashBackground', 'Human',
                            'Remember', 'TemplateInfo', 'TemplateSetup', 'SetCI']

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
            max_iterations=1000,  # We have summarization
        )

    def run(self, **kwargs):
        kwargs["specialized_minions"] = "\n".join(
            minion.expl() for minion in self.specialized_executioners.values()
        )
        kwargs["format_description"] = format_description
        try:
            return (
                    self.agent_executor.run(**kwargs)
                    or "No result. The execution was probably unsuccessful."
            )
        except KeyboardInterrupt:
            feedback = input("\nAI interrupted. Enter your feedback: ")
            self.prompt.intermediate_steps += [
                (
                    AgentAction(
                        tool="AgentFeedback",
                        tool_input="",
                        log="Here is feedback from your supervisor: ",
                    ),
                    feedback,
                )
            ]
            return self.run(**kwargs)

    def save_to_file(self, path: str = ""):
        if not os.path.exists(self.project.path):
            return
        path = path or os.path.join(self.project.path, f".clippy.pkl")
        with open(path, "wb") as f:
            prompt = {
                "current_context_length": self.prompt.current_context_length,
                "model_steps_processed": self.prompt.model_steps_processed,
                "all_steps_processed": self.prompt.all_steps_processed,
                "intermediate_steps": self.prompt.intermediate_steps,
                "last_summary": self.prompt.last_summary,
            }
            pickle.dump((prompt, self.project), f)

    @classmethod
    def load_from_file(cls, path: str = ".clippy.pkl"):
        with open(path, "rb") as f:
            prompt, project = pickle.load(f)
        self = cls(project)
        self.prompt.current_context_length = prompt["current_context_length"]
        self.prompt.model_steps_processed = prompt["model_steps_processed"]
        self.prompt.all_steps_processed = prompt["all_steps_processed"]
        self.prompt.intermediate_steps = prompt["intermediate_steps"]
        self.prompt.last_summary = prompt["last_summary"]
        return self
