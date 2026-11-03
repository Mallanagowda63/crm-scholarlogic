"use client";

import { useEffect, type RefObject } from "react";

/**
 * On a slow connection someone can type before React has loaded, and React never
 * hears about those keystrokes. This picks up whatever is already in the box.
 */
export function useTypedBeforeHydration(
  input: RefObject<HTMLInputElement | null>,
  value: string,
  onChange: (value: string) => void,
) {
  useEffect(() => {
    const typed = input.current?.value;
    if (typed !== undefined && typed !== value) onChange(typed);
    // Only needed once, because React sees everything typed after this point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
