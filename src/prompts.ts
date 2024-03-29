export let planning_examples = `
<planning_advice>There is no need to put creating a file and writing several of its sections in different tasks. You can just write the entire file right away</planning_advice>
<planning_advice>When you encounter an issue, if you can say how to fix it without investigating with decent confidence, you can just write the fix and after that test itß</planning_advice>
<planning_advice>Be concise</planning_advice>
`;

export let task_prompts = `
<advice>Sometimes, it's easier to rewirte a file than to patch it (if it's less than ~1500 lines) - but make sure you know its full content and you write the correct and complete content</advice>
<advice>To delete a line, you can use patch with n and n+1 as arguments and <new_content></new_content></advice>
<advice>If you want to use several patches in a row, use them in the order of decreasing line numbers - then the line numbers won't be changes for the following patches</advice>`
/*Example of patching - insertion:
<example>
<function_calls>
<invoke>
<tool_name>patch_file</tool_name>
<parameters>
<path>main.py</path>
<old_line_start>10</old_line_start>
<old_line_end>10</old_line_end>  
<new_content>from utils import wrap_string
</new_content>
</parameters>
</invoke>
</function_calls>
<function_results>
<result>
<tool_name>patch_file</tool_name>
<stdout>Patched file main.py from line 10 to 10 with new content. Here is what was in the file:
1|from telethon import TelegramClient, events
2|from datetime import datetime, timedelta
3|from telethon.tl.functions.messages import GetHistoryRequest
4|import os
5|from telethon.tl.types import MessageMediaPhoto
6|import traceback
7|import pymongo
8|from pymongo import MongoClient
9|import asyncio
---
---
10|from dotenv import load_dotenv
11|import json
12|from openai import OpenAI
13|from collections import defaultdict
14|
15|load_dotenv()
16|

The new content in the neighborhood:
1|from telethon import TelegramClient, events
2|from datetime import datetime, timedelta
3|from telethon.tl.functions.messages import GetHistoryRequest
4|import os
5|from telethon.tl.types import MessageMediaPhoto
6|import traceback
7|import pymongo
8|from pymongo import MongoClient
9|import asyncio
10|from utils import wrap_string
11|from dotenv import load_dotenv
12|import json
13|from openai import OpenAI
14|from collections import defaultdict
15|
16|load_dotenv()
</stdout>
</result>
</function_results>
</example>
Example of patching - replace a line:
<example>
<function_calls>
<invoke>
<tool_name>patch_file</tool_name>
<parameters>
<path>main.py</path>
<old_line_start>56</old_line_start>
<old_line_end>57</old_line_end>
<new_content>        await client.send_message(channel, message, parse_mode='html')   #, schedule=schedule_time)</new_content>
</parameters>
</invoke>
</function_calls>
<function_results>
<result>
<tool_name>patch_file</tool_name>
<stdout>
Patched file main.py from line 56 to 57 with new content. Here is what was in the file:
47|    """
48|    await client.start()
49|    
50|    # Get the current time
51|    now = datetime.now()
52|    
53|    for i, message in enumerate(messages):
54|        # Schedule each message 1 minute apart
55|        schedule_time = now + timedelta(minutes=i+1, hours=-1)  # Start scheduling 1 minute from now
---
56|        await client.send_message(channel, message, parse_mode='md')   #, schedule=schedule_time)
---
57|        print(f"Scheduled message: '{message}' for {schedule_time}")
58|
59|    past_messages[channel].extend(messages)
60|
61|
62|def process_unprocessed_news(unprocessed_news):
The new content in the neighborhood:
47|    """
48|    await client.start()
49|    
50|    # Get the current time
51|    now = datetime.now()
52|    
53|    for i, message in enumerate(messages):
54|        # Schedule each message 1 minute apart
55|        schedule_time = now + timedelta(minutes=i+1, hours=-1)  # Start scheduling 1 minute from now
56|        await client.send_message(channel, message, parse_mode='html')   #, schedule=schedule_time)
57|        print(f"Scheduled message: '{message}' for {schedule_time}")
58|
59|    past_messages[channel].extend(messages)
60|
61|
62|def process_unprocessed_news(unprocessed_news):
</stdout>
</result>
</function_results>
</example>*/

task_prompts += `<advice>When investigating or looking for some context, read the required files all at the same time, in one function_calls block. If they are provided above (in the workspace or relevant files sections), you don't need to read them at all.</advice>
<advice>Use rewrite_file instead of patches if the file is less than 2000 lines</advice>
<advice>When rewriting a file, make sure you know its full content and you write the correct and complete content - you cannot skip anything</advice>
<advice>Usually, you should first make a plan, then use the function calls to implement it. After that, check that everything has been done correctly: read files, etc. After that you can write <DONE/></advice>
<advice>After making some changes to the codebase, run the linter to check for any issues</advice>
<advice>Usualy, the plan should look kind of like this:
1. Read the relevant files if they are not provided
2. Write your thoughts on how to perform the necessary changes
3. Rewrite the files with your changes
4. Run the linter, sometimes run the tests too
5. If everything is fine, write <DONE/></advice>
<advice>If you can't read some file, use ls or tree to see what's in that directory and which file you should read</advice>
`;

export const haiku_simple_additional_prompt = `
<advice>For testing, the command is usually test_framework + test_path. It can be something like \`./tests/runtests.py --verbosity 2\` (if such a file is present), \`pytest --no-header -rA -p no:cacheprovider path/to/test/file.py\`</advice>
`
