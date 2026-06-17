"""Smoke test: serve the frontend locally and verify the map renders."""

import functools
import http.server
import re
import threading
from pathlib import Path

import pytest
from playwright.sync_api import Page, expect

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "static"


@pytest.fixture(scope="module")
def frontend_url():
    handler = functools.partial(
        http.server.SimpleHTTPRequestHandler,
        directory=str(STATIC_DIR),
    )
    server = http.server.HTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()


def test_map_is_displayed(page: Page, frontend_url: str):
    page.goto(frontend_url)
    map_el = page.locator("#map")
    expect(map_el).to_be_visible()
    box = map_el.bounding_box()
    assert box is not None
    assert box["width"] > 0 and box["height"] > 0
    assert page.locator("#map canvas").count() > 0


def test_bottom_bar_visible_on_mobile(page: Page, frontend_url: str):
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(frontend_url)
    expect(page.locator("#bottom-bar")).to_be_visible()


def test_settings_drawer_opens_on_pc(page: Page, frontend_url: str):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(frontend_url)
    expect(page.locator("#settings-drawer")).to_have_class(re.compile(r"\bopen\b"))
