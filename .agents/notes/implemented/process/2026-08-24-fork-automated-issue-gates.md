# Agent Note: Fork and automated Issue gates

Status: implemented

English | [中文](2026-08-24-fork-automated-issue-gates.zh.md)

## Problem

The Issue lifecycle and policy workflows ran on Dependabot pull requests in repository forks. Lifecycle tried to mint the canonical organization's GitHub App token, but fork and Dependabot workflow contexts do not carry those secrets. Policy then queried the canonical repository with the fork-local pull request number. These deterministic configuration failures marked otherwise unrelated dependency updates red.

The workflows manage one canonical organization's Project and Issue policy. A fork cannot perform those writes correctly, and automated pull requests are already outside the human review policy.

## Decision

Keep both jobs present for every subscribed event, but gate the Project-token, mutation, and pull-request validation steps to the canonical `deepseek-harness/deepseek-harness` repository. The same steps skip pull requests whose author type is `Bot` or `App`. Checkout remains successful, so skipped management work does not become a failing dependency check.

## Alternatives considered

**Copy the GitHub App credentials into forks or Dependabot secrets.** Forks do not own the canonical Project, and widening a write-capable credential would grant authority unrelated to dependency verification.

**Run policy against `github.repository`.** That would change the policy's owner from the configured canonical Project to arbitrary fork metadata and still leave lifecycle writes without a corresponding organization Project.

**Disable the workflows entirely.** Human pull requests in the canonical repository still require the existing Issue policy and event-directed Project lifecycle.

## Verification

The workflow configuration test requires both management steps to carry the canonical-repository and automated-author gates. Existing event subscriptions and human canonical review behavior remain unchanged.

## Consequences

Dependabot pull requests and fork copies no longer fail because canonical Project credentials or matching upstream pull request numbers are unavailable. Canonical human pull requests retain the established read and write policy checks.
