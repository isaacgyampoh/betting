"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Searching happens on the server, over the whole day.
 *
 * It used to filter in the browser, which meant every one of a day's ~1,300 fixtures had to be sent
 * there first - 894 KB of page before a single badge loaded, nearly all of it for games nobody
 * scrolls to. The list is short now and this still finds anything in it.
 */
export function MatchSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value.trim()) next.set("q", value.trim());
      else next.delete("q");
      startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
    }, 300);
    return () => clearTimeout(id);
    // params is a new object on every render; its string form is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, pathname, params.toString(), router]);

  return (
    <div className="relative">
      <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => {
          typed.current = true;
          setValue(e.target.value);
        }}
        placeholder="Search team or league"
        aria-label="Search team or league"
        // 16px, or iOS zooms the whole page when it takes focus.
        className="h-11 pl-9 text-base md:text-sm"
      />
      {pending && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
    </div>
  );
}
