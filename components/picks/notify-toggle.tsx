"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";

function toKeyBuffer(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Opt in to a notification when the daily picks are published. */
export function NotifyToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<"unsupported" | "off" | "on" | "busy">("busy");

  useEffect(() => {
    let cancelled = false;
    const settle = (next: "unsupported" | "off" | "on") => {
      if (!cancelled) setState(next);
    };
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      settle("unsupported");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => settle(sub ? "on" : "off"))
      .catch(() => settle("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setState("busy");
    try {
      if ((await Notification.requestPermission()) !== "granted") return setState("off");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKeyBuffer(vapidPublicKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await apiFetch("/api/v1/push", { method: "POST", body: JSON.stringify(json) });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    }
  }

  async function disable() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await apiFetch("/api/v1/push", { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  }

  if (state === "unsupported") return null;
  return (
    <Button variant="outline" size="sm" onClick={state === "on" ? disable : enable} disabled={state === "busy"}>
      {state === "on" ? <BellOff data-icon="inline-start" /> : <Bell data-icon="inline-start" />}
      {state === "on" ? "Notifications on" : "Notify me"}
    </Button>
  );
}
