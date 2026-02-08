import { removeSession } from "@/commands/dashboard";
import { normalizeBranch } from "@/commands/logs";
import { LOGS_DIR } from "@/lib/config";
import { generateDashboardHtml } from "@/lib/html";
import { listAllActiveSessions } from "@/lib/lockfile";
import { deleteSessionFiles, getProjectName } from "@/lib/logger";
import type { DashboardData } from "@/lib/types";

type DashboardServerEventName =
  | "session_delete_requested"
  | "session_delete_invalid_json"
  | "session_delete_missing_session_path"
  | "session_delete_running_conflict"
  | "session_delete_not_found"
  | "session_delete_delete_files_failed"
  | "session_delete_success"
  | "session_delete_unhandled_error";

type DashboardServerEventStatus = "attempt" | "success" | "error" | number;

export interface DashboardServerEvent {
  ts: string;
  source: "dashboard-server";
  route: string;
  method: string;
  event: DashboardServerEventName;
  status: DashboardServerEventStatus;
  sessionPath?: string;
  reason?: string;
  details?: Record<string, unknown>;
}

interface ServerOptions {
  data: DashboardData;
  port?: number;
  onEvent?: (event: DashboardServerEvent) => void;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createEventEmitter(
  onEvent?: (event: DashboardServerEvent) => void
): (event: Omit<DashboardServerEvent, "ts" | "source">) => void {
  const sink =
    onEvent ??
    ((event: DashboardServerEvent) => {
      console.log(JSON.stringify(event));
    });

  return (event) => {
    const payload: DashboardServerEvent = {
      ts: new Date().toISOString(),
      source: "dashboard-server",
      ...event,
    };

    try {
      sink(payload);
    } catch (error) {
      try {
        console.error(`[dashboard-server] failed to emit log event: ${getErrorMessage(error)}`);
      } catch {
        // Ignore logging failures to keep request handling resilient
      }
    }
  };
}

export function startDashboardServer(options: ServerOptions): ReturnType<typeof Bun.serve> {
  const { data } = options;
  const emit = createEventEmitter(options.onEvent);

  return Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch: async (req) => {
      const url = new URL(req.url);

      if (url.pathname === "/" && req.method === "GET") {
        return new Response(generateDashboardHtml(data), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      if (url.pathname === "/api/sessions") {
        if (req.method !== "DELETE") {
          return new Response("Method not allowed", { status: 405 });
        }

        let sessionPathForContext: string | undefined;

        emit({
          route: url.pathname,
          method: req.method,
          event: "session_delete_requested",
          status: "attempt",
        });

        try {
          let body: { sessionPath?: unknown };
          try {
            body = (await req.json()) as { sessionPath?: unknown };
          } catch {
            emit({
              route: url.pathname,
              method: req.method,
              event: "session_delete_invalid_json",
              status: 400,
              reason: "invalid_json",
            });
            return new Response("Invalid request body", { status: 400 });
          }

          if (!body.sessionPath || typeof body.sessionPath !== "string") {
            emit({
              route: url.pathname,
              method: req.method,
              event: "session_delete_missing_session_path",
              status: 400,
              reason: "missing_session_path",
            });
            return new Response("Missing sessionPath", { status: 400 });
          }

          sessionPathForContext = body.sessionPath;

          // Check if session is actually running by querying live lockfile state
          // (the in-memory status may be stale if a review completed after dashboard opened)
          const activeSessions = await listAllActiveSessions(LOGS_DIR);
          for (const project of data.projects) {
            const session = project.sessions.find((s) => s.sessionPath === body.sessionPath);
            if (session) {
              // Sessions with terminal statuses are definitely not running - allow deletion
              const terminalStatuses = ["completed", "failed", "interrupted"];
              if (!terminalStatuses.includes(session.status)) {
                // Session might be running - check lockfile for this project
                const sessionBranch = normalizeBranch(session.gitBranch);
                const isActive = activeSessions.some((a) => {
                  const activeProjectName = getProjectName(a.projectPath);
                  const activeBranch = normalizeBranch(a.branch);
                  return (
                    activeProjectName === project.projectName && activeBranch === sessionBranch
                  );
                });
                if (isActive) {
                  emit({
                    route: url.pathname,
                    method: req.method,
                    event: "session_delete_running_conflict",
                    status: 409,
                    sessionPath: body.sessionPath,
                    reason: "running_session",
                    details: {
                      projectName: project.projectName,
                      gitBranch: session.gitBranch ?? null,
                    },
                  });
                  return new Response("Cannot delete a running session", { status: 409 });
                }
              }
              break;
            }
          }

          const found = removeSession(data, body.sessionPath);
          if (!found) {
            emit({
              route: url.pathname,
              method: req.method,
              event: "session_delete_not_found",
              status: 404,
              sessionPath: body.sessionPath,
              reason: "session_not_found",
            });
            return new Response("Session not found", { status: 404 });
          }

          try {
            await deleteSessionFiles(body.sessionPath);
          } catch (error) {
            emit({
              route: url.pathname,
              method: req.method,
              event: "session_delete_delete_files_failed",
              status: "error",
              sessionPath: body.sessionPath,
              reason: "delete_session_files_failed",
              details: { message: getErrorMessage(error) },
            });
            return new Response("Failed to delete session files", { status: 500 });
          }

          emit({
            route: url.pathname,
            method: req.method,
            event: "session_delete_success",
            status: 200,
            sessionPath: body.sessionPath,
          });

          return Response.json(data);
        } catch (error) {
          emit({
            route: url.pathname,
            method: req.method,
            event: "session_delete_unhandled_error",
            status: 500,
            sessionPath: sessionPathForContext,
            reason: "unexpected_error",
            details: { message: getErrorMessage(error) },
          });
          return new Response("Internal server error", { status: 500 });
        }
      }

      return new Response("Not found", { status: 404 });
    },
  });
}
