---
name: feedback-fluidity
description: "Apex must feel fluid — preview/animation granularity and perceived lag are product requirements, not polish"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 140664a4-b513-46ef-9738-2f24690c8ca1
  modified: 2026-09-27T15:26:01.153Z
---

Apex « est une trancheuse fluide » : any visible stepping or lag in animations/preview (e.g. G-code lines appearing in chunks) is treated as a bug. The user asked that progressive line appearance never step by more than 0.1 mm.

**Why:** fluidity is a core selling point of the product versus other slicers.

**How to apply:** when building anything animated or playback-driven (G-code preview, morphs, sliders), interpolate per frame rather than per data point, avoid React re-renders on hot paths, and mention perf trade-offs explicitly. User communicates in French — answer in French.
