import json
import os
import subprocess
import tempfile
from typing import Any, Union

import langchain
import langchain.agents.openai_functions_agent.base as oai_func_ag


def get_input_from_editor(initial_text=None):
    editor = os.environ.get('EDITOR', 'vi')  # defaults to 'vi' if EDITOR is not set

    with tempfile.NamedTemporaryFile(suffix=".tmp", delete=False, mode='w+t') as tf:
        # Write the initial text to the file
        if initial_text is not None:
            tf.write(initial_text)
            tf.flush()

        tf.close()
        subprocess.call([editor, tf.name])

        # Read the file
        with open(tf.name, 'r') as f:
            input_string = f.read()

        # Clean up the temp file
        os.unlink(tf.name)

    return input_string


def skip_file(filename: str) -> bool:
    filename = filename.strip('/').split('/')[-1]
    if filename.startswith('.'):
        return True
    return filename in (
        '.git', '.idea', '__pycache__', 'venv',
        'node_modules', 'data', 'coverage') or 'venv' in filename


def skip_file_summary(filename: str) -> bool:
    return filename.endswith('.svg') or '-lock' in filename or filename.endswith('.lock')


def trim_extra(content: str, max_length: int = 1500) -> str:
    if len(content) > max_length:
        content = content[:max_length] + f"\n...[skipped {len(content) - max_length - 500} chars]\n" + content[-500:]
    return content


def unjson(data: str | Any) -> Any:
    if isinstance(data, str):
        return json.loads(data)
    return data


_parse_ai_message = oai_func_ag._parse_ai_message


def parse_openai_function_message_custom(
        msg: oai_func_ag.BaseMessage) -> Union[oai_func_ag.AgentAction, oai_func_ag.AgentFinish]:
    try:
        return _parse_ai_message(msg)
    except langchain.schema.OutputParserException as e:
        if msg.additional_kwargs.get('function_call', {}).get('arguments'):
            try:
                args = json.dumps(eval(msg.additional_kwargs['function_call']['arguments']))
                msg.additional_kwargs['function_call']['arguments'] = args
                return _parse_ai_message(msg)
            except SyntaxError:
                pass
        raise e


oai_func_ag._parse_ai_message = parse_openai_function_message_custom
