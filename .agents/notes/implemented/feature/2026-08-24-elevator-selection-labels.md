# Agent Note: Elevator motion for workspace, preset, and model selections and Workspace folders

Status: implemented

English | [中文](2026-08-24-elevator-selection-labels.zh.md)

## Problem

The Workspace, agent-preset, and model selection chips change their selection text in place, while a Workspace group's Sessions appear or disappear abruptly. Direct replacement conceals which compact control changed and an abrupt fold breaks continuity in the sidebar.

## Decision

`ElevatorLabel` in `dsh-client-ui-primitives` keeps the first value static. On a later value change, it clips the labels to one shared line, slides the new value down from above over 260ms, and slides the preceding value below the line. Every replacement receives a fresh key so rapid picks start a new run, while the track interpolates from its measured old text width to the new one over the same interval. The hero Workspace chip, the new-session agent-preset chip, and the composer model selection trigger use the atom. Reduced-motion users receive the replacement without movement.

`WorkspaceGroupDisclosure` wraps each Workspace group's visible Session run. It expands and folds a clipped `0fr`/`1fr` grid track over 220ms; on collapse, it keeps the last rows only until the transition settles and marks them inert and hidden from assistive technology first. The reduced-motion rule removes the transition.

## Alternatives considered

**Animate the complete button.** Moving its folder or preset icon and chevron would make the selection affordance itself appear to shift, rather than make the changed value legible.

**Animate only the incoming label.** Replacing the old text before it moves loses the elevator relationship and makes fast selection changes read as a fade.

**Unmount Workspace rows immediately on collapse.** The closing state would snap out of view, so the user could not see which folder had folded.

## Consequences

The selection controls share one timing curve, clipping rule, and reduced-motion behavior. The chip remains a normal button with its existing accessible name; only its visible value track and its resulting width are animated. Closing Workspace rows cannot be reached by focus or assistive technology while they leave, and they are removed after the fixed transition length. `elevator-label.client.spec.tsx` verifies the static first value, changed-value track, rapid replacement identity, and reduced-motion replacement; component tests verify the consumers render the motion state; the Workspace browser test verifies the folded rows become inert before unmounting.
