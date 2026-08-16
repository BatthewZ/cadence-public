import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useParams } from "react-router-dom";

import { AuthGuard } from "./components/guards/AuthGuard";
import { GuestGuard } from "./components/guards/GuestGuard";
import { TosGuard } from "./components/guards/TosGuard";
import { WorkspaceGuard } from "./components/guards/WorkspaceGuard";
import { HomeRedirect } from "./components/HomeRedirect";
import { Center } from "./components/layout";
import { ProjectLayout } from "./components/layout/ProjectLayout";
import { WorkspaceLayout } from "./components/layout/WorkspaceLayout";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Spinner } from "./components/ui/Spinner";
import { ToastProvider, useToast } from "./components/ui/ToastContext";
import { setOnUnauthorized } from "./lib/api/client";
import { queryClient } from "./lib/query-client";

/* ─── Lazy page imports ─── */

const AcceptTerms = lazy(() => import("./pages/AcceptTerms/AcceptTerms"));
const Dashboard = lazy(() => import("./pages/Dashboard/Dashboard"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword/ForgotPassword"));
const InviteAccept = lazy(() => import("./pages/InviteAccept/InviteAccept"));
const Login = lazy(() => import("./pages/Login/Login"));
const MyTasks = lazy(() => import("./pages/MyTasks/MyTasks"));
const NotFound = lazy(() => import("./pages/NotFound/NotFound"));
const Notifications = lazy(() => import("./pages/Notifications/Notifications"));
const Privacy = lazy(() => import("./pages/Privacy/Privacy"));
const ProjectBoard = lazy(() => import("./pages/ProjectBoard/ProjectBoard"));
const ProjectCalendar = lazy(() => import("./pages/ProjectCalendar/ProjectCalendar"));
const ProjectDashboard = lazy(() => import("./pages/ProjectDashboard/ProjectDashboard"));
const ProjectList = lazy(() => import("./pages/Projects/ProjectList"));
const ProjectListView = lazy(() => import("./pages/ProjectListView/ProjectListView"));
const ProjectSettings = lazy(() => import("./pages/ProjectSettings/ProjectSettings"));
const ProjectTimeline = lazy(() => import("./pages/ProjectTimeline/ProjectTimeline"));
const Register = lazy(() => import("./pages/Register/Register"));
const ResetPassword = lazy(() => import("./pages/ResetPassword/ResetPassword"));
const Settings = lazy(() => import("./pages/Settings/Settings"));
const Terms = lazy(() => import("./pages/Terms/Terms"));
const ThemeEditor = lazy(() => import("./pages/ThemeEditor/ThemeEditor"));
const Workspaces = lazy(() => import("./pages/Workspaces/Workspaces"));
const WorkspaceSettings = lazy(() => import("./pages/WorkspaceSettings/WorkspaceSettings"));
const WorkspaceMembers = lazy(() => import("./pages/WorkspaceSettings/WorkspaceMembers"));
const WorkspaceWebhooks = lazy(() => import("./pages/WorkspaceSettings/WorkspaceWebhooks"));
const WorkspaceApiTokens = lazy(() => import("./pages/WorkspaceSettings/WorkspaceApiTokens"));
const WorkspaceData = lazy(() => import("./pages/WorkspaceSettings/WorkspaceData"));

const GUEST_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];

function UnauthorizedRedirect() {
  const { toast } = useToast();

  useEffect(() => {
    setOnUnauthorized(() => {
      if (GUEST_PATHS.includes(window.location.pathname)) return;
      toast("Your session has expired. Please sign in again.", { variant: "warning" });
      window.location.href = "/login";
    });
    return () => setOnUnauthorized(null);
  }, [toast]);

  return null;
}

/** Error boundary that auto-resets when the workspace slug changes */
function WorkspaceBoundary({ children }: { children: React.ReactNode }) {
  const { workspaceSlug } = useParams();
  return (
    <ErrorBoundary resetKeys={[workspaceSlug]}>
      {children}
    </ErrorBoundary>
  );
}

/** Error boundary that auto-resets when the project ID changes */
function ProjectBoundary({ children }: { children: React.ReactNode }) {
  const { projectId } = useParams();
  return (
    <ErrorBoundary resetKeys={[projectId]}>
      {children}
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:bg-surface-0 focus:px-4 focus:py-2 focus:rounded-md focus:shadow-md focus:text-fg-primary"
      >
        Skip to content
      </a>
      <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <UnauthorizedRedirect />
        <ErrorBoundary>
          <Suspense
              fallback={
                <Center className="min-h-screen">
                  <Spinner size="lg" />
                </Center>
              }
            >
              <main id="main-content">
                <Routes>
                  {/* Guest routes */}
                  <Route
                    path="/login"
                    element={
                      <GuestGuard>
                        <Login />
                      </GuestGuard>
                    }
                  />
                  <Route
                    path="/register"
                    element={
                      <GuestGuard>
                        <Register />
                      </GuestGuard>
                    }
                  />
                  <Route
                    path="/forgot-password"
                    element={
                      <GuestGuard>
                        <ForgotPassword />
                      </GuestGuard>
                    }
                  />
                  <Route
                    path="/reset-password"
                    element={
                      <GuestGuard>
                        <ResetPassword />
                      </GuestGuard>
                    }
                  />

                  {/* Public legal pages */}
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/privacy" element={<Privacy />} />

                  {/* Workspace-scoped routes */}
                  <Route
                    path="/w/:workspaceSlug"
                    element={
                      <AuthGuard>
                        <TosGuard>
                          <WorkspaceBoundary>
                            <WorkspaceGuard>
                              <WorkspaceLayout />
                            </WorkspaceGuard>
                          </WorkspaceBoundary>
                        </TosGuard>
                      </AuthGuard>
                    }
                  >
                    <Route index element={<Navigate to="dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="my-tasks" element={<MyTasks />} />
                    <Route path="projects" element={<ProjectList />} />
                    <Route path="projects/:projectId" element={
                      <ProjectBoundary>
                        <ProjectLayout />
                      </ProjectBoundary>
                    }>
                      <Route index element={<Navigate to="board" replace />} />
                      <Route path="dashboard" element={<ProjectDashboard />} />
                      <Route path="board" element={<ProjectBoard />} />
                      <Route path="list" element={<ProjectListView />} />
                      <Route path="timeline" element={<ProjectTimeline />} />
                      <Route path="calendar" element={<ProjectCalendar />} />
                      <Route path="settings" element={<ProjectSettings />} />
                    </Route>
                    <Route path="settings" element={<WorkspaceSettings />} />
                    <Route path="settings/members" element={<WorkspaceMembers />} />
                    <Route path="settings/webhooks" element={<WorkspaceWebhooks />} />
                    <Route path="settings/api-tokens" element={<WorkspaceApiTokens />} />
                    <Route path="settings/data" element={<WorkspaceData />} />
                    <Route path="notifications" element={<Notifications />} />
                    <Route path="account" element={<Settings />} />
                  </Route>

                  {/* Other authenticated routes */}
                  <Route
                    path="/workspaces"
                    element={
                      <AuthGuard>
                        <TosGuard>
                          <Workspaces />
                        </TosGuard>
                      </AuthGuard>
                    }
                  />
                  <Route path="/invite/:token" element={<InviteAccept />} />
                  <Route
                    path="/accept-terms"
                    element={
                      <AuthGuard>
                        <AcceptTerms />
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/notifications"
                    element={
                      <AuthGuard>
                        <TosGuard>
                          <Notifications />
                        </TosGuard>
                      </AuthGuard>
                    }
                  />
                  <Route
                    path="/settings"
                    element={
                      <AuthGuard>
                        <TosGuard>
                          <Settings />
                        </TosGuard>
                      </AuthGuard>
                    }
                  />

                  {/* Theme editor route */}
                  <Route path="/theme-editor" element={<ThemeEditor />} />

                  {/* Home redirect */}
                  <Route path="/" element={<HomeRedirect />} />

                  {/* Catch-all */}
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
          </Suspense>
        </ErrorBoundary>
      </ToastProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
