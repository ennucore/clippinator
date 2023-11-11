from __future__ import annotations

import os
import pickle

from langchain import LLMChain
from langchain.agents import AgentExecutor, LLMSingleActionAgent

from clippinator.project import Project
from clippinator.tools import get_tools, SimpleTool
from clippinator.tools.subagents import Subagent
from clippinator.tools.tool import WarningTool
from .base_minion import (
    CustomOutputParser,
    CustomPromptTemplate,
    extract_variable_names,
    get_model,
    BasicLLM,
)
from .executioner import Executioner, get_specialized_executioners
from .prompts import taskmaster_prompt, summarize_prompt, format_description, get_selfcall_objective
from ..tools.utils import ask_for_feedback


class Taskmaster:
    def __init__(
            self,
            project: Project,
            model: str = "gpt-4-1106-preview",
            prompt: CustomPromptTemplate | None = None,
            inner_taskmaster: bool = False
    ):
        self.project = project
        self.specialized_executioners = get_specialized_executioners(project)
        self.default_executioner = Executioner(project)
        self.inner_taskmaster = inner_taskmaster
        llm = get_model(model)
        tools = get_tools(project)
        tools.append(SelfCall(project).get_tool(try_structured=False))

        agent_tool_names = [
            'DeclareArchitecture', 'ReadFile', 'WriteFile', 'Bash', 'BashBackground', 'Human',
            'Remember', 'TemplateInfo', 'TemplateSetup', 'SetCI', 'Search'
        ]

        if not inner_taskmaster:
            agent_tool_names.append('SelfCall')

        tools.append(
            Subagent(
                project, self.specialized_executioners, self.default_executioner
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
            feedback = ask_for_feedback(lambda: self.project.menu(self.prompt))
            if feedback:
                self.prompt.intermediate_steps += [feedback]
            return self.run(**kwargs)

    def save_to_file(self, path: str = ""):
        if not os.path.exists(self.project.path):
            return
        path = path or os.path.join(self.project.path, f".clippinator.pkl")
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
    def load_from_file(cls, path: str = ".clippinator.pkl"):
        with open(path, "rb") as f:
            prompt, project = pickle.load(f)
        self = cls(project)
        self.prompt.current_context_length = prompt["current_context_length"]
        self.prompt.model_steps_processed = prompt["model_steps_processed"]
        self.prompt.all_steps_processed = prompt["all_steps_processed"]
        self.prompt.intermediate_steps = prompt["intermediate_steps"]
        self.prompt.last_summary = prompt["last_summary"]
        return self


class SelfCall(SimpleTool):
    name = "SelfCall"
    description = "Initializes the component of the project. " \
                  "It's highly advised to use this tool for each subfolder from the " \
                  "\"planned project architecture\" by Architect when this subfolder does not exist in the " \
                  "current state of project (all folders and files) (or the project structure is empty). " \
                  "It's A MUST to use this tool right after the Subagent @Architect for every subfolder " \
                  "from the \"planned project architecture\"." \
                  "Input parameter - name of the subfolder, a relative path to subfolder from the current location."

    def __init__(self, project: Project):
        self.initial_project = project
        super().__init__()

    def structured_func(self, sub_folder: str):
        sub_project_path = self.initial_project.path + (
            "/" if not self.initial_project.path.endswith("/") else "") + sub_folder
        cur_objective = self._get_resulting_objective(self.initial_project, sub_folder)
        cur_sub_project = Project(sub_project_path, cur_objective, architecture="")
        taskmaster = Taskmaster(cur_sub_project, inner_taskmaster=True)
        taskmaster.run(**cur_sub_project.prompt_fields())
        return f"{sub_folder} folder processed."

    def func(self, args: str):
        sub_folder = args.strip()
        return self.structured_func(sub_folder)

    @staticmethod
    def _get_resulting_objective(initial_project: Project, sub_folder: str) -> str:
        return get_selfcall_objective(
            initial_project.objective,
            initial_project.architecture,
            sub_folder
        )
