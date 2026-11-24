"""Launcher and primary-display regressions, with no inference."""
from contextlib import redirect_stderr
import io
import socket
import unittest
from unittest.mock import patch

import run_app
from src.localization import Localization


class LauncherTests(unittest.TestCase):
    def test_reports_missing_dependency_without_binding_or_loading_model(self):
        error = io.StringIO()
        with patch.object(run_app, 'missing_dependencies', return_value=['torch']), \
             patch.object(run_app, 'bind_local_port') as bind, redirect_stderr(error):
            self.assertEqual(run_app.main(['--check']), 2)
        bind.assert_not_called()
        self.assertIn('THIẾU DEPENDENCY: torch', error.getvalue())

    def test_busy_port_has_clear_message_and_no_process_kill(self):
        error = io.StringIO()
        with patch.object(run_app, 'missing_dependencies', return_value=[]), \
             patch.object(run_app, 'bind_local_port', side_effect=OSError('TEST occupied')), redirect_stderr(error):
            self.assertEqual(run_app.main(['--profile', 'recipe', '--check']), 3)
        self.assertIn('CỔNG 8000', error.getvalue())
        self.assertIn('Không tự dừng', error.getvalue())

    def test_check_closes_its_socket_without_constructing_server(self):
        with patch.object(run_app, 'missing_dependencies', return_value=[]), \
             patch.object(run_app, 'bind_local_port') as bind:
            self.assertEqual(run_app.main(['--profile', 'recipe', '--check']), 0)
        bind.return_value.close.assert_called_once()

    def test_exclusive_bind_preserves_owner_and_can_be_released(self):
        owner = run_app.bind_local_port(0)
        try:
            port = owner.getsockname()[1]
            with self.assertRaises(OSError):
                other = run_app.bind_local_port(port)
                other.close()
            self.assertEqual(owner.getsockname()[1], port)
        finally:
            owner.close()
        with run_app.bind_local_port(port):
            pass

    def test_missing_module_detection_uses_current_interpreter(self):
        def find(module):
            return None if module == 'uvicorn' else object()
        with patch.object(run_app.importlib.util, 'find_spec', side_effect=find):
            self.assertEqual(run_app.missing_dependencies(), ['uvicorn'])

    def test_start_uses_only_primary_app_and_keeps_checked_socket(self):
        with patch.object(run_app, 'missing_dependencies', return_value=[]), \
             patch.object(run_app, 'bind_local_port') as bind, patch('uvicorn.Server') as factory, \
             patch('backend.main.create_app') as create_app:
            factory.return_value.started = True
            self.assertEqual(run_app.main(['--profile', 'recipe']), 0)
        create_app.assert_called_once()
        self.assertEqual(factory.call_args.args[0].app, create_app.return_value)
        self.assertEqual(factory.call_args.args[0].port, 8000)
        factory.return_value.run.assert_called_once_with(sockets=[bind.return_value])
        bind.return_value.close.assert_called_once()

    def test_ctrl_c_closes_owned_socket_and_exits_cleanly(self):
        with patch.object(run_app, 'missing_dependencies', return_value=[]), \
             patch.object(run_app, 'bind_local_port') as bind, patch('uvicorn.Server') as factory, \
             patch('backend.main.create_app'):
            factory.return_value.run.side_effect = KeyboardInterrupt()
            self.assertEqual(run_app.main(['--profile', 'recipe']), 0)
        bind.return_value.close.assert_called_once()


class PrimaryDisplayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.local = Localization()

    def test_public_dictionary_omits_known_machine_title_but_preserves_original_cache(self):
        self.assertEqual(self.local.titles['3800'], 'Bộ phận sinh dục phụ')
        self.assertNotIn('Apricot Pandowdy', self.local.public_dictionary()['recipe_titles'])
        self.assertEqual(self.local.public_dictionary()['recipe_titles']['Quick Condensed Milk'], 'Sữa đặc làm nhanh')

    def test_reviewed_display_does_not_change_input_mapping(self):
        public = self.local.public_dictionary()
        self.assertEqual(public['ingredients']['egg'], 'trứng')
        self.assertEqual(public['manual_aliases'], {**self.local.english_aliases, **self.local.reverse})
        self.assertEqual(self.local.canonical_input('trứng'), 'egg')
        self.assertIsNone(self.local.english_aliases.get('beef'))
        self.assertEqual(self.local.canonical_input('thịt bò'), 'beef')


if __name__ == '__main__':
    unittest.main()
