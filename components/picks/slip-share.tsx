"use client";

import { useState } from "react";
import { Check, Download, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Sharing one slip, as one thing.
 *
 * Three ways out, because people share differently: the system sheet where there is one (a phone),
 * the image itself (WhatsApp, Instagram, a group chat), and the link (anywhere else). The image is
 * rendered on the server at a fixed size rather than screenshotted, so it reads the same on every
 * device and is not a picture of somebody's interface.
 */
export function SlipShare({ reference, url, odds, legs }: { reference: string; url: string; odds: number; legs: number }) {
  const [copied, setCopied] = useState(false);
  const image = `${url}/image`;
  const text = `gameclaw Daily Special Slip ${reference} — ${legs} selections at ${odds.toFixed(2)}`;

  async function share() {
    // The system sheet is the right answer on a phone and does not exist on a desktop browser.
    if (typeof navigator !== "undefined" && navigator.share) {
      await navigator.share({ title: "gameclaw Daily Special Slip", text, url }).catch(() => {});
      return;
    }
    await copy();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A blocked clipboard is not worth an error state; the link is on screen and selectable.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={share}>
        <Share2 className="size-4" strokeWidth={1.75} aria-hidden />
        Share slip
      </Button>
      <Button size="sm" variant="ghost" asChild>
        <a href={image} download={`gameclaw-${reference}.png`}>
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
          Image
        </a>
      </Button>
      <Button size="sm" variant="ghost" onClick={copy}>
        {copied ? <Check className="size-4" strokeWidth={1.75} aria-hidden /> : <Link2 className="size-4" strokeWidth={1.75} aria-hidden />}
        {copied ? "Copied" : "Copy link"}
      </Button>
    </div>
  );
}
