# Recent Research Notes

## 2026-06-15 last30days: Persistent Coding Agents, Mobile Control, Approvals

The `last30days` run searched Reddit, Hacker News, GitHub, and Polymarket for recent discussion around persistent coding agents, remote control, mobile monitoring, and approvals. Available configured sources returned Reddit and Hacker News evidence; X and YouTube were not configured.

## Takeaways

- Trust is the sharpest adoption question. A relevant `r/selfhosted` thread asked what people would require before trusting a self-hosted Codex or Claude runner, while noting that dashboards, tmux wrappers, and mobile UIs already exist.
- Persistent-agent infrastructure is active. Recent HN items included Hermes Agent, YourMemory, Komi-learn, `/dmg`, AIPass, and Nerve.
- Observability and notification tools are adjacent. AgentMeter, NotifyMe, Beacon, and Dashvox show demand around cost visibility, agent updates, remote access, and alternate control surfaces.
- Approval and tool safety should be productized. Agentjacking and managed-agent sandbox discussions reinforce the need for visible approval context and explicit trust boundaries.
- Direct evidence for "developers want an iOS app for coding agents" was thinner than the evidence for "developers need trusted remote control, monitoring, and approvals."

## Product Implications

- Lead with secure remote control and approvals before "mobile dashboard."
- Treat `docs/security.md` and `docs/protocol.md` as adoption assets, not compliance chores.
- Keep the official iOS app framed as the best experience for an open protocol.
- Make push notifications narrow wake hints, not a hosted relay.
- Make revocation a pre-launch requirement.

