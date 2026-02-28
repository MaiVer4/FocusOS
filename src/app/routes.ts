import { createBrowserRouter } from "react-router";
import { Root } from "./components/Root";
import { Home } from "./components/Home";
import { Focus } from "./components/Focus";
import { Planner } from "./components/Planner";
import { Metrics } from "./components/Metrics";
import { Settings } from "./components/Settings";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: "focus", Component: Focus },
      { path: "planner", Component: Planner },
      { path: "metrics", Component: Metrics },
      { path: "settings", Component: Settings },
    ],
  },
]);
