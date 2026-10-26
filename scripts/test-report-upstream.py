import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("report", Path(__file__).with_name("report-upstream.py"))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class UpstreamReportTest(unittest.TestCase):
    def test_dirty_worktree_is_untouched_for_clean_conflicting_and_missing_refs(self):
        with tempfile.TemporaryDirectory() as directory:
            before = os.getcwd()
            os.chdir(directory)
            self.addCleanup(os.chdir, before)
            def git(*args):
                return subprocess.check_output(["git", *args], stderr=subprocess.STDOUT).decode().strip()
            git("init", "-q", "-b", "main")
            git("config", "user.name", "test")
            git("config", "user.email", "test@example.invalid")
            Path("shared").write_text("base\n")
            git("add", ".")
            git("commit", "-qm", "base")
            git("branch", "upstream-test")
            Path("shared").write_text("product\n")
            git("commit", "-qam", "product")
            git("switch", "-q", "upstream-test")
            Path("new").write_text("upstream\n")
            git("add", ".")
            git("commit", "-qm", "clean upstream")
            clean = git("rev-parse", "HEAD")
            Path("shared").write_text("upstream\n")
            git("commit", "-qam", "conflicting upstream")
            conflict = git("rev-parse", "HEAD")
            git("switch", "-q", "main")
            Path("shared").write_text("uncommitted user edits\n")
            Path("untracked").write_text("user file\n")
            status = git("status", "--porcelain=v1")
            self.assertEqual(report.compare("HEAD", clean)["conflicts"], [])
            self.assertEqual(report.compare("HEAD", conflict)["conflicts"], ["shared"])
            with self.assertRaises(subprocess.CalledProcessError):
                report.compare("HEAD", "nonexistent")
            self.assertEqual(git("status", "--porcelain=v1"), status)
            self.assertEqual(Path("shared").read_text(), "uncommitted user edits\n")


if __name__ == "__main__":
    unittest.main()
