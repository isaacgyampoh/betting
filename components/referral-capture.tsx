"use client";

import { useEffect } from "react";

const KEY = "gameclaw.ref";

/** Remembers a ?ref= code from a shared link so it can be applied after sign-up. */
export function ReferralCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (ref && /^[A-Z0-9]{4,12}$/i.test(ref)) localStorage.setItem(KEY, ref.toUpperCase());
    } catch {
      /* storage blocked: referrals just won't apply */
    }
  }, []);
  return null;
}

export function takeStoredReferral(): string | null {
  try {
    const ref = localStorage.getItem(KEY);
    if (ref) localStorage.removeItem(KEY);
    return ref;
  } catch {
    return null;
  }
}
