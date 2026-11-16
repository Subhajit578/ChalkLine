"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import axios from "axios";
import { Canvas } from "./Canvas";
import { getToken, installSessionGuard } from "@/lib/session";
import { API_URL } from "@/lib/config";
import { errorStatus } from "@/lib/errors";
import { RoomConnection, type ConnectionStatus } from "@/draw/connection";

export function RoomCanvas() {
  // Read from the URL rather than taken as a prop from the server. That is
  // what lets the page itself be a static shell: nothing about the render
  // depends on which board this is.
  //
  // The segment is the room's share id, or (old links) its name, which the
  // server still accepts for existing members. The folder is still [slug].
  const params = useParams<{ slug: string }>();
  const key = typeof params?.slug === "string" ? params.slug : "";

  const [room, setRoom] = useState<{ id: string; name: string } | null>(null);
  const [connection, setConnection] = useState<RoomConnection | null>(null);
  const [status, setStatus] = useState<{ status: ConnectionStatus; message?: string }>({
    status: "connecting",
  });
  // true once the board has been joined; after that a lost connection is a
  // notice over the canvas, not a reason to remove it
  const [opened, setOpened] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    installSessionGuard();
    // getToken, not localStorage: an expired token is treated as no token,
    // so a session that ran out while the tab was closed says "sign in again"
    // rather than failing as a 401 somewhere further in
    const token = getToken();
    if (!token) {
      setError("Your session has ended. Sign in again.");
      return;
    }

    let cancelled = false;
    let opening: RoomConnection | null = null;

    // Opening a link joins the room (idempotent; no-op for the owner). This
    // must finish before the socket opens: the socket server only admits
    // owners and members.
    axios
      .post(
        `${API_URL}/room/${encodeURIComponent(key)}/join`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      )
      .then((res) => {
        if (cancelled) return;
        const joined = res.data.room;
        opening = new RoomConnection(String(joined.id));
        opening.onStatus((next, message) => {
          setStatus({ status: next, message });
          if (next === "online") setOpened(true);
        });
        setRoom({ id: String(joined.id), name: joined.slug });
        setConnection(opening);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          errorStatus(err) === 404
            ? "This canvas does not exist, or the link is not valid."
            : "Could not open this canvas. Check your connection and try again."
        );
      });

    return () => {
      cancelled = true;
      opening?.onStatus(null);
      opening?.close();
    };
  }, [key]);

  if (error) return <div className="p-8">{error}</div>;
  if (!room || !connection) return <div className="p-8">Loading canvas...</div>;
  if (!opened) {
    // closed before ever joining: refused, or session invalid
    return (
      <div className="p-8">
        {status.status === "closed"
          ? status.message ?? "Could not connect to this canvas."
          : "Connecting to server..."}
      </div>
    );
  }

  // name is used for the exported filename; the id is what the protocol uses
  return (
    <Canvas
      roomId={room.id}
      slug={room.name}
      connection={connection}
      connectionStatus={status.status}
      connectionMessage={status.message}
    />
  );
}
