# Studio design references

The implemented direction is an original charcoal-and-lime media workspace: a large preview stage, compact settings rail, rounded controls, restrained borders, and IBM Plex Sans. It borrows interaction patterns, not a downloaded template's source.

Useful modern starting points:

| Reference | Useful here | Integration |
| --- | --- | --- |
| [GPUI Kit themes](https://gpui-kit.com/component/theme) | Semantic colors, native controls, hover/selection states | Closest fit for extending the Rust panel. This implementation uses GPUI primitives directly to keep its Wasm surface smaller. |
| [shadcn/ui presets](https://ui.shadcn.com/create) | Calm spacing, neutral surfaces, consistent radii | Visual reference; React/Tailwind templates do not compile into GPUI. |
| [Catppuccin](https://github.com/catppuccin/catppuccin) | A softer pastel alternative with four palettes | Possible future theme; no Catppuccin assets are included in this change. |

The browser host handles video, camera permissions, file input and downloads. An isolated, same-origin GPUI Wasm panel renders the preset controls with retained state and hover feedback, sending validated settings messages to the host. The host remains responsive on narrow screens. Standard HTML controls provide full FPS/width ranges and keyboard access independently of the GPU panel.

Font: IBM Plex Sans, bundled under the accompanying SIL Open Font License. No paid template or remote font service is required.
