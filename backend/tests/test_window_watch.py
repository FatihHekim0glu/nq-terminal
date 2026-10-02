"""The window and focus watch fails a test only for windows and focus changes that belong to the test's own process
tree. A window or focus change from another program (the owner's desktop) is a note, never a failure."""
from __future__ import annotations

import os
import subprocess
import sys

import pytest

from conftest import PY, WindowWatch, wait_until

pytestmark = pytest.mark.skipif(sys.platform != "win32", reason="the Windows window watch")

OWN, FOREIGN = 4000, 9000


class FakeDesktop(WindowWatch):
    """The watch with the desktop and the process tree replaced by plain data, polled by hand."""

    def __init__(self) -> None:
        super().__init__()
        self.windows: dict[int, int] = {}
        self.front: tuple[int, int] = (1, FOREIGN)
        self.tree = {OWN}

    def _visible(self) -> dict[int, int]:
        return dict(self.windows)

    def _foreground(self) -> tuple[int, int]:
        return self.front

    def _own_tree(self) -> set[int]:
        return set(self.tree)


def started() -> FakeDesktop:
    watch = FakeDesktop()
    watch._baseline = set(watch._visible())
    watch._foreground_hwnd = watch.front[0]
    return watch


def test_a_new_window_of_another_program_is_a_note_not_a_failure():
    watch = started()
    watch.windows[0x10] = FOREIGN
    watch.poll_once()
    assert watch.stop() == []
    assert any("0x10" in note and str(FOREIGN) in note for note in watch.notes)


def test_a_new_window_of_the_test_process_tree_is_a_failure():
    watch = started()
    watch.windows[0x11] = OWN
    watch.poll_once()
    assert any("0x11" in problem for problem in watch.stop())


def test_a_focus_change_to_another_program_is_a_note_not_a_failure():
    watch = started()
    watch.front = (2, FOREIGN)
    watch.poll_once()
    assert watch.stop() == []
    assert watch.notes


def test_a_focus_change_to_a_window_of_the_test_process_tree_is_a_failure():
    watch = started()
    watch.front = (3, OWN)
    watch.poll_once()
    assert any("foreground" in problem for problem in watch.stop())


def test_a_window_is_reported_once():
    watch = started()
    watch.windows[0x12] = OWN
    watch.poll_once()
    watch.poll_once()
    assert len(watch.stop()) == 1


def test_the_real_process_tree_holds_this_process_and_a_grandchild_but_not_its_parent():
    code = "import subprocess,sys;c=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);" \
           "print(c.pid,flush=True);c.wait()"
    child = subprocess.Popen([str(PY), "-c", code], stdout=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        grandchild = int(child.stdout.readline().strip())
        assert wait_until(lambda: {os.getpid(), child.pid, grandchild} <= WindowWatch()._own_tree(), 10)
        assert os.getppid() not in WindowWatch()._own_tree()
    finally:
        subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        child.wait(timeout=30)
        child.stdout.close()
