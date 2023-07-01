import time

import html2text
import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.desired_capabilities import DesiredCapabilities

from .tool import SimpleTool
from .utils import trim_extra

h2t = html2text.HTML2Text()
h2t.ignore_links = False


def render_page(html: str):
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup.findAll(True):
        if tag.get('id'):
            tag.string = f"[#{tag['id']}] {tag.text}"
    text = trim_extra(h2t.handle(str(soup)))
    return text


class SeleniumTool(SimpleTool):
    name = "Selenium"
    description = "A tool that can be used to interact with webpages using Selenium."

    def ensure_driver(self):
        if not self.driver:
            # Set the logging preferences
            d = DesiredCapabilities.CHROME
            d['goog:loggingPrefs'] = {'browser': 'ALL'}
            self.driver = webdriver.Chrome(desired_capabilities=d)

    def __init__(self):
        self.description = (
            "A tool that can be used to interact with webpages using Selenium. "
            "Here are some special commands:\n"
            "    - `/open url` opens a webpage\n"
            "    - `/click xpath` clicks an element\n"
            "    - `/type xpath text` sends keys to an element\n"
            "    - `/html` gets the full HTML of the current page\n"
            "    - `/refresh` refreshes the page\n"
            "    - `/back` goes back\n"
            "    - `/eval code` evaluates a Python expression which uses Selenium's `driver` variable\n"
        )

        self.driver = None

        self.last_log_timestamp = 0

    def render_content(self):
        title = self.driver.title
        html = self.driver.page_source
        console_logs = self.driver.get_log('browser')
        new_console_logs = [log for log in console_logs if log['timestamp'] > self.last_log_timestamp]
        self.last_log_timestamp = max(
            [log['timestamp'] for log in console_logs]) if console_logs else self.last_log_timestamp

        text = render_page(html)

        return f"Title: {title}\nURL: {self.driver.current_url}\nContent:\n{text}\nNew console logs:\n{new_console_logs}"

    def func(self, args: str) -> str:
        args = args.strip()
        command = args.split(" ", 1)[0].strip()
        argument = args.split(" ", 1)[1] if len(args.split(" ", 1)) > 1 else ""
        try:
            self.ensure_driver()

            if command == "/open":
                self.driver.get(argument)
                time.sleep(1)  # Wait for the page to load
                return self.render_content()

            elif command == "/click":
                element = self.driver.find_element("xpath", argument)
                element.click()
                time.sleep(1)  # Wait for the page to load
                return self.render_content()

            elif command == "/type":
                xpath, text = argument.split(" ", 1)
                element = self.driver.find_element("xpath", xpath)
                element.send_keys(text)
                return "Text entered.\n"

            elif command == "/html":
                return self.driver.page_source

            elif command == "/refresh":
                self.driver.refresh()
                time.sleep(1)  # Wait for the page to load
                return self.render_content()

            elif command == "/back":
                self.driver.back()
                time.sleep(1)  # Wait for the page to load
                return self.render_content()

            elif command == "/eval":
                return str(eval(argument, {"driver": self.driver, "time": time}))

            else:
                return "Unknown command.\n"
        except Exception as e:
            return 'error: ' + str(e) + '\n'


class GetPage(SimpleTool):
    name: str = "GetPage"
    description: str = (
        "A tool that can be used to read a page from some url in a good (rendered) format. "
        "The input format is just the url."
    )

    @staticmethod
    def func(args: str) -> str:
        url = args
        try:
            response = requests.get(url)
            return render_page(response.text)
        except Exception as e:
            return str(e)
