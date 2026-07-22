import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout.js";
import { Dashboard } from "./pages/Dashboard.js";
import { TaskBoard } from "./pages/TaskBoard.js";
import { ChangePackageDetail } from "./pages/ChangePackageDetail.js";
import { WorkspaceList } from "./pages/WorkspaceList.js";
import { Logs } from "./pages/Logs.js";
import { MergeQueue } from "./pages/MergeQueue.js";
import { ConflictCenter } from "./pages/ConflictCenter.js";
import { AuditEvents } from "./pages/AuditEvents.js";
import { AgentOps } from "./pages/AgentOps.js";
import { ReviewContextPage } from "./pages/ReviewContextPage.js";
import { WorkflowJobs } from "./pages/WorkflowJobs.js";
import { TeamBoard } from "./pages/TeamBoard.js";
import { TeamSyncSettings } from "./pages/TeamSyncSettings.js";
import { ContextFeedPreview } from "./pages/ContextFeedPreview.js";
import { ConflictGraphPage } from "./pages/ConflictGraphPage.js";
import { SharedMergeQueue } from "./pages/SharedMergeQueue.js";
import { ProjectSelector } from "./pages/ProjectSelector.js";
import { HandoffDocuments } from "./pages/HandoffDocuments.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/projects" element={<ProjectSelector />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tasks" element={<TaskBoard />} />
          <Route path="workspaces" element={<WorkspaceList />} />
          <Route path="merge" element={<MergeQueue />} />
          <Route path="conflicts" element={<ConflictCenter />} />
          <Route path="logs" element={<Logs />} />
          <Route path="audit" element={<AuditEvents />} />
          <Route path="jobs" element={<WorkflowJobs />} />
          <Route path="agentops" element={<AgentOps />} />
          <Route path="team" element={<TeamBoard />} />
          <Route path="team-sync" element={<TeamSyncSettings />} />
          <Route path="context-feed" element={<ContextFeedPreview />} />
          <Route path="conflict-graph" element={<ConflictGraphPage />} />
          <Route path="shared-merge" element={<SharedMergeQueue />} />
          <Route path="handoff-docs" element={<HandoffDocuments />} />
          <Route path="packages/:taskId" element={<ChangePackageDetail />} />
          <Route path="review/:taskId" element={<ReviewContextPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
