"""Collaborative session and presence manager for TokenPrint (Phase 5.8c / #301).

Manages multi-viewer presence, shared cursor coordinates, layer/op selections,
and classroom presenter sync over WebSocket rooms.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any
from fastapi import WebSocket

logger = logging.getLogger("tokenprint.collab")


@dataclass
class CollabPeer:
    user_id: str
    name: str
    color: str
    role: str = "viewer"  # "viewer" | "presenter"
    cursor: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None
    last_seen: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "name": self.name,
            "color": self.color,
            "role": self.role,
            "cursor": self.cursor,
            "selection": self.selection,
            "last_seen": self.last_seen,
        }


class CollabRoomManager:
    """Manages WebSocket connections and state synchronization across rooms."""

    def __init__(self) -> None:
        # room_id -> { user_id: (WebSocket, CollabPeer) }
        self._rooms: dict[str, dict[str, tuple[WebSocket, CollabPeer]]] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        room_id: str,
        user_id: str,
        ws: WebSocket,
        name: str,
        color: str,
        role: str = "viewer",
    ) -> CollabPeer:
        """Register a new peer connection in a collaborative room."""
        async with self._lock:
            if room_id not in self._rooms:
                self._rooms[room_id] = {}

            peer = CollabPeer(
                user_id=user_id,
                name=name,
                color=color,
                role=role,
                last_seen=time.time(),
            )
            self._rooms[room_id][user_id] = (ws, peer)

        logger.info(
            "Peer %s (%s) connected to collab room '%s'. Total in room: %d",
            user_id,
            name,
            room_id,
            len(self._rooms[room_id]),
        )

        # Notify all peers in the room of the updated presence list
        await self.broadcast_presence(room_id)
        return peer

    async def disconnect(self, room_id: str, user_id: str) -> None:
        """Remove a peer from a collaborative room and notify remaining peers."""
        async with self._lock:
            if room_id in self._rooms and user_id in self._rooms[room_id]:
                del self._rooms[room_id][user_id]
                if not self._rooms[room_id]:
                    del self._rooms[room_id]
                    logger.info("Collab room '%s' is now empty and cleaned up.", room_id)

        if room_id in self._rooms:
            await self.broadcast_presence(room_id)

    async def broadcast_presence(self, room_id: str) -> None:
        """Broadcast the full roster of active peers in the room."""
        peers_list = self.get_peers(room_id)
        msg = {
            "type": "presence",
            "room_id": room_id,
            "peers": [p.to_dict() for p in peers_list],
            "count": len(peers_list),
            "timestamp": time.time(),
        }
        await self.broadcast(room_id, msg)

    def get_peers(self, room_id: str) -> list[CollabPeer]:
        """Return list of active peers in a room."""
        if room_id not in self._rooms:
            return []
        return [peer for _, peer in self._rooms[room_id].values()]

    async def broadcast(
        self,
        room_id: str,
        message: dict[str, Any],
        exclude_user_id: str | None = None,
    ) -> None:
        """Broadcast a message to peers in the specified room."""
        if room_id not in self._rooms:
            return

        targets = [
            (uid, ws)
            for uid, (ws, _) in self._rooms[room_id].items()
            if uid != exclude_user_id
        ]

        stale: list[str] = []
        for uid, ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                stale.append(uid)

        for uid in stale:
            await self.disconnect(room_id, uid)

    async def handle_message(
        self,
        room_id: str,
        user_id: str,
        message: dict[str, Any],
    ) -> None:
        """Process incoming client message and relay to peers."""
        if room_id not in self._rooms or user_id not in self._rooms[room_id]:
            return

        _, peer = self._rooms[room_id][user_id]
        peer.last_seen = time.time()
        msg_type = message.get("type")

        if msg_type == "cursor":
            cursor_data = message.get("cursor") or {}
            peer.cursor = cursor_data
            await self.broadcast(
                room_id,
                {
                    "type": "peer_cursor",
                    "user_id": user_id,
                    "cursor": cursor_data,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "selection":
            selection_data = message.get("selection")
            peer.selection = selection_data
            await self.broadcast(
                room_id,
                {
                    "type": "peer_selection",
                    "user_id": user_id,
                    "selection": selection_data,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "step":
            # Classroom presenter stepping through ops/layers
            op_index = message.get("op_index", 0)
            token_index = message.get("token_index")
            await self.broadcast(
                room_id,
                {
                    "type": "peer_step",
                    "user_id": user_id,
                    "op_index": op_index,
                    "token_index": token_index,
                },
                exclude_user_id=user_id,
            )

        elif msg_type == "ping":
            ws, _ = self._rooms[room_id][user_id]
            try:
                await ws.send_json({"type": "pong", "timestamp": time.time()})
            except Exception:
                pass


# Singleton instance
collab_manager = CollabRoomManager()
