/**
 * Pierre's default shadow-DOM styles clip long diff lines:
 * `[data-code]` uses `overflow: scroll clip`, wrap still clips on the Y axis,
 * and the WebKit scrollbar thumb stays transparent until hover (then nearly
 * matches the background). These overrides live in `unsafeCSS` so they apply
 * inside the shadow root.
 */
export const PIERRE_DIFF_OVERFLOW_CSS = `
  /* Keep the gutter visible; make the horizontal thumb actually readable. */
  [data-code]::-webkit-scrollbar {
    height: var(--diffs-scrollbar-gutter, 8px);
  }

  [data-code]::-webkit-scrollbar-thumb {
    background-color: var(--oc-scrollbar-thumb, color-mix(in srgb, var(--surface-muted-foreground) 40%, transparent));
  }

  [data-code]::-webkit-scrollbar-thumb:hover {
    background-color: var(--oc-scrollbar-thumb-hover, color-mix(in srgb, var(--surface-muted-foreground) 60%, transparent));
  }

  @supports ((-moz-appearance: none)) {
    [data-code] {
      scrollbar-width: thin;
      scrollbar-color: var(--oc-scrollbar-thumb, color-mix(in srgb, var(--surface-muted-foreground) 45%, transparent)) transparent;
    }
  }

  /* Wrap must grow vertically; Pierre's \`overflow: scroll clip\` + \`contain:
     content\` otherwise hide the wrapped remainder. */
  [data-overflow="wrap"] [data-code] {
    overflow-x: hidden;
    overflow-y: visible;
  }

  [data-overflow="wrap"] code {
    contain: none;
  }

  [data-overflow="wrap"] [data-line] {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
`;

export const resolvePierreOverflow = (wrapLines: boolean | undefined): 'wrap' | 'scroll' =>
  wrapLines ? 'wrap' : 'scroll';
