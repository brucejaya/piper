import Foundation

enum SurfacePresentationKind: String, Equatable {
    case taskUpdate
    case notification
    case gitCommit
    case testResult
    case artifact
    case metric
    case experiment
    case approval
    case auth
    case proposal
    case fallback
}

struct SurfacePresentation: Equatable {
    let kind: SurfacePresentationKind
    let title: String
    let subtitle: String?
    let detail: String
    let status: String?
    let priority: String?

    static func make(from surface: SurfaceEnvelope) -> SurfacePresentation {
        switch surface.type {
        case "task.update":
            return SurfacePresentation(
                kind: .taskUpdate,
                title: surface.display?.title ?? surface.summary,
                subtitle: string("state", in: surface.payload),
                detail: string("next", in: surface.payload) ?? surface.fallback,
                status: string("progress", in: surface.payload),
                priority: surface.display?.priority
            )
        case "notification":
            return SurfacePresentation(
                kind: .notification,
                title: surface.display?.title ?? surface.summary,
                subtitle: surface.display?.subtitle,
                detail: surface.fallback,
                status: nil,
                priority: surface.display?.priority
            )
        case "git.commit":
            return SurfacePresentation(
                kind: .gitCommit,
                title: surface.display?.title ?? string("summary", in: surface.payload) ?? "Commit",
                subtitle: compact([string("repository", in: surface.payload), string("branch", in: surface.payload)]),
                detail: string("hash", in: surface.payload) ?? surface.fallback,
                status: string("tests", in: surface.payload),
                priority: surface.display?.priority
            )
        case "test.result":
            return SurfacePresentation(
                kind: .testResult,
                title: surface.display?.title ?? string("command", in: surface.payload) ?? "Test result",
                subtitle: string("status", in: surface.payload),
                detail: string("failure", in: surface.payload) ?? surface.fallback,
                status: string("duration", in: surface.payload),
                priority: surface.display?.priority
            )
        case "artifact.created":
            return SurfacePresentation(
                kind: .artifact,
                title: surface.display?.title ?? string("title", in: surface.payload) ?? "Artifact",
                subtitle: string("type", in: surface.payload),
                detail: string("path", in: surface.payload) ?? surface.fallback,
                status: string("size", in: surface.payload),
                priority: surface.display?.priority
            )
        case "metric.series":
            return SurfacePresentation(
                kind: .metric,
                title: surface.display?.title ?? string("label", in: surface.payload) ?? "Metric",
                subtitle: string("unit", in: surface.payload),
                detail: string("value", in: surface.payload) ?? surface.fallback,
                status: string("trend", in: surface.payload),
                priority: surface.display?.priority
            )
        case "experiment.log":
            return SurfacePresentation(
                kind: .experiment,
                title: surface.display?.title ?? string("hypothesis", in: surface.payload) ?? "Experiment",
                subtitle: string("result", in: surface.payload),
                detail: string("summary", in: surface.payload) ?? surface.fallback,
                status: string("metric", in: surface.payload),
                priority: surface.display?.priority
            )
        case "approval.request":
            return SurfacePresentation(
                kind: .approval,
                title: surface.display?.title ?? "Approval requested",
                subtitle: string("toolName", in: surface.payload),
                detail: string("inputSummary", in: surface.payload) ?? surface.fallback,
                status: string("risk", in: surface.payload),
                priority: surface.display?.priority
            )
        case "auth.request", "auth.result":
            return SurfacePresentation(
                kind: .auth,
                title: surface.display?.title ?? surface.summary,
                subtitle: string("domain", in: surface.payload) ?? string("status", in: surface.payload),
                detail: string("reason", in: surface.payload) ?? surface.fallback,
                status: string("expiresAt", in: surface.payload),
                priority: surface.display?.priority
            )
        case "surface.proposal":
            return SurfacePresentation(
                kind: .proposal,
                title: surface.display?.title ?? "Surface proposal",
                subtitle: string("proposedType", in: surface.payload),
                detail: string("rationale", in: surface.payload) ?? surface.fallback,
                status: string("requestedDisplay", in: surface.payload),
                priority: surface.display?.priority
            )
        default:
            return SurfacePresentation(
                kind: .fallback,
                title: surface.display?.title ?? surface.summary,
                subtitle: surface.type,
                detail: surface.fallback,
                status: surface.display?.group,
                priority: surface.display?.priority
            )
        }
    }

    private static func string(_ key: String, in payload: [String: JSONValue]) -> String? {
        guard let value = payload[key] else {
            return nil
        }

        switch value {
        case .string(let value):
            return value.isEmpty ? nil : value
        case .number(let value):
            return value.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(value)) : String(value)
        case .bool(let value):
            return value ? "true" : "false"
        case .array(let values):
            return "\(values.count) items"
        case .object(let values):
            return values.keys.sorted().joined(separator: ", ")
        case .null:
            return nil
        }
    }

    private static func compact(_ values: [String?]) -> String? {
        let parts = values.compactMap { $0 }.filter { $0.isEmpty == false }
        return parts.isEmpty ? nil : parts.joined(separator: " / ")
    }
}
