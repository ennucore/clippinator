from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Union, Callable, Any

from langchain import LLMChain, PromptTemplate
from langchain.agents import (
    Tool,
    AgentExecutor,
    LLMSingleActionAgent,
    AgentOutputParser,
)
from langchain.chat_models import ChatOpenAI
from langchain.prompts import StringPromptTemplate
from langchain.schema import AgentAction, AgentFinish

from clippy.tools.tool import WarningTool

long_warning = (
    "WARNING: You have been working for a very long time. Please, finish ASAP. "
    "If there are obstacles, please, return with the result and explain the situation."
)


class CustomOutputParser(AgentOutputParser):
    def parse(self, llm_output: str) -> Union[AgentAction, AgentFinish]:
        actions = [
            line.split(":", 1)[1].strip()
            for line in llm_output.splitlines()
            if line.startswith("Action:")
        ]
        # Check if agent should finish"
        if "Final Result:" in llm_output:
            if "Action" in llm_output:
                return AgentAction(
                    tool="WarnAgent",
                    tool_input=f"ERROR: Don't write 'Action' together with the Final Result. "
                    f"You need to REDO your action(s) ({', '.join(actions)}), "
                    f"receive the 'AResult' and only then write your 'Final Result'",
                    log=llm_output,
                )
            return AgentFinish(
                # Return values is generally always a dictionary with a single `output` key
                # It is not recommended to try anything else at the moment :)
                return_values={"output": llm_output.split("Final Result:")[-1].strip()},
                log=llm_output,
            )
        # Parse out the action and action input
        regex = r"Action\s*\d*\s*:(.*?)\nAction\s*\d*\s*Input\s*\d*\s*:[\s]*(.*)"
        match = re.search(regex, llm_output, re.DOTALL)
        if not match and llm_output.strip().split("\n")[-1].strip().startswith(
            "Thought:"
        ):
            return AgentAction(
                tool="WarnAgent",
                tool_input="don't stop after 'Thought:', continue with the next thought or action",
                log=llm_output,
            )

        if not match:
            if "Action:" in llm_output and "Action Input:" not in llm_output:
                return AgentAction(
                    tool="WarnAgent",
                    tool_input="No Action Input specified.",
                    log=llm_output,
                )
            else:
                return AgentAction(
                    tool="WarnAgent",
                    tool_input="Continue with your next thought or action. Do not repeat yourself. \n",
                    log=llm_output,
                )

        if llm_output.count("Action Input") > 1:
            return AgentAction(
                tool="WarnAgent",
                tool_input="ERROR: Write 'AResult: ' after each action. Execute ALL the past actions "
                f"without AResult again ({', '.join(actions)}), one-by-one. They weren't completed.",
                log=llm_output,
            )

        action = match.group(1).strip().strip("`").strip('"').strip("'").strip()
        action_input = match.group(2)
        if "\nThought: " in action_input or "\nAction: " in action_input:
            return AgentAction(
                tool="WarnAgent",
                tool_input="Error: Write 'AResult: ' after each action. "
                f"Execute all the actions without AResult again ({', '.join(actions)}).",
                log=llm_output,
            )
        if "Subagent" in action:
            action_input += " " + action.split("Subagent")[1].strip()
            action = "Subagent"

        # Return the action and action inputx
        return AgentAction(
            tool=action,
            tool_input=action_input.strip(" ").split("\nThought: ")[0],
            log=llm_output,
        )


def remove_project_summaries(text: str) -> str:
    """
    Remove all the project summaries from the text EXCEPT for the last occurrence
    The project summary is between "Current project state:" and "---"
    """
    # Find all the project summaries
    project_summaries = re.findall(r"Current project state:.*?---", text, re.DOTALL)
    # Remove all the project summaries except for the last one
    for project_summary in project_summaries[:-1]:
        text = text.replace(project_summary, "", 1)
    print(text)
    return text


def extract_variable_names(prompt: str, interaction_enabled: bool = False):
    variable_pattern = r"\{(\w+)\}"
    variable_names = re.findall(variable_pattern, prompt)
    if interaction_enabled:
        for name in ["tools", "tool_names", "agent_scratchpad"]:
            if name in variable_names:
                variable_names.remove(name)
        variable_names.append("intermediate_steps")
    return variable_names


def get_model(model: str = "gpt-3.5-turbo"):
    return ChatOpenAI(
        temperature=0 if model != "gpt-3.5-turbo" else 0.7,
        model_name=model,
        request_timeout=320,
    )


@dataclass
class BasicLLM:
    prompt: PromptTemplate
    llm: LLMChain

    def __init__(self, base_prompt: str, model: str = "gpt-4") -> None:
        llm = get_model(model)
        self.llm = LLMChain(
            llm=llm,
            prompt=PromptTemplate(
                template=base_prompt,
                input_variables=extract_variable_names(base_prompt),
            ),
        )

    def run(self, **kwargs):
        kwargs["feedback"] = kwargs.get("feedback", "")
        return self.llm.predict(**kwargs)


class CustomPromptTemplate(StringPromptTemplate):
    template: str
    # The list of tools available
    tools: List[Tool]
    agent_toolnames: List[str]
    max_context_length: int = 4
    keep_n_last_thoughts: int = 1
    current_context_length: int = 0
    model_steps_processed: int = 0
    all_steps_processed: int = 0
    my_summarize_agent: Any = None
    last_summary: str = ""
    project: Any | None = None
    intermediate_steps: list[(AgentAction, str)] = []
    hook: Callable[[CustomPromptTemplate], None] | None = None

    @property
    def _prompt_type(self) -> str:
        return "taskmaster"

    @staticmethod
    def thought_log(thoughts: list[(AgentAction, str)]) -> str:
        result = ""
        for action, AResult in thoughts:
            if action.tool == "WarnAgent":
                result += action.log + f"\nSystem note: {AResult}\n"
            elif action.tool == "AgentFeedback":
                result += action.log + AResult + "\n"
            else:
                result += action.log + f"\nAResult: {AResult}\n"
        return result

    def format(self, **kwargs) -> str:
        # Get the intermediate steps (AgentAction, AResult tuples)
        # Format them in a particular way
        model_steps = kwargs.pop("intermediate_steps")
        self.intermediate_steps += model_steps[self.model_steps_processed :]
        self.model_steps_processed = len(model_steps)
        intermediate_steps = self.intermediate_steps

        self.current_context_length += (
            len(intermediate_steps) - self.all_steps_processed
        )
        self.all_steps_processed = len(intermediate_steps)

        if (
            self.current_context_length >= self.max_context_length
            and self.my_summarize_agent
        ):
            self.last_summary = self.my_summarize_agent.run(
                summary=self.last_summary,
                thought_process=self.thought_log(
                    intermediate_steps[
                        -self.current_context_length : -self.keep_n_last_thoughts
                    ]
                ),
            )
            self.current_context_length = self.keep_n_last_thoughts

        if self.my_summarize_agent:
            kwargs["agent_scratchpad"] = (
                "Here is a summary of what has happened:\n" + self.last_summary
            )
            kwargs["agent_scratchpad"] += "\nEND OF SUMMARY\n"
        else:
            kwargs["agent_scratchpad"] = ""

        kwargs["agent_scratchpad"] += "Here go your thoughts and actions:"

        kwargs["agent_scratchpad"] += self.thought_log(
            intermediate_steps[-self.current_context_length :]
        )

        kwargs["tools"] = "\n".join(
            [
                f"{tool.name}: {tool.description}"
                for tool in self.tools
                if tool.name in self.agent_toolnames
            ]
        )
        kwargs["tool_names"] = self.agent_toolnames
        if self.project:
            for key, value in self.project.prompt_fields().items():
                kwargs[key] = value
        # print("Prompt:\n\n" + self.template.format(**kwargs) + "\n\n\n")
        result = self.template.format(**kwargs)
        if self.hook:
            self.hook(self)
        return result


def extract_variable_names(prompt: str, interaction_enabled: bool = False):
    variable_pattern = r"\{(\w+)\}"
    variable_names = re.findall(variable_pattern, prompt)
    if interaction_enabled:
        for name in ["tools", "tool_names", "agent_scratchpad"]:
            if name in variable_names:
                variable_names.remove(name)
        variable_names.append("intermediate_steps")
    return variable_names


def get_model(model: str = "gpt-4"):
    return ChatOpenAI(
        temperature=0,
        model_name=model,
        request_timeout=320,
    )


@dataclass
class BaseMinion:
    def __init__(
        self,
        base_prompt,
        available_tools,
        model: str = "gpt-4",
        max_iterations: int = 50,
    ) -> None:
        llm = get_model(model)

        agent_toolnames = [tool.name for tool in available_tools]
        available_tools.append(WarningTool().get_tool())

        prompt = CustomPromptTemplate(
            template=base_prompt,
            tools=available_tools,
            input_variables=extract_variable_names(
                base_prompt, interaction_enabled=True
            ),
            agent_toolnames=agent_toolnames,
        )

        llm_chain = LLMChain(llm=llm, prompt=prompt)

        output_parser = CustomOutputParser()

        agent = LLMSingleActionAgent(
            llm_chain=llm_chain,
            output_parser=output_parser,
            stop=["AResult:"],
            allowed_tools=[tool.name for tool in available_tools],
        )

        self.agent_executor = AgentExecutor.from_agent_and_tools(
            agent=agent,
            tools=available_tools,
            verbose=True,
            max_iterations=max_iterations,
        )

    def run(self, **kwargs):
        kwargs["feedback"] = kwargs.get("feedback", "")
        return (
            self.agent_executor.run(**kwargs)
            or "No result. The execution was probably unsuccessful."
        )


@dataclass
class FeedbackMinion:
    underlying_minion: BaseMinion | BasicLLM
    eval_llm: LLMChain
    feedback_prompt: str
    check_function: Callable[[str], Any]

    def __init__(
        self,
        minion: BaseMinion | BasicLLM,
        eval_prompt: str,
        feedback_prompt: str,
        check_function: Callable[[str], Any] = lambda x: None,
        model: str = "gpt-4",
    ) -> None:
        llm = get_model(model)
        self.eval_llm = LLMChain(
            llm=llm,
            prompt=PromptTemplate(
                template=eval_prompt,
                input_variables=extract_variable_names(eval_prompt),
            ),
        )
        self.underlying_minion = minion
        self.feedback_prompt = feedback_prompt

        self.check_function = check_function

    def run(self, **kwargs):
        if "feedback" in kwargs:
            print("Rerunning a prompt with feedback:", kwargs["feedback"])
            if len(kwargs["previous_result"]) > 500:
                kwargs["previous_result"] = (
                    kwargs["previous_result"][:500] + "\n...(truncated)\n"
                )
            kwargs["feedback"] = self.feedback_prompt.format(**kwargs)
        res = self.underlying_minion.run(**kwargs)
        try:
            check_result = None
            self.check_function(res)
        except ValueError as e:
            check_result = " ".join(e.args)
        if check_result:
            kwargs["feedback"] = check_result
            kwargs["previous_result"] = res
            return self.run(**kwargs)
        evaluation = self.eval_llm.predict(result=res, **kwargs)
        if "ACCEPT" in evaluation:
            return res
        kwargs["feedback"] = evaluation.split("Feedback: ", 1)[-1].strip()
        kwargs["previous_result"] = res
        return self.run(**kwargs)
