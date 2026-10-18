"""Tests for Phase 5.8c (#301): Collaborative Cursors & Presence WebSocket channel."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from app.main import app
from fastapi.testclient import TestClient


def test_collab_room_presence_and_cursor_sync():
    """Verify multiple peers can join a room, receive presence, and exchange cursors."""
    client = TestClient(app)

    # Peer 1 connects to room "room-42"
    with client.websocket_connect(
        "/ws/collab/room-42?user_id=alice&name=Alice&color=%2310b981"
    ) as ws1:
        # Peer 1 gets initial presence
        msg1 = ws1.receive_json()
        assert msg1["type"] == "presence"
        assert msg1["room_id"] == "room-42"
        assert len(msg1["peers"]) == 1
        assert msg1["peers"][0]["user_id"] == "alice"

        # Peer 2 connects to the same room
        with client.websocket_connect(
            "/ws/collab/room-42?user_id=bob&name=Bob&color=%233b82f6"
        ) as ws2:
            # Peer 1 receives updated presence with both peers
            presence_for_p1 = ws1.receive_json()
            assert presence_for_p1["type"] == "presence"
            assert len(presence_for_p1["peers"]) == 2

            # Peer 2 also receives presence
            presence_for_p2 = ws2.receive_json()
            assert presence_for_p2["type"] == "presence"
            assert len(presence_for_p2["peers"]) == 2

            # Alice sends cursor move
            ws1.send_json(
                {
                    "type": "cursor",
                    "cursor": {"x": 0.45, "y": 0.72, "activeLayer": 4, "timestamp": 12345},
                }
            )

            # Bob receives peer_cursor from Alice
            cursor_msg = ws2.receive_json()
            assert cursor_msg["type"] == "peer_cursor"
            assert cursor_msg["user_id"] == "alice"
            assert cursor_msg["cursor"]["activeLayer"] == 4
            assert cursor_msg["cursor"]["x"] == 0.45

            # Bob sends selection
            ws2.send_json(
                {
                    "type": "selection",
                    "selection": {"kind": "layer", "index": 7, "name": "Layer 7"},
                }
            )

            # Alice receives peer_selection from Bob
            selection_msg = ws1.receive_json()
            assert selection_msg["type"] == "peer_selection"
            assert selection_msg["user_id"] == "bob"
            assert selection_msg["selection"]["kind"] == "layer"
            assert selection_msg["selection"]["index"] == 7

            # Alice (presenter) steps classroom op
            ws1.send_json({"type": "step", "op_index": 3, "token_index": 1})
            step_msg = ws2.receive_json()
            assert step_msg["type"] == "peer_step"
            assert step_msg["user_id"] == "alice"
            assert step_msg["op_index"] == 3

            # Ping/Pong test
            ws1.send_json({"type": "ping"})
            pong_msg = ws1.receive_json()
            assert pong_msg["type"] == "pong"

        # Bob disconnected: Alice receives presence update with only 1 peer
        presence_after_dc = ws1.receive_json()
        assert presence_after_dc["type"] == "presence"
        assert len(presence_after_dc["peers"]) == 1
        assert presence_after_dc["peers"][0]["user_id"] == "alice"
