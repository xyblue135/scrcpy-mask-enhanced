import { createBrowserRouter } from "react-router-dom";
import { lazy } from "react";
import LoadingWrapper from "./components/common/LoadingWrapper";
import App from "./App";
import NotFound from "./components/NotFound";

const UsageGuide = lazy(() => import("./components/UsageGuide"));
const Welcome = lazy(() => import("./components/Welcome"));
const Devices = lazy(() => import("./components/Devices"));
const Mappings = lazy(() => import("./components/mappings/Mappings"));
const AdbResolution = lazy(() => import("./components/AdbResolution"));
const AdbPackages = lazy(() => import("./components/AdbPackages"));
const StartupSize = lazy(() => import("./components/StartupSize"));
const LatencyCompare = lazy(() => import("./components/LatencyCompare"));
const ScrcpyPresets = lazy(() => import("./components/ScrcpyModuleModal"));
const Settings = lazy(() => import("./components/Settings"));

const router = createBrowserRouter([
  {
    path: "/",
    element: <App />,
    children: [
      {
        index: true,
        element: (
          <LoadingWrapper>
            <Welcome />
          </LoadingWrapper>
        ),
      },
      {
        path: "usage-guide",
        element: (
          <LoadingWrapper>
            <UsageGuide />
          </LoadingWrapper>
        ),
      },
      {
        path: "devices",
        element: (
          <LoadingWrapper>
            <Devices />
          </LoadingWrapper>
        ),
      },
      {
        path: "mappings",
        element: (
          <LoadingWrapper>
            <Mappings />
          </LoadingWrapper>
        ),
      },
      {
        path: "adb-resolution",
        element: (
          <LoadingWrapper>
            <AdbResolution />
          </LoadingWrapper>
        ),
      },
      {
        path: "adb-packages",
        element: (
          <LoadingWrapper>
            <AdbPackages />
          </LoadingWrapper>
        ),
      },
      {
        path: "startup-size",
        element: (
          <LoadingWrapper>
            <StartupSize />
          </LoadingWrapper>
        ),
      },
      {
        path: "latency-compare",
        element: (
          <LoadingWrapper>
            <LatencyCompare />
          </LoadingWrapper>
        ),
      },
      {
        path: "scrcpy",
        element: (
          <LoadingWrapper>
            <ScrcpyPresets />
          </LoadingWrapper>
        ),
      },
      {
        path: "settings",
        element: (
          <LoadingWrapper>
            <Settings />
          </LoadingWrapper>
        ),
      },
    ],
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);

export default router;
