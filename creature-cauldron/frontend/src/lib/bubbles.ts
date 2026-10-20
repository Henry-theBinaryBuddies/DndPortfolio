// The layout of the bubbles that rise while a monster is being made. Fixed numbers, not random ones, so the picture is the
// same every time and a test can check it.

export interface BubbleSpec {
  /** Distance from the left edge, as a percentage of the width. */
  left: number;
  /** Width and height in rem. */
  size: number;
  /** Seconds before it starts, and seconds one rise takes. */
  delay: number;
  duration: number;
}

/** `count` bubbles spread across the width, each a little different in size and timing. */
export function bubbleLayout(count: number): BubbleSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    left: 6 + ((i * 37) % 88), // 37 and 88 share no factor, so the spots do not repeat for a long while
    size: 0.7 + ((i * 5) % 7) * 0.35,
    delay: ((i * 7) % 11) * 0.28,
    duration: 3.4 + ((i * 3) % 5) * 0.55,
  }));
}
