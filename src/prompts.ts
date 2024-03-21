export let planning_examples = `
<planning_advice>
There is no need to put creating a file and writing several of its sections in different tasks. You can just write the entire file right away
</planning_advice>
`;

export let task_prompts = `
<advice>Sometimes, it's easier to rewirte a file than to patch it (if it's less than ~300 lines) - but make sure you know its full content and you write the correct and complete content</advice>
<advice>To delete a line, you can use patch with n and n+1 as arguments and <new_content></new_content></advice>
<advice>If you want to use several patches in a row, use them in the order of decreasing line numbers - then the line numbers won't be changes for the following patches</advice>

Example of patching - insertion:
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
</example>
`;