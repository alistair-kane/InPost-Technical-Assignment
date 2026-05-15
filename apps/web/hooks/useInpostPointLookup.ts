"use client";

import { useEffect, useState } from "react";

import type { InpostPointItem } from "@/components/LocationDetailPanel";
import { mapInpostPointLookupUrl } from "@/components/mapDashboard/mapApiUrls";
import { clientRateLimitRule } from "@/lib/rateLimitConfig";
import { RateLimitError, rateLimitedFetch } from "@/lib/clientRateLimit";
import { parseInpostNameAndCountry } from "@/lib/inpostPointQuery";
import type { MapPoint } from "@/types/mapPoint";

export function useInpostPointLookup(selected: MapPoint | null): {
  inpostItem: InpostPointItem;
  inpostLoading: boolean;
  inpostError: string | null;
} {
  const [inpostItem, setInpostItem] = useState<InpostPointItem>(null);
  const [inpostLoading, setInpostLoading] = useState(false);
  const [inpostError, setInpostError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) {
      setInpostItem(null);
      setInpostLoading(false);
      setInpostError(null);
      return;
    }
    const { name, country } = parseInpostNameAndCountry(selected);
    if (!name) {
      setInpostItem(null);
      setInpostLoading(false);
      setInpostError(null);
      return;
    }
    const ac = new AbortController();
    setInpostLoading(true);
    setInpostError(null);
    setInpostItem(null);
    const qs = new URLSearchParams({
      name,
      country,
    });
    void (async () => {
      try {
        const res = await rateLimitedFetch(
          mapInpostPointLookupUrl(qs),
          { signal: ac.signal },
          "inpost-point",
          clientRateLimitRule("inpost-point")
        );
        const data = (await res.json().catch(() => ({}))) as {
          item?: InpostPointItem;
          error?: string;
        };
        if (ac.signal.aborted) {
          return;
        }
        if (!res.ok) {
          setInpostError(
            typeof data.error === "string" ? data.error : "InPost lookup failed"
          );
          setInpostItem(null);
          return;
        }
        setInpostError(null);
        setInpostItem(data.item ?? null);
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          return;
        }
        if (e instanceof RateLimitError) {
          setInpostError(e.message);
          setInpostItem(null);
          return;
        }
        setInpostError("InPost lookup failed");
        setInpostItem(null);
      } finally {
        if (!ac.signal.aborted) {
          setInpostLoading(false);
        }
      }
    })();
    return () => ac.abort();
  }, [selected]);

  return { inpostItem, inpostLoading, inpostError };
}
