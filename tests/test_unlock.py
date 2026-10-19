"""Startup lock: run with python -m unittest tests/test_unlock.py."""
import unittest

from fastapi.testclient import TestClient

from app import API_TOKEN, UNLOCK_ATTEMPTS, UNLOCK_SESSIONS, app


class UnlockTest(unittest.TestCase):
    def setUp(self):
        UNLOCK_SESSIONS.clear()
        UNLOCK_ATTEMPTS.clear()
        self.client = TestClient(app)

    def test_pin_gates_api_and_live_socket_then_survives_reload(self):
        self.assertFalse(self.client.get('/api/unlock/status').json()['unlocked'])
        self.assertEqual(401, self.client.get('/api/status').status_code)
        with self.assertRaises(Exception):
            with self.client.websocket_connect('/ws'):
                pass
        self.assertEqual(401, self.client.post('/api/unlock', json={'pin': '00000'}).status_code)
        self.assertEqual(200, self.client.post('/api/unlock', json={'pin': '54321'}).status_code)
        self.assertTrue(self.client.get('/api/unlock/status').json()['unlocked'])
        self.assertEqual(200, self.client.get('/api/status').status_code)
        with self.client.websocket_connect('/ws') as socket:
            self.assertIn('jobs', socket.receive_json())
        self.assertTrue(TestClient(app, cookies=self.client.cookies).get('/api/unlock/status').json()['unlocked'])
        self.client.post('/api/unlock/logout')
        self.assertEqual(401, self.client.get('/api/status').status_code)

    def test_agent_token_remains_valid_and_pin_is_rate_limited(self):
        self.assertEqual(200, self.client.get('/api/status', headers={'X-Katya-Token': API_TOKEN}).status_code)
        for _ in range(5):
            self.assertEqual(401, self.client.post('/api/unlock', json={'pin': '00000'}).status_code)
        self.assertEqual(429, self.client.post('/api/unlock', json={'pin': '54321'}).status_code)


if __name__ == '__main__':
    unittest.main()
